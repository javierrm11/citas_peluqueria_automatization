const axios = require('axios')

const BASE_URL = `https://graph.facebook.com/v22.0`

const headers = {
  'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function limitarTexto(valor, max) {
  const texto = normalizarTexto(valor)
  if (texto.length <= max) return texto
  return `${texto.slice(0, Math.max(0, max - 1)).trimEnd()}…`
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
    console.log(`Mensaje enviado a ${telefono}`)
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

// Lista interactiva (menús de opciones)
// secciones: [{ titulo, filas: [{ id, titulo, descripcion? }] }]
async function enviarLista(telefono, { cabecera, cuerpo, pie, boton, secciones }) {
  const seccionesSeguras = (secciones || [])
    .map(s => ({
      title: limitarTexto(s.titulo, 24),
      rows: (s.filas || [])
        .filter(f => f && f.id && f.titulo)
        .map(f => ({
          id: limitarTexto(f.id, 200),
          title: limitarTexto(f.titulo, 24),
          ...(f.descripcion && { description: limitarTexto(f.descripcion, 72) }),
        })),
    }))
    .filter(s => s.title && s.rows.length > 0)

  const payload = {
    messaging_product: 'whatsapp',
    to: telefono,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(cabecera && { header: { type: 'text', text: limitarTexto(cabecera, 60) } }),
      body: { text: limitarTexto(cuerpo, 1024) },
      ...(pie && { footer: { text: limitarTexto(pie, 60) } }),
      action: {
        button: limitarTexto(boton, 20),
        sections: seccionesSeguras,
      },
    },
  }
  try {
    await axios.post(`${BASE_URL}/${process.env.PHONE_NUMBER_ID}/messages`, payload, { headers })
    console.log(`✅ Lista enviada a ${telefono}`)
  } catch (error) {
    console.error('❌ Error enviando lista:', error.response?.data)
  }
}

module.exports = { enviarMensaje, enviarBotones, enviarPlantilla, enviarLista }