const axios = require('axios')

const BASE_URL = `https://graph.facebook.com/v22.0`

const headers = {
  'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
}

// Para RESPONDER mensajes del cliente (texto libre)
async function enviarMensaje(telefono, texto) {
  try {
    await axios.post(
      `${BASE_URL}/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: { body: texto }
      },
      { headers }
    )
    console.log(`✅ Mensaje enviado a ${telefono}`)
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.response?.data)
  }
}

// Para confirmación de cita con botones (máx. 3 botones)
// botones: [{ id: 'confirmar', title: '✅ Confirmar' }, { id: 'cancelar', title: '❌ Cancelar' }]
async function enviarBotones(telefono, cuerpo, botones, pie = '') {
  try {
    await axios.post(
      `${BASE_URL}/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: cuerpo },
          ...(pie && { footer: { text: pie } }),
          action: {
            buttons: botones.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title }
            }))
          }
        }
      },
      { headers }
    )
    console.log(`✅ Botones enviados a ${telefono}`)
  } catch (error) {
    console.error('❌ Error enviando botones:', error.response?.data)
  }
}

// Para INICIAR conversación (recordatorios, confirmaciones)
async function enviarPlantilla(telefono, plantilla = 'hello_world', idioma = 'en_US') {
  try {
    await axios.post(
      `${BASE_URL}/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'template',
        template: {
          name: plantilla,
          language: { code: idioma }
        }
      },
      { headers }
    )
    console.log(`✅ Plantilla enviada a ${telefono}`)
  } catch (error) {
    console.error('❌ Error enviando plantilla:', error.response?.data)
  }
}

module.exports = { enviarMensaje, enviarBotones, enviarPlantilla }