# 💈 Peluquería Bot — WhatsApp Chatbot

Bot de WhatsApp para gestión automática de citas de peluquería. Construido con Node.js, Meta WhatsApp Business API y Supabase.

---

## 📋 Requisitos previos

- [Node.js](https://nodejs.org) v18 o superior
- Cuenta en [Meta for Developers](https://developers.facebook.com)
- Cuenta en [Supabase](https://supabase.com)
- [ngrok](https://ngrok.com) (solo para desarrollo local)

---

## 🗂️ Estructura del proyecto

```
peluqueria-bot/
├── src/
│   ├── bot/
│   │   └── estados.js          # Máquina de estados / lógica de conversación
│   ├── services/
│   │   ├── whatsapp.js         # Envío de mensajes por WhatsApp
│   │   └── citas.js            # Gestión de citas (CRUD)
│   ├── database/
│   │   └── db.js               # Conexión a Supabase
│   └── webhook.js              # Recepción de mensajes entrantes
├── .env                        # Variables de entorno (no subir a GitHub)
├── .gitignore
└── index.js                    # Punto de entrada
```

---

## ⚙️ Instalación

```bash
# 1. Clona o descarga el proyecto
git clone https://github.com/tu-usuario/peluqueria-bot.git
cd peluqueria-bot

# 2. Instala las dependencias
npm install
```

---

## 🔐 Variables de entorno

Crea un archivo `.env` en la raíz del proyecto con los siguientes valores:

```env
# Servidor
PORT=3000

# Meta WhatsApp Business API
VERIFY_TOKEN=peluqueria_bot_2024
ACCESS_TOKEN=tu_access_token_de_meta
PHONE_NUMBER_ID=tu_phone_number_id

# Supabase
SUPABASE_URL=https://XXXX.supabase.co
SUPABASE_KEY=tu_service_role_key
```

### Dónde obtener cada variable

| Variable | Dónde encontrarla |
|---|---|
| `VERIFY_TOKEN` | La inventas tú — debe coincidir con la que pongas en Meta |
| `ACCESS_TOKEN` | Meta Developers → Tu App → WhatsApp → Configuración de la API |
| `PHONE_NUMBER_ID` | Meta Developers → Tu App → WhatsApp → Configuración de la API |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_KEY` | Supabase → Settings → API → service_role key |

> ⚠️ **Nunca subas el `.env` a GitHub.** Asegúrate de que está en el `.gitignore`.

---

## 🗄️ Base de datos — Supabase

Ejecuta este SQL en **Supabase → SQL Editor**:

```sql
CREATE TABLE clientes (
  id SERIAL PRIMARY KEY,
  telefono VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE servicios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL,
  precio DECIMAL(10,2),
  duracion_minutos INT
);

INSERT INTO servicios (nombre, precio, duracion_minutos) VALUES
  ('Corte', 15.00, 30),
  ('Tinte', 40.00, 90),
  ('Barba', 10.00, 20),
  ('Corte + Barba', 22.00, 50);

CREATE TABLE citas (
  id SERIAL PRIMARY KEY,
  cliente_id INT REFERENCES clientes(id),
  servicio_id INT REFERENCES servicios(id),
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  estado VARCHAR(20) DEFAULT 'confirmada',
  recordatorio_enviado BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🚀 Desarrollo local

### Paso 1 — Arranca el servidor

```bash
npm run dev
```

Deberías ver:
```
🚀 Servidor corriendo en puerto 3000
✅ Conectado a Supabase
```

### Paso 2 — Expón el puerto con ngrok

```bash
ngrok http 3000
```

Copia la URL que te da ngrok:
```
https://XXXX.ngrok-free.app
```

### Paso 3 — Configura el Webhook en Meta

En **Meta Developers → Tu App → WhatsApp → Configuración → Webhook**:

```
URL de devolución de llamada:  https://XXXX.ngrok-free.app/webhook
Token de verificación:         peluqueria_bot_2024
```

Clic en **Verificar y guardar**. En tu terminal verás:
```
✅ Webhook verificado!
```

### Paso 4 — Suscríbete a los eventos

En la sección de Webhook, activa:
- ✅ `messages`

---

## 🌐 Producción — Deploy en Render

### Paso 1 — Sube el código a GitHub

```bash
git init
git add .
git commit -m "primer commit"
git push origin main
```

### Paso 2 — Crea el servicio en Render

1. Ve a [render.com](https://render.com) → **New → Web Service**
2. Conecta tu repositorio de GitHub
3. Configura:

```
Build Command:  npm install
Start Command:  node index.js
```

### Paso 3 — Añade las variables de entorno

En **Environment** añade todas las variables de tu `.env`.

### Paso 4 — Actualiza el Webhook en Meta

Cambia la URL del webhook por la que te da Render:
```
https://peluqueria-bot.onrender.com/webhook
```

### Paso 5 — Evita que el servidor se duerma (plan gratuito)

1. Ve a [uptimerobot.com](https://uptimerobot.com)
2. **Add New Monitor** → tipo **HTTP(s)**
3. URL: `https://peluqueria-bot.onrender.com/webhook`
4. Intervalo: **5 minutos**

---

## 💬 Flujo de conversación

```
Cliente: "Hola"
Bot: Menú principal (Reservar / Ver citas / Cancelar)

1️⃣ Reservar cita:
   → Elige servicio → Elige día → Elige hora → Confirmación

2️⃣ Ver mis citas:
   → Lista de citas próximas confirmadas

3️⃣ Cancelar cita:
   → Lista de citas → Elige cuál cancelar → Confirmación
```

---

## 🛠️ Scripts disponibles

```bash
npm run dev    # Desarrollo con nodemon (reinicio automático)
npm start      # Producción
```

---

## 📦 Dependencias

| Paquete | Versión | Uso |
|---|---|---|
| express | ^4.x | Servidor web |
| axios | ^1.x | Peticiones HTTP a Meta API |
| dotenv | ^17.x | Variables de entorno |
| @supabase/supabase-js | ^2.x | Cliente de Supabase |
| nodemon | ^3.x | Recarga automática en desarrollo |

---

## 🔑 Token de acceso permanente (Meta)

El token temporal dura 24 horas. Para obtener uno permanente:

1. Ve a [business.facebook.com](https://business.facebook.com)
2. **Configuración → Usuarios → Usuarios del sistema**
3. **Agregar** → nombre: `bot-peluqueria` → rol: Administrador
4. **Generar token de acceso** → selecciona tu app
5. Activa permisos: `whatsapp_business_messaging` y `whatsapp_business_management`
6. Copia el token y actualiza `ACCESS_TOKEN` en tu `.env`

---

## ⚠️ Notas importantes

- El bot solo puede enviar mensajes a números autorizados en modo de prueba
- Para enviar mensajes a cualquier número necesitas publicar la app en Meta
- Las sesiones de conversación se guardan en memoria — si el servidor se reinicia se pierden
- Las citas se guardan en Supabase y persisten siempre

---

## 📄 Licencia

MIT