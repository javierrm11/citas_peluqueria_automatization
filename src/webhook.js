const express = require("express");
const router = express.Router();
const { procesarMensaje } = require("./bot/estados");

// ─── Rate limiting por teléfono ───────────────────────────────────────────────
const MAX_MENSAJES  = 10
const VENTANA_MS    = 60_000   // 60 segundos
const _rateLimitMap = new Map()

function excedeLimite(telefono) {
  const ahora = Date.now()
  let registro = _rateLimitMap.get(telefono)

  if (!registro || ahora - registro.inicio >= VENTANA_MS) {
    registro = { inicio: ahora, count: 0 }
  }

  registro.count++
  _rateLimitMap.set(telefono, registro)
  return registro.count > MAX_MENSAJES
}

// Limpieza periódica para no acumular entradas de números inactivos
setInterval(() => {
  const ahora = Date.now()
  for (const [tel, reg] of _rateLimitMap) {
    if (ahora - reg.inicio >= VENTANA_MS) _rateLimitMap.delete(tel)
  }
}, VENTANA_MS)

// Verificación del webhook
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recibir mensajes
router.post("/", async (req, res) => {
  try {
    const body = req.body;
    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (messages?.[0]) {
        const msg = messages[0];
        const telefono = msg.from;

        if (excedeLimite(telefono)) {
          console.warn(`⚠️ Rate limit alcanzado para ${telefono}`)
          return res.sendStatus(200)
        }

        let texto = ""
        if (msg.type === "interactive") {
          texto =
            msg.interactive.button_reply?.id ||
            msg.interactive.list_reply?.id   ||
            ""
        } else {
          texto = msg.text?.body || ""
        }

        console.log(`📩 Mensaje de ${telefono}: ${texto}`);
        await procesarMensaje(telefono, texto);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error);
    res.sendStatus(500);
  }
});

module.exports = router;
