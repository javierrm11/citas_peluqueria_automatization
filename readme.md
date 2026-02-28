## 🛠️ Stack Tecnológico Recomendado

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| API WhatsApp | Meta Cloud API (gratis) | Oficial y estable |
| Backend | Node.js + Express | Rápido para I/O |
| Base de datos | PostgreSQL | Relacional, ideal para citas |
| Sesiones | Redis | Ultra rápido para estados |
| Hosting | Railway / Render | Fácil despliegue |
| Recordatorios | node-cron | Tareas programadas |

---

## 📁 Estructura del Proyecto
```
peluqueria-bot/
├── src/
│   ├── webhook.js          # Recibe mensajes de WhatsApp
│   ├── bot/
│   │   ├── estados.js      # Máquina de estados
│   │   ├── mensajes.js     # Templates de respuestas
│   │   └── validaciones.js
│   ├── servicios/
│   │   ├── citas.js        # CRUD de citas
│   │   ├── whatsapp.js     # Envío de mensajes
│   │   └── recordatorios.js
│   └── db/
│       ├── models/         # Citas, Clientes, Estilistas
│       └── migrations/
├── .env
└── package.json

