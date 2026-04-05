const { enviarMensaje, enviarBotones, enviarLista } = require('../services/whatsapp.js')
const {
  obtenerServicios,
  obtenerBarberosPorServicio,
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
} = require('../services/citas')
const supabase = require('../database/db')

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ─── Helpers de sesión ────────────────────────────────────────────────────────

async function obtenerSesion(telefono) {
  const { data, error } = await supabase
    .from('sesiones')
    .select('estado, datos')
    .eq('telefono', telefono)
    .single()

  if (error || !data) return { estado: 'INICIO', datos: {} }
  return { estado: data.estado, datos: data.datos || {} }
}

async function guardarSesion(telefono, estado, datos = {}) {
  await supabase
    .from('sesiones')
    .upsert(
      { telefono, estado, datos, updated_at: new Date().toISOString() },
      { onConflict: 'telefono' }
    )
}

async function eliminarSesion(telefono) {
  await supabase.from('sesiones').delete().eq('telefono', telefono)
}

// ─── Menú principal como lista interactiva ────────────────────────────────────

async function enviarMenu(telefono) {
  await enviarLista(telefono, {
    cabecera: '💈 Peluquería Javier',
    cuerpo:   '¿En qué podemos ayudarte hoy?',
    pie:      'Escribe 0 en cualquier momento para salir',
    boton:    'Ver opciones',
    secciones: [{
      titulo: 'Gestiona tu cita',
      filas: [
        { id: 'menu_1', titulo: '📅 Reservar cita',      descripcion: 'Elige servicio, barbero y horario' },
        { id: 'menu_2', titulo: '🗓 Ver mis citas',       descripcion: 'Consulta tus próximas citas' },
        { id: 'menu_3', titulo: '✕  Cancelar cita',      descripcion: 'Cancela una reserva existente'  },
        { id: 'menu_4', titulo: '💬 Hablar con soporte', descripcion: 'Un agente te atiende en breve'  },
        { id: 'menu_0', titulo: '👋 Salir',               descripcion: 'Cerrar la conversación'         },
      ],
    }],
  })
}

// ─── Procesador principal ─────────────────────────────────────────────────────

async function procesarMensaje(telefono, texto) {
  let { estado, datos } = await obtenerSesion(telefono)
  texto = texto.trim()

  // Escape global: "0" vuelve al menú (o cierra si ya está en menú)
  if (texto === '0' || texto === 'menu_0') {
    if (estado === 'ESPERANDO_OPCION' || estado === 'INICIO') {
      await enviarMensaje(telefono, `👋 ¡Hasta pronto! Si necesitas algo, escríbenos cuando quieras. 😊`)
      await eliminarSesion(telefono)
    } else {
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      await enviarMenu(telefono)
    }
    return
  }

  switch (estado) {

    // ── Bienvenida ─────────────────────────────────────────────────────────────
    case 'INICIO': {
      await enviarMensaje(telefono, `👋 ¡Hola! Bienvenido a *Peluquería Javier* ✂️`)
      await enviarMenu(telefono)
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      break
    }

    // ── Menú principal ─────────────────────────────────────────────────────────
    case 'ESPERANDO_OPCION': {
      // Admite tanto el ID de la lista (menu_1) como texto numérico (1)
      const op = texto === 'menu_1' ? '1'
               : texto === 'menu_2' ? '2'
               : texto === 'menu_3' ? '3'
               : texto === 'menu_4' ? '4'
               : texto

      if (op === '1') {
        const SERVICIOS = await obtenerServicios()

        await enviarLista(telefono, {
          cabecera: '✂️ Servicios disponibles',
          cuerpo:   '¿Qué servicio necesitas hoy?',
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver servicios',
          secciones: [{
            titulo: 'Nuestros servicios',
            filas: Object.entries(SERVICIOS).map(([key, s]) => ({
              id:          `servicio_${key}`,
              titulo:      s.nombre,
              descripcion: `${s.precio} · ${s.duracion_minutos} min`,
            })),
          }],
        })
        await guardarSesion(telefono, 'ELIGIENDO_SERVICIO', {
          totalServicios: Object.keys(SERVICIOS).length,
        })

      } else if (op === '2') {
        const citas = await obtenerCitasCliente(telefono)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `🗓 No tienes citas próximas.`)
        } else {
          let msg = '🗓 *Tus próximas citas:*\n\n'
          citas.forEach((c, i) => {
            msg += `*${i + 1}.* ${c.fecha} a las ${c.hora.substring(0, 5)}\n`
            msg += `   ✂️ ${c.servicios.nombre} — ${c.servicios.precio}€\n`
            msg += `   💇 ${c.barberos?.nombre || 'Sin asignar'}\n\n`
          })
          await enviarMensaje(telefono, msg.trimEnd())
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else if (op === '3') {
        const citas = await obtenerCitasCliente(telefono)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `✕ No tienes citas para cancelar.`)
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
          await enviarMenu(telefono)
        } else {
          await enviarLista(telefono, {
            cabecera: '✕ Cancelar cita',
            cuerpo:   '¿Qué cita deseas cancelar?',
            pie:      'Escribe 0 para volver sin cancelar',
            boton:    'Ver mis citas',
            secciones: [{
              titulo: 'Citas confirmadas',
              filas: citas.map((c, i) => ({
                id:          `cancelar_${i}`,
                titulo:      `${c.fecha} · ${c.hora.substring(0, 5)}`,
                descripcion: `${c.servicios.nombre} — ${c.barberos?.nombre || 'Sin asignar'}`,
              })),
            }],
          })
          await guardarSesion(telefono, 'CANCELANDO_CITA', { citasPendientes: citas })
        }

      } else if (op === '4') {
        await enviarMensaje(
          telefono,
          `💬 Has contactado con soporte.\n\nUn responsable te atenderá lo antes posible.\n\n✍️ Escribe tu consulta y te respondemos en breve.\n\n_Escribe 0 para volver al menú._`
        )
        await guardarSesion(telefono, 'SOPORTE', {})

      } else {
        await enviarMensaje(telefono, `⚠️ Por favor selecciona una opción del menú.`)
        await enviarMenu(telefono)
      }
      break
    }

    // ── Soporte ────────────────────────────────────────────────────────────────
    case 'SOPORTE': {
      await enviarMensaje(
        telefono,
        `✅ Tu mensaje ha sido recibido. En breve nos ponemos en contacto contigo. 🙏`
      )
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      await enviarMenu(telefono)
      break
    }

    // ── Eligiendo servicio ─────────────────────────────────────────────────────
    case 'ELIGIENDO_SERVICIO': {
      const SERVICIOS = await obtenerServicios()

      // Extrae la clave: "servicio_1" → "1"  |  "1" → "1"
      const clave = texto.startsWith('servicio_') ? texto.replace('servicio_', '') : texto

      if (SERVICIOS[clave]) {
        const servicio   = SERVICIOS[clave].nombre
        const servicioId = SERVICIOS[clave].id
        const barberos   = await obtenerBarberosPorServicio(servicioId)

        if (barberos.length === 0) {
          await enviarMensaje(
            telefono,
            `😔 No hay barberos disponibles para *${servicio}* en este momento.`
          )
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
          await enviarMenu(telefono)
          break
        }

        await enviarLista(telefono, {
          cabecera: `✂️ ${servicio}`,
          cuerpo:   '¿Con quién quieres tu cita?',
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver barberos',
          secciones: [{
            titulo: 'Nuestro equipo',
            filas: barberos.map((b, idx) => ({
              id:    `barbero_${idx}`,
              titulo: b.nombre,
            })),
          }],
        })
        await guardarSesion(telefono, 'ELIGIENDO_BARBERO', { servicio, servicioId, barberos })

      } else {
        await enviarMensaje(telefono, `⚠️ Por favor selecciona un servicio del menú.`)
        // Reenviar lista de servicios
        const SERVICIOS2 = await obtenerServicios()
        await enviarLista(telefono, {
          cabecera: '✂️ Servicios disponibles',
          cuerpo:   '¿Qué servicio necesitas hoy?',
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver servicios',
          secciones: [{
            titulo: 'Nuestros servicios',
            filas: Object.entries(SERVICIOS2).map(([key, s]) => ({
              id:          `servicio_${key}`,
              titulo:      s.nombre,
              descripcion: `${s.precio} · ${s.duracion_minutos} min`,
            })),
          }],
        })
      }
      break
    }

    // ── Eligiendo barbero ──────────────────────────────────────────────────────
    case 'ELIGIENDO_BARBERO': {
      const { servicio, servicioId, barberos } = datos

      // Extrae el índice: "barbero_0" → 0
      const idx = texto.startsWith('barbero_')
        ? parseInt(texto.replace('barbero_', ''))
        : parseInt(texto) - 1  // compat. numérica: "1" → índice 0

      if (idx >= 0 && idx < barberos.length) {
        const barbero   = barberos[idx]
        const barberoId = barbero.id

        // Próximos 4 días hábiles (sin domingo)
        const hoy    = new Date()
        const fechas = []
        let i = 1
        while (fechas.length < 4) {
          const d = new Date(hoy)
          d.setDate(hoy.getDate() + i)
          if (d.getDay() !== 0) fechas.push(d.toISOString().split('T')[0])
          i++
        }

        // Disponibilidad en paralelo
        const disponibilidad = await Promise.all(
          fechas.map(f => obtenerHorasDisponibles(f, servicioId, barberoId))
        )

        await enviarLista(telefono, {
          cabecera: `📅 ${servicio} con ${barbero.nombre}`,
          cuerpo:   'Elige el día que prefieras:',
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver días',
          secciones: [{
            titulo: 'Próximos días disponibles',
            filas: fechas.map((f, j) => {
              const d       = new Date(f + 'T12:00:00')
              const hayHoras = disponibilidad[j].length > 0
              return {
                id:          `fecha_${j}`,
                titulo:      `${DIAS[d.getDay()]} ${f}`,
                descripcion: hayHoras
                  ? `${disponibilidad[j].length} horario${disponibilidad[j].length > 1 ? 's' : ''} disponible${disponibilidad[j].length > 1 ? 's' : ''}`
                  : '🔴 Sin horarios disponibles',
              }
            }),
          }],
        })

        await guardarSesion(telefono, 'ELIGIENDO_FECHA', {
          servicio,
          servicioId,
          barberoId,
          barberoNombre: barbero.nombre,
          fechasDisponibles: fechas,
          disponibilidad,
        })

      } else {
        await enviarMensaje(telefono, `⚠️ Por favor selecciona un barbero del menú.`)
        await enviarLista(telefono, {
          cabecera: `✂️ ${servicio}`,
          cuerpo:   '¿Con quién quieres tu cita?',
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver barberos',
          secciones: [{
            titulo: 'Nuestro equipo',
            filas: barberos.map((b, j) => ({
              id:    `barbero_${j}`,
              titulo: b.nombre,
            })),
          }],
        })
      }
      break
    }

    // ── Eligiendo fecha ────────────────────────────────────────────────────────
    case 'ELIGIENDO_FECHA': {
      const { servicio, servicioId, barberoId, barberoNombre, fechasDisponibles, disponibilidad } = datos

      // Extrae el índice: "fecha_2" → 2
      const idx = texto.startsWith('fecha_')
        ? parseInt(texto.replace('fecha_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < fechasDisponibles.length) {
        const fecha = fechasDisponibles[idx]

        // Re-consultar horas en el momento de la selección (por si hubo cambios)
        const horasLibres = await obtenerHorasDisponibles(fecha, servicioId, barberoId)

        if (horasLibres.length === 0) {
          await enviarMensaje(telefono, `🔴 *${barberoNombre}* ya no tiene horarios disponibles el *${fecha}*.\n\nElige otro día:`)
          // Reenviar lista de fechas
          await enviarLista(telefono, {
            cabecera: `📅 ${servicio} con ${barberoNombre}`,
            cuerpo:   'Elige otro día:',
            pie:      'Escribe 0 para volver al menú',
            boton:    'Ver días',
            secciones: [{
              titulo: 'Próximos días disponibles',
              filas: fechasDisponibles.map((f, j) => {
                const d = new Date(f + 'T12:00:00')
                const n = disponibilidad[j]?.length ?? 0
                return {
                  id:          `fecha_${j}`,
                  titulo:      `${DIAS[d.getDay()]} ${f}`,
                  descripcion: n > 0
                    ? `${n} horario${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`
                    : '🔴 Sin horarios disponibles',
                }
              }),
            }],
          })
          break
        }

        // Agrupar horas en Mañana / Tarde (máx 10 por sección)
        const manana = horasLibres.filter(h => parseInt(h.split(':')[0]) < 14).slice(0, 10)
        const tarde  = horasLibres.filter(h => parseInt(h.split(':')[0]) >= 14).slice(0, 10)

        // Array ordenado para lookup por índice al seleccionar
        const horasEnLista = [...manana, ...tarde]

        const secciones = []
        if (manana.length > 0) {
          secciones.push({
            titulo: '🌅 Mañana',
            filas: manana.map((h, j) => ({ id: `hora_${j}`, titulo: h })),
          })
        }
        if (tarde.length > 0) {
          secciones.push({
            titulo: '🌇 Tarde',
            filas: tarde.map((h, j) => ({ id: `hora_${manana.length + j}`, titulo: h })),
          })
        }

        await enviarLista(telefono, {
          cabecera: `🕐 ${DIAS[new Date(fecha + 'T12:00:00').getDay()]} ${fecha}`,
          cuerpo:   `Horarios disponibles con *${barberoNombre}*:`,
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver horarios',
          secciones,
        })

        await guardarSesion(telefono, 'ELIGIENDO_HORA', {
          servicio,
          servicioId,
          barberoId,
          barberoNombre,
          fecha,
          horasEnLista,
        })

      } else {
        await enviarMensaje(telefono, `⚠️ Por favor selecciona un día del menú.`)
        await enviarLista(telefono, {
          cabecera: `📅 ${servicio} con ${barberoNombre}`,
          cuerpo:   'Elige el día que prefieras:',
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver días',
          secciones: [{
            titulo: 'Próximos días disponibles',
            filas: fechasDisponibles.map((f, j) => {
              const d       = new Date(f + 'T12:00:00')
              const hayHoras = disponibilidad[j].length > 0
              return {
                id:          `fecha_${j}`,
                titulo:      `${DIAS[d.getDay()]} ${f}`,
                descripcion: hayHoras
                  ? `${disponibilidad[j].length} horario${disponibilidad[j].length > 1 ? 's' : ''} disponible${disponibilidad[j].length > 1 ? 's' : ''}`
                  : '🔴 Sin horarios disponibles',
              }
            }),
          }],
        })
      }
      break
    }

    // ── Eligiendo hora ─────────────────────────────────────────────────────────
    case 'ELIGIENDO_HORA': {
      const { servicio, servicioId, barberoId, barberoNombre, fecha, horasEnLista } = datos

      // Extrae el índice: "hora_3" → 3
      const idx = texto.startsWith('hora_')
        ? parseInt(texto.replace('hora_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < horasEnLista.length) {
        const hora = horasEnLista[idx]

        await enviarBotones(
          telefono,
          `🔍 *Resumen de tu cita:*\n\n` +
          `✂️ Servicio: ${servicio}\n` +
          `💇 Barbero: ${barberoNombre}\n` +
          `📅 Fecha: ${fecha}\n` +
          `🕐 Hora: ${hora}\n\n` +
          `¿Lo confirmamos?`,
          [
            { id: 'confirmar_cita', title: '✅ Confirmar' },
            { id: 'cancelar_cita',  title: '✕ Cancelar'  },
          ],
          'Peluquería Javier'
        )
        await guardarSesion(telefono, 'CONFIRMANDO_CITA', {
          servicio, servicioId, barberoId, barberoNombre, fecha, hora,
        })

      } else {
        await enviarMensaje(telefono, `⚠️ Por favor selecciona una hora del menú.`)
        const manana = horasEnLista.filter(h => parseInt(h.split(':')[0]) < 14).slice(0, 10)
        const tarde  = horasEnLista.filter(h => parseInt(h.split(':')[0]) >= 14).slice(0, 10)
        const secciones = []
        if (manana.length > 0) {
          secciones.push({
            titulo: '🌅 Mañana',
            filas: manana.map((h, j) => ({ id: `hora_${j}`, titulo: h })),
          })
        }
        if (tarde.length > 0) {
          secciones.push({
            titulo: '🌇 Tarde',
            filas: tarde.map((h, j) => ({ id: `hora_${manana.length + j}`, titulo: h })),
          })
        }
        await enviarLista(telefono, {
          cabecera: `🕐 ${DIAS[new Date(fecha + 'T12:00:00').getDay()]} ${fecha}`,
          cuerpo:   `Horarios disponibles con *${barberoNombre}*:`,
          pie:      'Escribe 0 para volver al menú',
          boton:    'Ver horarios',
          secciones,
        })
      }
      break
    }

    // ── Confirmando cita ───────────────────────────────────────────────────────
    case 'CONFIRMANDO_CITA': {
      const { servicio, servicioId, barberoId, barberoNombre, fecha, hora } = datos

      if (texto === 'confirmar_cita') {
        const cita = await guardarCita(telefono, servicioId, barberoId, fecha, hora)
        if (cita) {
          await enviarMensaje(
            telefono,
            `✅ *¡Cita confirmada!*\n\n` +
            `✂️ ${servicio}\n` +
            `💇 ${barberoNombre}\n` +
            `📅 ${fecha} · 🕐 ${hora}\n\n` +
            `Te esperamos 😊`
          )
        } else {
          await enviarMensaje(
            telefono,
            `❌ Hubo un error al guardar la cita. Por favor inténtalo de nuevo.`
          )
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else if (texto === 'cancelar_cita') {
        await enviarMensaje(telefono, `↩️ Cita no guardada. Puedes volver a reservar cuando quieras.`)
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else {
        // Re-enviar botones si el usuario escribe texto libre
        await enviarBotones(
          telefono,
          `Por favor pulsa uno de los botones para confirmar o cancelar:\n\n` +
          `✂️ ${servicio} · 💇 ${barberoNombre}\n` +
          `📅 ${fecha} · 🕐 ${hora}`,
          [
            { id: 'confirmar_cita', title: '✅ Confirmar' },
            { id: 'cancelar_cita',  title: '✕ Cancelar'  },
          ],
          'Peluquería Javier'
        )
      }
      break
    }

    // ── Cancelando cita ────────────────────────────────────────────────────────
    case 'CANCELANDO_CITA': {
      const { citasPendientes } = datos

      // Extrae el índice: "cancelar_0" → 0
      const idx = texto.startsWith('cancelar_')
        ? parseInt(texto.replace('cancelar_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < citasPendientes.length) {
        const cita = citasPendientes[idx]
        await cancelarCita(cita.id)
        await enviarMensaje(
          telefono,
          `✅ *Cita cancelada:*\n\n` +
          `📅 ${cita.fecha} · 🕐 ${cita.hora.substring(0, 5)}\n` +
          `✂️ ${cita.servicios.nombre}\n` +
          `💇 ${cita.barberos?.nombre || 'Sin asignar'}`
        )
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else {
        await enviarMensaje(telefono, `⚠️ Por favor selecciona una cita de la lista.`)
      }
      break
    }

    // ── Fallback ───────────────────────────────────────────────────────────────
    default: {
      await guardarSesion(telefono, 'INICIO', {})
      await procesarMensaje(telefono, texto)
    }
  }
}


module.exports = { procesarMensaje }