const { enviarMensaje, enviarBotones } = require('../services/whatsapp.js')
const {
  obtenerServicios,
  obtenerBarberosPorServicio,
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
} = require('../services/citas')
const supabase = require('../database/db')

const MENU = `─────────────────\n¿Qué deseas hacer ahora?\n\n1. Reservar cita\n2. Ver mis citas\n3. Cancelar cita\n4. Hablar con soporte\n0. Salir`

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

// ─── Procesador principal ─────────────────────────────────────────────────────

async function procesarMensaje(telefono, texto) {
  let { estado, datos } = await obtenerSesion(telefono)
  texto = texto.trim()

  if (texto === '0') {
    if (estado === 'ESPERANDO_OPCION' || estado === 'INICIO') {
      await enviarMensaje(telefono, `Hasta pronto. Si necesita algo, escríbanos cuando quiera.`)
      await eliminarSesion(telefono)
    } else {
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      await enviarMensaje(telefono, MENU)
    }
    return
  }

  switch (estado) {

    case 'INICIO': {
      await enviarMensaje(
        telefono,
        `Bienvenido a *Peluquería Javier*.\n\n` +
        `¿En qué podemos ayudarle?\n\n` +
        `1. Reservar cita\n` +
        `2. Ver mis citas\n` +
        `3. Cancelar cita\n` +
        `4. Hablar con soporte\n` +
        `0. Salir`
      )
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      break
    }

    case 'ESPERANDO_OPCION': {
      if (texto === '1') {
        const SERVICIOS = await obtenerServicios()
        const total     = Object.keys(SERVICIOS).length

        let msg = `Seleccione el servicio que desea:\n\n`
        for (const [key, s] of Object.entries(SERVICIOS)) {
          msg += `${key}. ${s.nombre} - ${s.precio}\n`
        }
        msg += `0. Volver al menú`

        await enviarMensaje(telefono, msg)
        await guardarSesion(telefono, 'ELIGIENDO_SERVICIO', { totalServicios: total })

      } else if (texto === '2') {
        const citas = await obtenerCitasCliente(telefono)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `No tiene citas próximas registradas.\n\n${MENU}`)
        } else {
          let msg = '*Sus próximas citas:*\n\n'
          citas.forEach((c, i) => {
            msg += `${i + 1}. ${c.fecha} a las ${c.hora.substring(0, 5)}\n`
            msg += `   Servicio: ${c.servicios.nombre} - ${c.servicios.precio}€\n`
            msg += `   Profesional: ${c.barberos?.nombre || 'Sin asignar'}\n\n`
          })
          msg += MENU
          await enviarMensaje(telefono, msg)
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})

      } else if (texto === '3') {
        const citas = await obtenerCitasCliente(telefono)
        if (citas.length === 0) {
          await enviarMensaje(telefono, `No tiene citas pendientes para cancelar.\n\n${MENU}`)
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
        } else {
          let msg = '¿Qué cita desea cancelar?\n\n'
          citas.forEach((c, i) => {
            msg += `${i + 1}. ${c.fecha} a las ${c.hora.substring(0, 5)}\n`
            msg += `   ${c.servicios.nombre} - ${c.barberos?.nombre || 'Sin asignar'}\n`
          })
          msg += `\n0. Volver al menú`
          await enviarMensaje(telefono, msg)
          await guardarSesion(telefono, 'CANCELANDO_CITA', { citasPendientes: citas })
        }

      } else if (texto === '4') {
        await enviarMensaje(
          telefono,
          `Ha solicitado contactar con soporte.\n\n` +
          `Un responsable le atenderá a la brevedad posible.\n\n` +
          `Escriba su consulta a continuación:\n\n` +
          `0. Volver al menú`
        )
        await guardarSesion(telefono, 'SOPORTE', {})

      } else {
        await enviarMensaje(
          telefono,
          `Opción no válida. Por favor elija una de las siguientes:\n\n` +
          `1. Reservar cita\n2. Ver mis citas\n3. Cancelar cita\n4. Hablar con soporte\n0. Salir`
        )
      }
      break
    }

    case 'SOPORTE': {
      await enviarMensaje(
        telefono,
        `Su mensaje ha sido recibido. En breve nos ponemos en contacto con usted.\n\n${MENU}`
      )
      await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      break
    }

    case 'ELIGIENDO_SERVICIO': {
      const SERVICIOS          = await obtenerServicios()
      const { totalServicios } = datos

      if (SERVICIOS[texto]) {
        const servicio   = SERVICIOS[texto].nombre
        const servicioId = SERVICIOS[texto].id

        const barberos = await obtenerBarberosPorServicio(servicioId)

        if (barberos.length === 0) {
          await enviarMensaje(
            telefono,
            `En este momento no hay profesionales disponibles para *${servicio}*.\n\n${MENU}`
          )
          await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
          break
        }

        let msg = `¿Con qué profesional desea su *${servicio}*?\n\n`
        barberos.forEach((b, idx) => {
          msg += `${idx + 1}. ${b.nombre}\n`
        })
        msg += `\n0. Volver al menú`

        await enviarMensaje(telefono, msg)
        await guardarSesion(telefono, 'ELIGIENDO_BARBERO', {
          servicio,
          servicioId,
          barberos
        })
      } else {
        await enviarMensaje(
          telefono,
          `Opción no válida. Elija un número del 1 al ${totalServicios}\n\n0. Volver al menú`
        )
      }
      break
    }

    case 'ELIGIENDO_BARBERO': {
      const { servicio, servicioId, barberos } = datos
      const opcionBarbero = parseInt(texto)

      if (opcionBarbero >= 1 && opcionBarbero <= barberos.length) {
        const barbero   = barberos[opcionBarbero - 1]
        const barberoId = barbero.id

        // Generar próximos 4 días sin domingo
        const hoy    = new Date()
        const fechas = []
        let contador = 0
        let i        = 1

        while (contador < 4) {
          const fecha = new Date(hoy)
          fecha.setDate(hoy.getDate() + i)
          if (fecha.getDay() !== 0) {
            fechas.push(fecha.toISOString().split('T')[0])
            contador++
          }
          i++
        }

        // Comprobar disponibilidad de cada fecha
        const disponibilidad = await Promise.all(
          fechas.map(f => obtenerHorasDisponibles(f, servicioId, barberoId))
        )

        const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
        let msg = `Seleccione un día para su *${servicio}* con *${barbero.nombre}*:\n\n`
        fechas.forEach((f, idx) => {
          const d      = new Date(f + 'T12:00:00')
          const sinCitas = disponibilidad[idx].length === 0 ? '   (sin citas disp.)' : ''
          msg += `${idx + 1}. ${dias[d.getDay()]} ${f}${sinCitas}\n`
        })
        msg += `\n0. Volver al menú`

        await enviarMensaje(telefono, msg)
        await guardarSesion(telefono, 'ELIGIENDO_FECHA', {
          servicio,
          servicioId,
          barberoId,
          barberoNombre: barbero.nombre,
          fechasDisponibles: fechas
        })
      } else {
        await enviarMensaje(
          telefono,
          `Opción no válida. Elija un número del 1 al ${barberos.length}\n\n0. Volver al menú`
        )
      }
      break
    }

    case 'ELIGIENDO_FECHA': {
      const opcionFecha = parseInt(texto)
      const { fechasDisponibles, servicio, servicioId, barberoId, barberoNombre } = datos

      if (opcionFecha >= 1 && opcionFecha <= fechasDisponibles.length) {
        const fecha       = fechasDisponibles[opcionFecha - 1]
        const horasLibres = await obtenerHorasDisponibles(fecha, servicioId, barberoId)

        if (horasLibres.length === 0) {
          await enviarMensaje(
            telefono,
            `*${barberoNombre}* no tiene horas disponibles el ${fecha}.\n\nPor favor elija otro día:\n\n0. Volver al menú`
          )
        } else {
          let msg = `Horas disponibles con *${barberoNombre}* el *${fecha}*:\n\n`
          horasLibres.forEach((h, idx) => {
            msg += `${idx + 1}. ${h}\n`
          })
          msg += `\n0. Volver al menú`
          await enviarMensaje(telefono, msg)
          await guardarSesion(telefono, 'ELIGIENDO_HORA', {
            servicio, servicioId, barberoId, barberoNombre, fecha,
            horasDisponibles: horasLibres
          })
        }
      } else {
        await enviarMensaje(
          telefono,
          `Opción no válida. Elija un número del 1 al ${fechasDisponibles.length}\n\n0. Volver al menú`
        )
      }
      break
    }

    case 'ELIGIENDO_HORA': {
      const opcionHora = parseInt(texto)
      const { servicio, servicioId, barberoId, barberoNombre, fecha, horasDisponibles } = datos

      if (opcionHora >= 1 && opcionHora <= horasDisponibles.length) {
        const hora = horasDisponibles[opcionHora - 1]

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
            { id: 'cancelar_cita',  title: 'Cancelar'  }
          ],
          'Peluquería Javier'
        )
        await guardarSesion(telefono, 'CONFIRMANDO_CITA', {
          servicio, servicioId, barberoId, barberoNombre, fecha, hora
        })
      } else {
        await enviarMensaje(
          telefono,
          `Opción no válida. Elija un número del 1 al ${horasDisponibles.length}\n\n0. Volver al menú`
        )
      }
      break
    }

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
            `Le esperamos.\n\n` +
            MENU
          )
        } else {
          await enviarMensaje(
            telefono,
            `Se produjo un error al guardar la cita. Por favor, inténtelo de nuevo.\n\n${MENU}`
          )
        }
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})

      } else if (texto === 'cancelar_cita') {
        await enviarMensaje(
          telefono,
          `La cita no ha sido guardada. Puede iniciar el proceso de reserva cuando lo desee.\n\n${MENU}`
        )
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})

      } else {
        await enviarBotones(
          telefono,
          `Por favor pulse uno de los botones para confirmar o cancelar:\n\n` +
          `${servicio} - ${barberoNombre}\n` +
          `${fecha} a las ${hora}`,
          [
            { id: 'confirmar_cita', title: 'Confirmar' },
            { id: 'cancelar_cita',  title: 'Cancelar'  }
          ],
          'Peluquería Javier'
        )
      }
      break
    }

    case 'CANCELANDO_CITA': {
      const opcionCancelar = parseInt(texto)
      const { citasPendientes } = datos

      if (opcionCancelar >= 1 && opcionCancelar <= citasPendientes.length) {
        const citaACancelar = citasPendientes[opcionCancelar - 1]
        await cancelarCita(citaACancelar.id)
        await enviarMensaje(
          telefono,
          `*Cita cancelada:*\n\n` +
          `Fecha: ${citaACancelar.fecha} a las ${citaACancelar.hora.substring(0, 5)}\n` +
          `Servicio: ${citaACancelar.servicios.nombre}\n` +
          `Profesional: ${citaACancelar.barberos?.nombre || 'Sin asignar'}\n\n` +
          MENU
        )
        await guardarSesion(telefono, 'ESPERANDO_OPCION', {})
      } else {
        await enviarMensaje(
          telefono,
          `Opción no válida. Elija un número del 1 al ${citasPendientes.length}\n\n0. Volver al menú`
        )
      }
      break
    }

    default: {
      await guardarSesion(telefono, 'INICIO', {})
      await procesarMensaje(telefono, texto)
    }
  }
}

module.exports = { procesarMensaje }
