const cron = require('node-cron')
const { createClient } = require('@supabase/supabase-js')
const { enviarMensaje } = require('../services/whatsapp')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

/**
 * Obtiene todas las citas cuya fecha sea mañana
 */
async function obtenerCitasManana() {
  const manana = new Date()
  manana.setDate(manana.getDate() + 1)
  const fechaManana = manana.toISOString().split('T')[0] // "YYYY-MM-DD"

  const { data, error } = await supabase
    .from('citas')
    .select('id, fecha, hora, servicios(nombre, precio), clientes(telefono)')
    .eq('fecha', fechaManana)
  if (error) {
    console.error('[Recordatorios] Error al consultar citas:', error.message)
    return []
  }

  return data
}

/**
 * Envía un recordatorio de WhatsApp a cada cliente
 */
async function enviarRecordatorios() {
  console.log('[Recordatorios] Ejecutando envío de recordatorios...')

  const citas = await obtenerCitasManana()

  if (citas.length === 0) {
    console.log('[Recordatorios] No hay citas para mañana.')
    return
  }

  for (const cita of citas) {
    const hora = cita.hora.substring(0, 5)
    const mensaje =
      `🔔 *Recordatorio de tu cita*\n\n` +
      `Hola, te recordamos que mañana tienes cita en *Peluquería Javier*:\n\n` +
      `💈 Servicio: ${cita.servicios.nombre} - ${cita.servicios.precio}€\n` +
      `📅 Fecha: ${cita.fecha}\n` +
      `🕐 Hora: ${hora}\n\n` +
      `Si necesitas cancelar, escríbenos con antelación. ¡Hasta mañana! 😊`

    try {
      await enviarMensaje(cita.clientes.telefono, mensaje)
      console.log(`[Recordatorios] Enviado a ${cita.clientes.telefono} — cita ${cita.id}`)
    } catch (err) {
      console.error(`[Recordatorios] Error al enviar a ${cita.clientes.telefono}:`, err.message)
    }
  }

  console.log(`[Recordatorios] ${citas.length} recordatorio(s) enviado(s).`)
}

/**
 * Inicia el cron: se ejecuta cada día a las 10:00
 * Cambia "0 10 * * *" por la hora que prefieras
 *
 * Formato: segundo(opc) minuto hora día mes díaSemana
 * Ejemplos:
 *   "0 10 * * *"  → todos los días a las 10:00
 *   "0 19 * * *"  → todos los días a las 19:00
 */
function iniciarRecordatorios() {
cron.schedule('0 9 * * *', async () => {
    await enviarRecordatorios()
}, {
    timezone: 'Europe/Madrid'
})
  console.log('[Recordatorios] Cron iniciado — recordatorios diarios a las 9:00 (Europe/Madrid)')
}

module.exports = { iniciarRecordatorios }