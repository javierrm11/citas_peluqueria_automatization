# 💈 Bot de WhatsApp para Gestión de Citas – Peluquería Javier

Este proyecto es un bot de WhatsApp desarrollado en Node.js que permite a los clientes gestionar sus citas de forma automática.

## 🚀 Funcionalidades

El bot permite a los usuarios:

- 📅 Reservar una cita
- 👀 Ver sus citas próximas
- ❌ Cancelar una cita
- 💬 Hablar con soporte

Todo mediante un flujo conversacional sencillo dentro de WhatsApp.

## 🧠 Cómo funciona

El bot utiliza un sistema de sesiones por usuario (teléfono) para mantener el estado de la conversación.

Cada usuario pasa por distintos estados:

- `INICIO`
- `ESPERANDO_OPCION`
- `ELIGIENDO_SERVICIO`
- `ELIGIENDO_FECHA`
- `ELIGIENDO_HORA`
- `CANCELANDO_CITA`
- `SOPORTE`

Esto permite guiar al usuario paso a paso sin perder contexto.

## 🏗️ Estructura del proyecto

```
/services
  ├── whatsapp.js        # Envío de mensajes
  ├── citas.js           # Lógica de citas (CRUD)

procesarMensaje.js       # Lógica principal del bot
recordatorios.js         # Recordatorios automáticos (cron)
```

## 📦 Dependencias principales

- Node.js
- Sistema de envío de WhatsApp (API tipo WhatsApp Cloud / Twilio / Baileys)
- `@supabase/supabase-js` — base de datos
- `node-cron` — recordatorios automáticos

## 🔧 Funciones clave

### 📩 `procesarMensaje(telefono, texto)`

Función principal que gestiona todo el flujo del bot.

- Detecta el estado del usuario
- Procesa su respuesta
- Devuelve el siguiente mensaje

### 📅 Servicios de citas

Importados desde `services/citas.js`:

- `guardarCita()`
- `obtenerCitasCliente()`
- `cancelarCita()`
- `obtenerHorasDisponibles()`
- `SERVICIOS` (catálogo de servicios)

### 💬 Servicio de WhatsApp

Desde `services/whatsapp.js`:

- `enviarMensaje(telefono, mensaje)`

### 🔔 Recordatorios automáticos

Desde `recordatorios.js`:

- `iniciarRecordatorios()` — lanza un cron diario a las 15:20 (Europe/Madrid)
- Consulta en Supabase las citas del día siguiente
- Envía un mensaje de recordatorio a cada cliente por WhatsApp

Activar en `index.js`:

```js
const { iniciarRecordatorios } = require('./recordatorios')
iniciarRecordatorios()
```

## ✂️ Servicios disponibles

```
1️⃣ Corte       - 15€
2️⃣ Tinte       - 40€
3️⃣ Barba       - 10€
4️⃣ Corte+Barba - 22€
```

## 🔄 Flujo de reserva

1. Usuario escribe cualquier mensaje
2. Bot muestra menú principal
3. Usuario elige "Reservar cita"
4. Selecciona servicio
5. Selecciona fecha disponible
6. Selecciona hora
7. Se guarda la cita en el sistema

## 🔄 Navegación

- `0` desde el menú principal → despedida y cierre de sesión
- `0` desde cualquier otro estado → vuelve al menú principal sin perder sesión

## 📆 Lógica de fechas

- Se generan automáticamente los próximos 4 días disponibles
- Se excluyen los domingos
- Se muestran en formato simple para el usuario

## ⚠️ Manejo de errores

El bot controla:

- Opciones inválidas
- Días sin disponibilidad
- Errores al guardar citas
- Cancelaciones incorrectas

## 🧪 Ejemplo de uso

**Usuario:**

```
Hola
```

**Bot:**

```
👋 ¡Hola! Bienvenido a Peluquería Javier

¿Qué deseas hacer?

1️⃣ Reservar cita
2️⃣ Ver mis citas
3️⃣ Cancelar cita
4️⃣ Hablar con soporte
0️⃣ Salir
```

## 🧠 Posibles mejoras

- ✅ Recordatorios automáticos (24h antes)
- ✅ Opción de soporte / contacto directo
- ✅ Confirmación por botón (no solo texto)
- ⬜ Integración con Google Calendar
- ⬜ Panel admin (dashboard)
- ✅ Horarios personalizados por servicio
- ✅ Multi-empleado (varios barberos)
- ⬜ IA para entender texto libre ("quiero cortarme mañana")
- ⬜ 3️⃣ Mié 2026-04-08 si no hay citas dispoibles que ponga lleno

## 📌 Notas

- Las sesiones se guardan en memoria (`objeto sesiones`), por lo que:
  - ❗ Se pierden si reinicias el servidor
  - 👉 Recomendado: usar Redis o base de datos
- Los recordatorios usan `SUPABASE_SERVICE_ROLE_KEY` para saltarse las RLS policies

## 🛠️ Instalación

```bash
npm install
node index.js
```

## 👨‍💻 Autor

Desarrollado para automatizar la gestión de citas de peluquería y mejorar la experiencia del cliente.