const { enviarMensaje, enviarBotones, enviarLista } = require('../services/whatsapp.js')
const {
  obtenerServicios,
  obtenerBarberosPorServicio,
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
  obtenerNombreCliente,
  actualizarNombreCliente,
} = require('../services/citas')
const supabase = require('../database/db')

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ─── Helpers de sesión ────────────────────────────────────────────────────────

async function obtenerSesion(telefono, empresaId) {
  const { data, error } = await supabase
    .from('sesiones')
    .select('estado, datos')
    .eq('telefono', telefono)
    .eq('empresa_id', empresaId)
    .single()

  if (error || !data) return { estado: 'INICIO', datos: {} }
  return { estado: data.estado, datos: data.datos || {} }
}

async function guardarSesion(telefono, estado, datos = {}, empresaId) {
  await supabase
    .from('sesiones')
    .upsert(
      { telefono, empresa_id: empresaId, estado, datos, updated_at: new Date().toISOString() },
      { onConflict: 'telefono,empresa_id' }
    )
}

async function eliminarSesion(telefono, empresaId) {
  await supabase.from('sesiones').delete()
    .eq('telefono', telefono)
    .eq('empresa_id', empresaId)
}

// ─── Menú principal como lista interactiva ────────────────────────────────────

async function enviarMenu(telefono, nombre = null, empresa) {
  const saludo = nombre ? `Hola, ${nombre}. ¿En qué podemos ayudarle?` : '¿En qué podemos ayudarle hoy?'
  await enviarLista(telefono, {
    cabecera: empresa.nombre,
    cuerpo:   saludo,
    pie:      'Escriba 0 en cualquier momento para salir',
    boton:    'Ver opciones',
    secciones: [{
      titulo: 'Gestione su cita',
      filas: [
        { id: 'menu_1', titulo: 'Reservar cita',      descripcion: 'Elija servicio, profesional y horario' },
        { id: 'menu_2', titulo: 'Ver mis citas',       descripcion: 'Consulte sus próximas citas'           },
        { id: 'menu_3', titulo: 'Cancelar cita',       descripcion: 'Cancele una reserva existente'         },
        { id: 'menu_5', titulo: 'Reprogramar cita',    descripcion: 'Cambie la fecha u hora de una cita'    },
        { id: 'menu_4', titulo: 'Hablar con soporte',  descripcion: 'Un agente le atenderá en breve'        },
        { id: 'menu_0', titulo: 'Salir',               descripcion: 'Cerrar la conversación'                },
      ],
    }],
  })
}

// ─── Procesador principal ─────────────────────────────────────────────────────

const SALUDO_RE = /^(hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey|hi|saludos|qu[eé]\s+tal|good\s+morning|good\s+afternoon)/i

async function procesarMensaje(telefono, texto, empresa) {
  const empresaId = empresa.id
  let { estado, datos } = await obtenerSesion(telefono, empresaId)
  texto = texto.trim()

  // Si el usuario saluda, reiniciar sesión siempre desde el principio
  if (SALUDO_RE.test(texto)) {
    await eliminarSesion(telefono, empresaId)
    estado = 'INICIO'
    datos  = {}
  }

  // Nombre del cliente (null si aún no lo ha proporcionado)
  const nombreCliente = await obtenerNombreCliente(telefono, empresaId)

  // Escape global: "0" o "menu_0" vuelve al menú (o cierra si ya está en él)
  if (texto === '0' || texto === 'menu_0') {
    if (estado === 'ESPERANDO_OPCION' || estado === 'INICIO') {
      const despedida = nombreCliente ? `Hasta pronto, ${nombreCliente}.` : `Hasta pronto. Si necesita algo, escríbanos cuando quiera.`
      await enviarMensaje(telefono, despedida)
      await eliminarSesion(telefono, empresaId)
    } else {
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
      await enviarMenu(telefono, nombreCliente, empresa)
    }
    return
  }

  switch (estado) {

    // ── Bienvenida ─────────────────────────────────────────────────────────────
    case 'INICIO': {
      if (!nombreCliente) {
        await enviarMensaje(telefono, `Bienvenido a *${empresa.nombre}*.\n\n¿Cómo se llama? Así podremos atenderle mejor.`)
        await guardarSesion(telefono, 'PIDIENDO_NOMBRE', {}, empresaId)
      } else {
        await enviarMensaje(telefono, `Bienvenido de nuevo, *${nombreCliente}*.`)
        await enviarMenu(telefono, nombreCliente, empresa)
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
      }
      break
    }

    // ── Pedir nombre (primer contacto) ─────────────────────────────────────────
    case 'PIDIENDO_NOMBRE': {
      const nombre = texto.trim()
      if (!nombre || nombre.length < 2 || nombre.length > 50) {
        await enviarMensaje(telefono, `Por favor indique su nombre para continuar.`)
        break
      }
      await actualizarNombreCliente(telefono, nombre, empresaId)
      await enviarMensaje(telefono, `Encantados, *${nombre}*.`)
      await enviarMenu(telefono, nombre, empresa)
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
      break
    }

    // ── Menú principal ─────────────────────────────────────────────────────────
    case 'ESPERANDO_OPCION': {
      // Admite tanto el ID de la lista (menu_1) como texto numérico (1)
      const op = texto === 'menu_1' ? '1'
               : texto === 'menu_2' ? '2'
               : texto === 'menu_3' ? '3'
               : texto === 'menu_4' ? '4'
               : texto === 'menu_5' ? '5'
               : texto

      if (op === '1') {
        const SERVICIOS = await obtenerServicios(empresaId)

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
        }, empresaId)

      } else if (op === '2') {
        const citas = await obtenerCitasCliente(telefono, empresaId)
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
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
        await enviarMenu(telefono, nombreCliente, empresa)

      } else if (op === '3') {
        const citas = await obtenerCitasCliente(telefono, empresaId)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `No tiene citas pendientes para cancelar.`)
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
          await enviarMenu(telefono, nombreCliente, empresa)
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
          await guardarSesion(telefono, 'CANCELANDO_CITA', { citasPendientes: citas }, empresaId)
        }

      } else if (op === '4') {
        await enviarMensaje(
          telefono,
          `Ha solicitado contactar con soporte.\n\nUn responsable le atenderá a la brevedad posible.\n\nEscriba su consulta a continuación:\n\n_Escriba 0 para volver al menú._`
        )
        await guardarSesion(telefono, 'SOPORTE', {}, empresaId)

      } else if (op === '5') {
        const citas = await obtenerCitasCliente(telefono, empresaId)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `No tiene citas próximas para reprogramar.`)
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
          await enviarMenu(telefono, nombreCliente, empresa)
        } else {
          await enviarLista(telefono, {
            cabecera: 'Reprogramar cita',
            cuerpo:   '¿Qué cita desea reprogramar?',
            pie:      'Escriba 0 para volver sin cambios',
            boton:    'Ver mis citas',
            secciones: [{
              titulo: 'Citas confirmadas',
              filas: citas.map((c, i) => ({
                id:          `reprog_${i}`,
                titulo:      `${c.fecha} · ${c.hora.substring(0, 5)}`,
                descripcion: `${c.servicios.nombre} — ${c.barberos?.nombre || 'Sin asignar'}`,
              })),
            }],
          })
          await guardarSesion(telefono, 'REPROGRAMANDO_CITA', { citasPendientes: citas }, empresaId)
        }

      } else {
        await enviarMensaje(telefono, `Por favor seleccione una opción del menú.`)
        await enviarMenu(telefono, nombreCliente, empresa)
      }
      break
    }

    // ── Soporte ────────────────────────────────────────────────────────────────
    case 'SOPORTE': {
      await enviarMensaje(
        telefono,
        `Su mensaje ha sido recibido. En breve nos ponemos en contacto con usted.`
      )
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
      await enviarMenu(telefono, nombreCliente, empresa)
      break
    }

    // ── Eligiendo servicio ─────────────────────────────────────────────────────
    case 'ELIGIENDO_SERVICIO': {
      const SERVICIOS = await obtenerServicios(empresaId)

      // Extrae la clave: "servicio_1" → "1"  |  "1" → "1"
      const clave = texto.startsWith('servicio_') ? texto.replace('servicio_', '') : texto

      if (SERVICIOS[clave]) {
        const servicio   = SERVICIOS[clave].nombre
        const servicioId = SERVICIOS[clave].id
        const barberosRaw = await obtenerBarberosPorServicio(servicioId, empresaId)

        // Próximos 4 días hábiles (sin domingo) para comprobar disponibilidad
        const hoyCheck = new Date()
        const fechasCheck = []
        let ci = 0
        while (fechasCheck.length < 4) {
          const d = new Date(hoyCheck)
          d.setDate(hoyCheck.getDate() + ci)
          if (d.getDay() !== 0) fechasCheck.push(d.toISOString().split('T')[0])
          ci++
        }

        // Filtrar barberos que tengan al menos un hueco en los próximos días
        const barberosDispo = await Promise.all(
          barberosRaw.map(async b => {
            const slots = await Promise.all(
              fechasCheck.map(f => obtenerHorasDisponibles(f, servicioId, b.id))
            )
            return slots.some(s => s.length > 0) ? b : null
          })
        )
        const barberos = barberosDispo.filter(Boolean)

        if (barberos.length === 0) {
          await enviarMensaje(
            telefono,
            `En este momento no hay profesionales disponibles para *${servicio}*.`
          )
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
          await enviarMenu(telefono, nombreCliente, empresa)
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
        await guardarSesion(telefono, 'ELIGIENDO_BARBERO', { servicio, servicioId, barberos }, empresaId)

      } else {
        await enviarMensaje(telefono, `Por favor seleccione un servicio del menú.`)
        const SERVICIOS2 = await obtenerServicios(empresaId)
        await enviarLista(telefono, {
          cabecera: 'Servicios disponibles',
          cuerpo:   '¿Qué servicio necesita hoy ?',
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
          barberos,
        }, empresaId)

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
            barberoId:     nuevoBarbero.id,
            barberoNombre: nuevoBarbero.nombre,
            fechasDisponibles: fechas,
            disponibilidad: disp,
            barberos,
          }, empresaId)
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
          fechasDisponibles,
          disponibilidad,
          barberos,
        }, empresaId)

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
        await guardarSesion(telefono, 'ELIGIENDO_FECHA', datos, empresaId)
        await procesarMensaje(telefono, texto, empresa)
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
          empresa.nombre
        )
        await guardarSesion(telefono, 'CONFIRMANDO_CITA', {
          servicio, servicioId, barberoId, barberoNombre, fecha, hora,
        }, empresaId)

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
        const cita = await guardarCita(telefono, servicioId, barberoId, fecha, hora, empresaId)
        if (cita) {
          const clienteNombre = nombreCliente || telefono

          // Notificación al cliente
          await enviarMensaje(
            telefono,
            `*Cita confirmada correctamente.*\n\n` +
            `Servicio: ${servicio}\n` +
            `Profesional: ${barberoNombre}\n` +
            `Fecha: ${fecha}\n` +
            `Hora: ${hora}\n\n` +
            `Le esperamos.`
          )

          // Obtener teléfono del barbero
          const { data: barberoData } = await supabase
            .from('barberos')
            .select('telefono')
            .eq('id', barberoId)
            .single()

          // Notificación al barbero
          if (barberoData?.telefono) {
            await enviarMensaje(
              barberoData.telefono,
              `*Nueva cita asignada*\n\n` +
              `Cliente: ${clienteNombre}\n` +
              `Servicio: ${servicio}\n` +
              `Fecha: ${fecha}\n` +
              `Hora: ${hora}`
            )
          }

          // Notificación al negocio
          if (empresa.telefono) {
            await enviarMensaje(
              empresa.telefono,
              `*Nueva cita confirmada*\n\n` +
              `Cliente: ${clienteNombre}\n` +
              `Profesional: ${barberoNombre}\n` +
              `Servicio: ${servicio}\n` +
              `Fecha: ${fecha}\n` +
              `Hora: ${hora}`
            )
          }
        } else {
          await enviarMensaje(
            telefono,
            `Se produjo un error al guardar la cita. Por favor, inténtelo de nuevo.`
          )
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
        await enviarMenu(telefono, nombreCliente, empresa)

      } else if (texto === 'cancelar_cita') {
        await enviarMensaje(telefono, `La cita no ha sido guardada. Puede iniciar el proceso de reserva cuando lo desee.`)
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
        await enviarMenu(telefono, nombreCliente, empresa)

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
          empresa.nombre
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
          empresa.nombre
        )
        await guardarSesion(telefono, 'CONFIRMANDO_CANCELACION', { citaACancelar: cita }, empresaId)

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
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
        await enviarMenu(telefono, nombreCliente, empresa)

      } else if (texto === 'rechazar_cancelacion') {
        await enviarMensaje(telefono, `La cita se ha mantenido. No se ha realizado ningún cambio.`)
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {}, empresaId)
        await enviarMenu(telefono, nombreCliente, empresa)

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
          empresa.nombre
        )
      }
      break
    }

    // ── Reprogramando cita ─────────────────────────────────────────────────────
    case 'REPROGRAMANDO_CITA': {
      const { citasPendientes } = datos

      const idx = texto.startsWith('reprog_')
        ? parseInt(texto.replace('reprog_', ''))
        : parseInt(texto) - 1

      if (idx >= 0 && idx < citasPendientes.length) {
        const cita = citasPendientes[idx]

        // Cancelar la cita actual
        await cancelarCita(cita.id)
        await enviarMensaje(
          telefono,
          `Cita del *${cita.fecha}* a las *${cita.hora.substring(0, 5)}* cancelada.\n\nAhora elija una nueva fecha y hora:`
        )

        // Saltar directamente a selección de fecha con el mismo servicio y barbero
        const servicioId    = cita.servicios?.id || cita.servicio_id
        const barberoId     = cita.barberos?.id  || cita.barbero_id
        const servicio      = cita.servicios?.nombre  || ''
        const barberoNombre = cita.barberos?.nombre   || 'Sin asignar'

        const hoy = new Date()
        const fechas = []
        let i = 0
        while (fechas.length < 4) {
          const d = new Date(hoy)
          d.setDate(hoy.getDate() + i)
          if (d.getDay() !== 0) fechas.push(d.toISOString().split('T')[0])
          i++
        }

        const disponibilidad = await Promise.all(
          fechas.map(f => obtenerHorasDisponibles(f, servicioId, barberoId))
        )

        await enviarLista(telefono, {
          cabecera: `${servicio} con ${barberoNombre}`,
          cuerpo:   'Elija el nuevo día:',
          pie:      'Escriba 0 para volver al menú',
          boton:    'Ver días',
          secciones: [{
            titulo: 'Próximos 4 días',
            filas: fechas.map((f, j) => {
              const d = new Date(f + 'T12:00:00')
              const n = disponibilidad[j].length
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
          servicio,
          servicioId,
          barberoId,
          barberoNombre,
          fechasDisponibles: fechas,
          disponibilidad,
          barberos: null,   // no hay lista de barberos (viene de reprogramación)
        }, empresaId)

      } else {
        await enviarMensaje(telefono, `Por favor seleccione una cita de la lista.`)
      }
      break
    }

    // ── Fallback ───────────────────────────────────────────────────────────────
    default: {
      await guardarSesion(telefono, 'INICIO', {}, empresaId)
      await procesarMensaje(telefono, texto, empresa)
    }
  }
}

module.exports = { procesarMensaje }
