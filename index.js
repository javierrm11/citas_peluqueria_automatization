require('dotenv').config()
const { iniciarRecordatorios } = require('./src/bot/recordatorios')
iniciarRecordatorios()
const express = require('express')
const app = express()
app.use(express.json())

// Rutas
const webhook = require('./src/webhook')
app.use('/webhook', webhook)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`))