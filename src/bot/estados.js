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
    cabecera: 'Peluquería Javier',
    cuerpo:   '¿En qué podemos ayudarle hoy?',
    pie:      'Escriba 0 en cualquier momento para salir',
    boton:    'Ver opciones',
    secciones: [{
      titulo: 'Gestione su cita',
      filas: [
        { id: 'menu_1', titulo: 'Reservar cita',      descripcion: 'Elija servicio, profesional y horario' },
        { id: 'menu_2', titulo: 'Ver mis citas',       descripcion: 'Consulte sus próximas citas'           },
        { id: 'menu_3', titulo: 'Cancelar cita',       descripcion: 'Cancele una reserva existente'         },
        { id: 'menu_4', titulo: 'Hablar con soporte',  descripcion: 'Un agente le atenderá en breve'        },
        { id: 'menu_0', titulo: 'Salir',               descripcion: 'Cerrar la conversación'                },
      ],
    }],
  })
}

// ─── Procesador principal ─────────────────────────────────────────────────────

const SALUDO_RE = /^(hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey|hi|saludos|qu[eé]\s+tal|good\s+morning|good\s+afternoon)/i

async function procesarMensaje(telefono, texto) {
  let { estado, datos } = await obtenerSesion(telefono)
  texto = texto.trim()

  // Si el usuario saluda, reiniciar sesión siempre desde el principio
  if (SALUDO_RE.test(texto)) {
    await eliminarSesion(telefono)
    estado = 'INICIO'
    datos  = {}
  }

  // Escape global: "0" o "menu_0" vuelve al menú (o cierra si ya está en él)
  if (texto === '0' || texto === 'menu_0') {
    if (estado === 'ESPERANDO_OPCION' || estado === 'INICIO') {
      await enviarMensaje(telefono, `Hasta pronto. Si necesita algo, escríbanos cuando quiera.`)
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
      await enviarMensaje(telefono, `Bienvenido a *Peluquería Javier*.`)
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
          cabecera: 'Servicios disponibles',
          cuerpo:   '¿Qué servicio necesita hoy?',
          pie:      'Escriba 0 para volver al menú',
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
          await enviarMensaje(telefono, `No tiene citas próximas registradas.`)
        } else {
          let msg = '*Sus próximas citas:*\n\n'
          citas.forEach((c, i) => {
            msg += `*${i + 1}.* ${c.fecha} a las ${c.hora.substring(0, 5)}\n`
            msg += `   Servicio: ${c.servicios.nombre} — ${c.servicios.precio}€\n`
            msg += `   Profesional: ${c.barberos?.nombre || 'Sin asignar'}\n\n`
          })
          await enviarMensaje(telefono, msg.trimEnd())
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else if (op === '3') {
        const citas = await obtenerCitasCliente(telefono)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `No tiene citas pendientes para cancelar.`)
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
          await enviarMenu(telefono)
        } else {
          await enviarLista(telefono, {
            cabecera: 'Cancelar cita',
            cuerpo:   '¿Qué cita desea cancelar?',
            pie:      'Escriba 0 para volver sin cancelar',
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
          `Ha solicitado contactar con soporte.\n\nUn responsable le atenderá a la brevedad posible.\n\nEscriba su consulta a continuación:\n\n_Escriba 0 para volver al menú._`
        )
        await guardarSesion(telefono, 'SOPORTE', {})

      } else {
        await enviarMensaje(telefono, `Por favor seleccione una opción del menú.`)
        await enviarMenu(telefono)
      }
      break
    }

    // ── Soporte ────────────────────────────────────────────────────────────────
    case 'SOPORTE': {
      await enviarMensaje(
        telefono,
        `Su mensaje ha sido recibido. En breve nos ponemos en contacto con usted.`
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
            `En este momento no hay profesionales disponibles para *${servicio}*.`
          )
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
          await enviarMenu(telefono)
          break
        }

        await enviarLista(telefono, {
          cabecera: servicio,
          cuerpo:   '¿Con qué profesional desea su cita?',
          pie:      'Escriba 0 para volver al menú',
          boton:    'Ver profesionales',
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
        await enviarMensaje(telefono, `Por favor seleccione un servicio del menú.`)
        const SERVICIOS2 = await obtenerServicios()
        await enviarLista(telefono, {
          cabecera: 'Servicios disponibles',
          cuerpo:   '¿Qué servicio necesita hoy?',
          pie:      'Escriba 0 para volver al menú',
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

      // Extrae el índice: "barbero_0" → 0  |  "1" → índice 0
      const idx = texto.startsWith('barbero_')
        ? parseInt(texto.replace('barbero_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < barberos.length) {
        const barbero   = barberos[idx]
        const barberoId = barbero.id

        // Próximos 4 días hábiles (sin domingo)
        const hoy = new Date()
        const fechas = []
        let i = 0
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
          cabecera: `${servicio} con ${barbero.nombre}`,
          cuerpo:   'Elija el día que prefiera:',
          pie:      'Escriba 0 para volver al menú',
          boton:    'Ver días',
          secciones: [{
            titulo: 'Próximos 4 días',
            filas: fechas.map((f, j) => {
              const d        = new Date(f + 'T12:00:00')
              const n        = disponibilidad[j].length
              const hayHoras = n > 0
              return {
                id:          `fecha_${j}`,
                titulo:      `${DIAS[d.getDay()]} ${f}`,
                descripcion: hayHoras
                  ? `${n} horario${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`
                  : 'Sin citas disponibles',
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
          barberos,          // guardamos la lista para re-selección desde lista antigua
        })

      } else {
        await enviarMensaje(telefono, `Por favor seleccione un profesional del menú.`)
        await enviarLista(telefono, {
          cabecera: servicio,
          cuerpo:   '¿Con qué profesional desea su cita?',
          pie:      'Escriba 0 para volver al menú',
          boton:    'Ver profesionales',
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
      const { servicio, servicioId, barberoId, barberoNombre, fechasDisponibles, disponibilidad, barberos } = datos

      // El usuario pulsó de nuevo sobre la lista de barberos anterior → re-selección
      if (texto.startsWith('barbero_')) {
        const bidx = parseInt(texto.replace('barbero_', ''))
        if (barberos && bidx >= 0 && bidx < barberos.length) {
          const nuevoBarbero = barberos[bidx]
          const hoy = new Date()
          const fechas = []
          let i = 1
          while (fechas.length < 4) {
            const d = new Date(hoy)
            d.setDate(hoy.getDate() + i)
            if (d.getDay() !== 0) fechas.push(d.toISOString().split('T')[0])
            i++
          }
          const disp = await Promise.all(
            fechas.map(f => obtenerHorasDisponibles(f, servicioId, nuevoBarbero.id))
          )
          await enviarLista(telefono, {
            cabecera: `${servicio} con ${nuevoBarbero.nombre}`,
            cuerpo:   'Elija el día que prefiera:',
            pie:      'Escriba 0 para volver al menú',
            boton:    'Ver días',
            secciones: [{
              titulo: 'Próximos 4 días',
              filas: fechas.map((f, j) => {
                const d = new Date(f + 'T12:00:00')
                const n = disp[j].length
                return {
                  id:          `fecha_${j}`,
                  titulo:      `${DIAS[d.getDay()]} ${f}`,
                  descripcion: n > 0
                    ? `${n} horario${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`
                    : 'Sin citas disponibles',
                }
              }),
            }],
          })
          await guardarSesion(telefono, 'ELIGIENDO_FECHA', {
            servicio, servicioId,
            barberoId:    nuevoBarbero.id,
            barberoNombre: nuevoBarbero.nombre,
            fechasDisponibles: fechas,
            disponibilidad: disp,
            barberos,
          })
        } else {
          await enviarMensaje(telefono, `Por favor seleccione un profesional del menú.`)
        }
        break
      }

      // Extrae el índice: "fecha_2" → 2  |  "1" → índice 0
      const idx = texto.startsWith('fecha_')
        ? parseInt(texto.replace('fecha_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < fechasDisponibles.length) {
        const fecha = fechasDisponibles[idx]

        // Re-consulta horas en el momento de la selección (por si hubo cambios)
        const horasLibres = await obtenerHorasDisponibles(fecha, servicioId, barberoId)

        if (horasLibres.length === 0) {
          await enviarMensaje(telefono, `*${barberoNombre}* ya no tiene horarios disponibles el *${fecha}*.\n\nElija otro día:`)
          await enviarLista(telefono, {
            cabecera: `${servicio} con ${barberoNombre}`,
            cuerpo:   'Elija otro día:',
            pie:      'Escriba 0 para volver al menú',
            boton:    'Ver días',
            secciones: [{
              titulo: 'Próximos 4 días',
              filas: fechasDisponibles.map((f, j) => {
                const d = new Date(f + 'T12:00:00')
                const n = disponibilidad[j]?.length ?? 0
                return {
                  id:          `fecha_${j}`,
                  titulo:      `${DIAS[d.getDay()]} ${f}`,
                  descripcion: n > 0
                    ? `${n} horario${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`
                    : 'Sin citas disponibles',
                }
              }),
            }],
          })
          break
        }

        // WhatsApp permite máx 10 filas en total entre todas las secciones
        const horasLimitadas = horasLibres.slice(0, 10)
        const manana = horasLimitadas.filter(h => parseInt(h.split(':')[0]) < 14)
        const tarde  = horasLimitadas.filter(h => parseInt(h.split(':')[0]) >= 14)
        const horasEnLista = [...manana, ...tarde]

        const secciones = []
        if (manana.length > 0) {
          secciones.push({
            titulo: 'Mañana',
            filas: manana.map((h, j) => ({ id: `hora_${j}`, titulo: h })),
          })
        }
        if (tarde.length > 0) {
          secciones.push({
            titulo: 'Tarde',
            filas: tarde.map((h, j) => ({ id: `hora_${manana.length + j}`, titulo: h })),
          })
        }

        if (secciones.length === 0) {
          await enviarMensaje(telefono, `No se encontraron horarios disponibles el ${fecha}. Elija otro día.`)
          break
        }

        await enviarLista(telefono, {
          cabecera: `${DIAS[new Date(fecha + 'T12:00:00').getDay()]} ${fecha}`,
          cuerpo:   `Horarios disponibles con ${barberoNombre}:`,
          pie:      'Escriba 0 para volver al menú',
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
          // datos del paso anterior para manejar re-selección de lista antigua
          fechasDisponibles,
          disponibilidad,
          barberos,
        })

      } else {
        await enviarMensaje(telefono, `Por favor seleccione un día del menú.`)
        await enviarLista(telefono, {
          cabecera: `${servicio} con ${barberoNombre}`,
          cuerpo:   'Elija el día que prefiera:',
          pie:      'Escriba 0 para volver al menú',
          boton:    'Ver días',
          secciones: [{
            titulo: 'Próximos 4 días',
            filas: fechasDisponibles.map((f, j) => {
              const d        = new Date(f + 'T12:00:00')
              const n        = disponibilidad[j]?.length ?? 0
              const hayHoras = n > 0
              return {
                id:          `fecha_${j}`,
                titulo:      `${DIAS[d.getDay()]} ${f}`,
                descripcion: hayHoras
                  ? `${n} horario${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`
                  : 'Sin citas disponibles',
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

      // El usuario pulsó de nuevo sobre la lista de fechas anterior → volver a elegir hora
      if (texto.startsWith('fecha_')) {
        await guardarSesion(telefono, 'ELIGIENDO_FECHA', datos)
        await procesarMensaje(telefono, texto)
        break
      }

      // Extrae el índice: "hora_3" → 3  |  "1" → índice 0
      const idx = texto.startsWith('hora_')
        ? parseInt(texto.replace('hora_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < horasEnLista.length) {
        const hora = horasEnLista[idx]

        await enviarBotones(
          telefono,
          `*Resumen de su cita:*\n\n` +
          `Servicio: ${servicio}\n` +
          `Profesional: ${barberoNombre}\n` +
          `Fecha: ${fecha}\n` +
          `Hora: ${hora}\n\n` +
          `¿Confirmamos la cita?`,
          [
            { id: 'confirmar_cita', title: 'Confirmar' },
            { id: 'cancelar_cita',  title: 'Cancelar'  },
          ],
          'Peluquería Javier'
        )
        await guardarSesion(telefono, 'CONFIRMANDO_CITA', {
          servicio, servicioId, barberoId, barberoNombre, fecha, hora,
        })

      } else {
        await enviarMensaje(telefono, `Por favor seleccione una hora del menú.`)
        const manana = horasEnLista.filter(h => parseInt(h.split(':')[0]) < 14)
        const tarde  = horasEnLista.filter(h => parseInt(h.split(':')[0]) >= 14)
        const secciones = []
        if (manana.length > 0) {
          secciones.push({
            titulo: 'Mañana',
            filas: manana.map((h, j) => ({ id: `hora_${j}`, titulo: h })),
          })
        }
        if (tarde.length > 0) {
          secciones.push({
            titulo: 'Tarde',
            filas: tarde.map((h, j) => ({ id: `hora_${manana.length + j}`, titulo: h })),
          })
        }
        await enviarLista(telefono, {
          cabecera: `${DIAS[new Date(fecha + 'T12:00:00').getDay()]} ${fecha}`,
          cuerpo:   `Horarios disponibles con ${barberoNombre}:`,
          pie:      'Escriba 0 para volver al menú',
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
            `*Cita confirmada correctamente.*\n\n` +
            `Servicio: ${servicio}\n` +
            `Profesional: ${barberoNombre}\n` +
            `Fecha: ${fecha}\n` +
            `Hora: ${hora}\n\n` +
            `Le esperamos.`
          )
        } else {
          await enviarMensaje(
            telefono,
            `Se produjo un error al guardar la cita. Por favor, inténtelo de nuevo.`
          )
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else if (texto === 'cancelar_cita') {
        await enviarMensaje(telefono, `La cita no ha sido guardada. Puede iniciar el proceso de reserva cuando lo desee.`)
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else {
        await enviarBotones(
          telefono,
          `Por favor pulse uno de los botones para confirmar o cancelar:\n\n` +
          `${servicio} - ${barberoNombre}\n` +
          `${fecha} a las ${hora}`,
          [
            { id: 'confirmar_cita', title: 'Confirmar' },
            { id: 'cancelar_cita',  title: 'Cancelar'  },
          ],
          'Peluquería Javier'
        )
      }
      break
    }

    // ── Cancelando cita (selección) ────────────────────────────────────────────
    case 'CANCELANDO_CITA': {
      const { citasPendientes } = datos

      // Extrae el índice: "cancelar_0" → 0  |  "1" → índice 0
      const idx = texto.startsWith('cancelar_')
        ? parseInt(texto.replace('cancelar_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < citasPendientes.length) {
        const cita = citasPendientes[idx]
        await enviarBotones(
          telefono,
          `¿Confirma que desea cancelar esta cita?\n\n` +
          `Fecha: ${cita.fecha} a las ${cita.hora.substring(0, 5)}\n` +
          `Servicio: ${cita.servicios.nombre}\n` +
          `Profesional: ${cita.barberos?.nombre || 'Sin asignar'}`,
          [
            { id: 'confirmar_cancelacion', title: 'Cancelar cita' },
            { id: 'rechazar_cancelacion',  title: 'Mantener cita' },
          ],
          'Peluquería Javier'
        )
        await guardarSesion(telefono, 'CONFIRMANDO_CANCELACION', { citaACancelar: cita })

      } else {
        await enviarMensaje(telefono, `Por favor seleccione una cita de la lista.`)
      }
      break
    }

    // ── Confirmando cancelación ────────────────────────────────────────────────
    case 'CONFIRMANDO_CANCELACION': {
      const { citaACancelar } = datos

      if (texto === 'confirmar_cancelacion') {
        await cancelarCita(citaACancelar.id)
        await enviarMensaje(
          telefono,
          `*Cita cancelada correctamente:*\n\n` +
          `Fecha: ${citaACancelar.fecha} a las ${citaACancelar.hora.substring(0, 5)}\n` +
          `Servicio: ${citaACancelar.servicios.nombre}\n` +
          `Profesional: ${citaACancelar.barberos?.nombre || 'Sin asignar'}`
        )
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else if (texto === 'rechazar_cancelacion') {
        await enviarMensaje(telefono, `La cita se ha mantenido. No se ha realizado ningún cambio.`)
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        await enviarMenu(telefono)

      } else {
        await enviarBotones(
          telefono,
          `Por favor pulse uno de los botones:\n\n` +
          `Fecha: ${citaACancelar.fecha} a las ${citaACancelar.hora.substring(0, 5)}\n` +
          `Servicio: ${citaACancelar.servicios.nombre}`,
          [
            { id: 'confirmar_cancelacion', title: 'Cancelar cita' },
            { id: 'rechazar_cancelacion',  title: 'Mantener cita' },
          ],
          'Peluquería Javier'
        )
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
