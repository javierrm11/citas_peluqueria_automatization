const axios = require('axios')

const BASE_URL = `https://graph.facebook.com/v22.0`

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
      {
        headers: {
          'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    console.log(`✅ Mensaje enviado a ${telefono}`)
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.response?.data)
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
      {
        headers: {
          'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    console.log(`✅ Plantilla enviada a ${telefono}`)
  } catch (error) {
    console.error('❌ Error enviando plantilla:', error.response?.data)
  }
}

module.exports = { enviarMensaje, enviarPlantilla }
