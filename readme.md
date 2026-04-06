# 💈 Bot de WhatsApp — Peluquería Javier

Bot de WhatsApp desarrollado en Node.js que permite a los clientes gestionar sus citas de forma automática mediante un flujo conversacional sencillo.

---

## 🚀 Funcionalidades implementadas

### Gestión de citas
- 📅 Reservar una cita paso a paso (servicio → barbero → fecha → hora → confirmación)
- 👀 Ver citas próximas confirmadas
- ❌ Cancelar una cita existente
- 💬 Contactar con soporte humano

### Flujo inteligente de reserva
- Selección de **servicio** desde catálogo dinámico (cargado desde Supabase)
- Selección de **barbero** filtrado por servicio y activo
- Selección de **fecha** — próximos 4 días hábiles (sin domingos), con indicador 🔴 si no hay horas disponibles
- Selección de **hora** con paginación (9 horas por página, escribe `más` para ver más)
- **Confirmación con botones interactivos** (✅ Confirmar / ❌ Cancelar) via WhatsApp Interactive API

### Disponibilidad real
- Los slots de hora se calculan a partir de los **horarios configurados por barbero** (`horarios_barbero`)
- Se descuentan automáticamente las citas ya confirmadas evitando solapamientos
- La duración del servicio se tiene en cuenta al bloquear huecos

### Sesiones persistentes
- Las sesiones se guardan en Supabase (tabla `sesiones`) — **no se pierden al reiniciar el servidor**
- Cada usuario mantiene su estado y datos entre mensajes

### Recordatorios automáticos
- Cron diario a las **9:00 (Europe/Madrid)** que envía un recordatorio 24h antes de cada cita
- Filtra solo citas `confirmadas` con `recordatorio_enviado = false`
- Marca `recordatorio_enviado = true` tras el envío para evitar duplicados

### Navegación
- `0` desde el menú principal → despedida y cierre de sesión
- `0` desde cualquier otro estado → vuelve al menú principal

---

## 🏗️ Estructura del proyecto

```
bot/
├── index.js                    # Entrada: Express + cron de recordatorios
├── src/
│   ├── webhook.js              # Recibe y enruta mensajes de WhatsApp
│   ├── bot/
│   │   ├── estados.js          # Máquina de estados — lógica principal del bot
│   │   └── recordatorios.js    # Cron de recordatorios automáticos
│   ├── services/
│   │   ├── citas.js            # CRUD de citas, slots, barberos, servicios
│   │   └── whatsapp.js         # Envío de mensajes, botones y plantillas
│   └── database/
│       └── db.js               # Cliente Supabase
```

---

## 🧠 Máquina de estados

| Estado | Descripción |
|--------|-------------|
| `INICIO` | Primer contacto — muestra el menú de bienvenida |
| `ESPERANDO_OPCION` | Menú principal (1-4 + 0) |
| `ELIGIENDO_SERVICIO` | El usuario elige qué servicio quiere |
| `ELIGIENDO_BARBERO` | El usuario elige con qué barbero |
| `ELIGIENDO_FECHA` | El usuario elige el día (próximos 4 días hábiles) |
| `ELIGIENDO_HORA` | El usuario elige la hora disponible |
| `CONFIRMANDO_CITA` | Resumen + botones de confirmar / cancelar |
| `CANCELANDO_CITA` | Lista de citas para cancelar |
| `SOPORTE` | Mensaje libre que queda registrado |

---

## 🔧 Servicios y funciones clave

### `estados.js` — `procesarMensaje(telefono, texto)`
Función principal. Lee el estado de la sesión desde Supabase, procesa la respuesta del usuario y avanza al siguiente estado.

### `citas.js`
| Función | Descripción |
|---------|-------------|
| `obtenerServicios()` | Catálogo desde BD con cache en memoria |
| `invalidarCacheServicios()` | Fuerza recarga del catálogo |
| `obtenerBarberosPorServicio(servicioId)` | Barberos activos para un servicio |
| `obtenerOCrearCliente(telefono)` | Upsert de cliente por teléfono |
| `guardarCita(...)` | Inserta cita en estado `confirmada` |
| `obtenerCitasCliente(telefono)` | Citas futuras confirmadas del cliente |
| `cancelarCita(citaId)` | Pone estado `cancelada` |
| `obtenerHorasDisponibles(fecha, servicioId, barberoId)` | Calcula slots libres restando citas existentes |

### `whatsapp.js`
| Función | Descripción |
|---------|-------------|
| `enviarMensaje(telefono, texto)` | Mensaje de texto libre |
| `enviarBotones(telefono, cuerpo, botones, pie)` | Mensaje interactivo con hasta 3 botones |
| `enviarPlantilla(telefono, plantilla, idioma)` | Plantilla aprobada por Meta (para iniciar conversación) |

### `recordatorios.js`
| Función | Descripción |
|---------|-------------|
| `iniciarRecordatorios()` | Lanza el cron diario a las 9:00 |
| `enviarRecordatorios()` | Obtiene citas de mañana y envía mensajes |

---

## 🗄️ Tablas de Supabase utilizadas

| Tabla | Descripción |
|-------|-------------|
| `clientes` | `id`, `telefono` |
| `servicios` | `id`, `nombre`, `precio`, `duracion_minutos` |
| `barberos` | `id`, `nombre`, `activo` |
| `barbero_servicios` | Relación N:M barbero ↔ servicio |
| `horarios_barbero` | `barbero_id`, `dia_semana` (1=Lun…6=Sáb), `hora_inicio`, `hora_fin`, `activo` |
| `citas` | `cliente_id`, `servicio_id`, `barbero_id`, `fecha`, `hora`, `estado`, `recordatorio_enviado` |
| `sesiones` | `telefono`, `estado`, `datos` (JSONB), `updated_at` |

---

## 📦 Variables de entorno

Crea un archivo `.env` en la raíz del bot con:

```env
# WhatsApp Cloud API (Meta)
ACCESS_TOKEN=         # Token de acceso permanente
PHONE_NUMBER_ID=      # ID del número de WhatsApp
VERIFY_TOKEN=         # Token que defines tú para verificar el webhook

# Supabase
SUPABASE_URL=         # URL del proyecto Supabase
SUPABASE_KEY=         # anon key o service_role key (para saltar RLS en cron)
```

---

## 🛠️ Instalación y arranque

```bash
cd bot
npm install
node index.js
```

El servidor arranca en el puerto `3000` (o el que definas en `PORT`).

Para exponer el webhook en local durante desarrollo:
```bash
npx ngrok http 3000
# Luego configura la URL en Meta Developer Console → Webhooks
```

---

## 🔄 Flujo completo de reserva

```
Usuario: "Hola"
  → Menú principal

Usuario: "1" (Reservar)
  → Lista de servicios (desde BD)

Usuario: "1" (Corte)
  → Lista de barberos que realizan ese servicio

Usuario: "2" (Carlos)
  → Próximos 4 días con indicador de disponibilidad

Usuario: "1" (Lunes)
  → Horas disponibles paginadas (máx 9, escribe "más" para ver más)

Usuario: "3" (11:00)
  → Resumen + botones [✅ Confirmar] [❌ Cancelar]

Usuario: pulsa "Confirmar"
  → Cita guardada en Supabase ✅
  → Mensaje de confirmación con todos los datos
```

---

## ⚠️ Manejo de errores

- Opciones inválidas → aviso y repetición del paso actual
- Días sin disponibilidad → marcados como 🔴 Sin horas
- Error al guardar la cita → mensaje de error y vuelta al menú
- Cancelación incorrecta → solicita opción válida
- Barbero sin servicios → aviso y vuelta al menú

---

## 🐛 Bugs conocidos / Deuda técnica

| Problema | Estado |
|----------|--------|
| Cache de servicios sin TTL — cambios en el admin no se reflejan hasta reiniciar | ⬜ Pendiente |
| Rate limiting por teléfono — un usuario puede spamear el webhook | ⬜ Pendiente |
| Sin validación de que la hora elegida no sea pasada (reservas en el día de hoy) | ⬜ Pendiente |

---

## 🗺️ Próximas mejoras

### 🔴 Alta prioridad


#### Rate limiting por teléfono
Sin límite, un usuario puede enviar miles de mensajes y saturar el bot o la API de WhatsApp.
- Middleware simple con un `Map` en memoria: máx. 10 mensajes por número cada 60 segundos.

---

### 🟠 Importante


#### Nombre del cliente en el onboarding
La tabla `clientes` solo guarda `telefono`. En el primer contacto, preguntar el nombre y guardarlo.
- Añadir campo `nombre` a `clientes`.
- Estado `PIDIENDO_NOMBRE` tras el `INICIO` si el cliente no tiene nombre guardado.
- Personalizar todos los mensajes: `"¡Hola, Miguel! ¿Qué deseas hacer?"`

#### Notificación al barbero al confirmar una cita
Cuando un cliente confirma una cita, enviar un WhatsApp al barbero asignado.
- Añadir campo `telefono` a la tabla `barberos`.
- En `guardarCita()`, tras insertar, llamar a `enviarMensaje(barbero.telefono, resumen)`.

---

### 🟡 Mejoras de UX


#### Mensaje de bienvenida diferente para clientes recurrentes
Si el cliente ya tiene citas previas, personalizar el saludo:
```
"¡Hola de nuevo, Miguel! ¿Volvemos a ponerte guapo? 😄"
```

---

### 🟢 Futuro / IA

#### Comprensión de lenguaje natural
Integrar Claude Haiku (API de Anthropic) para interpretar texto libre antes de entrar al flujo de estados:
```
Usuario: "quiero cortarme mañana por la mañana con javier"
→ Extrae: servicio=Corte, fecha=mañana, preferencia=mañana, barbero=Javier
→ Salta directamente al paso de confirmar hora
```
- Reducir la fricción del menú numérico para usuarios habituales.
- El flujo estructurado sigue siendo el fallback para casos ambiguos.

#### Bloqueos y vacaciones
Nueva tabla `bloqueos` con `barbero_id`, `fecha_inicio`, `fecha_fin`, `motivo`.
- El bot excluye esas fechas al mostrar disponibilidad.
- El admin puede configurarlos desde el panel.

---

## 👨‍💻 Autor

Desarrollado para automatizar la gestión de citas de Peluquería Javier y mejorar la experiencia del cliente vía WhatsApp.
