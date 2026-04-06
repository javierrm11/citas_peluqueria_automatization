const supabase = require('../database/db')

// ─── Servicios desde BD ───────────────────────────────────────────────────────

let _serviciosCache    = null
let _serviciosCacheExp = 0
const CACHE_TTL_MS     = 10 * 60 * 1000   // 10 minutos

async function obtenerServicios() {
  if (_serviciosCache && Date.now() < _serviciosCacheExp) return _serviciosCache

  const { data, error } = await supabase
    .from('servicios')
    .select('id, nombre, precio, duracion_minutos')
    .order('id', { ascending: true })

  if (error || !data) {
    console.error('❌ Error obteniendo servicios:', error)
    return _serviciosCache || {}   // devuelve la caché anterior si existe
  }

  _serviciosCache = {}
  data.forEach((s, idx) => {
    _serviciosCache[String(idx + 1)] = {
      id:               s.id,
      nombre:           s.nombre,
      precio:           `${s.precio}€`,
      duracion_minutos: s.duracion_minutos
    }
  })
  _serviciosCacheExp = Date.now() + CACHE_TTL_MS

  return _serviciosCache
}

function invalidarCacheServicios() {
  _serviciosCache    = null
  _serviciosCacheExp = 0
}

// ─── Barberos disponibles para un servicio ────────────────────────────────────

async function obtenerBarberosPorServicio(servicioId) {
  const { data, error } = await supabase
    .from('barbero_servicios')
    .select('barberos(id, nombre)')
    .eq('servicio_id', servicioId)
    .eq('barberos.activo', true)

  if (error || !data) {
    console.error('❌ Error obteniendo barberos:', error)
    return []
  }

  // Filtra nulls (barberos inactivos no devuelven datos)
  return data.map(r => r.barberos).filter(Boolean)
}

// ─── Cliente ──────────────────────────────────────────────────────────────────

async function obtenerOCrearCliente(telefono) {
  const { data: existing } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefono', telefono)
    .single()

  if (existing) return existing

  const { data: nuevo } = await supabase
    .from('clientes')
    .insert({ telefono })
    .select()
    .single()

  return nuevo
}

// ─── Guardar cita ─────────────────────────────────────────────────────────────

async function guardarCita(telefono, servicioId, barberoId, fecha, hora) {
  const cliente = await obtenerOCrearCliente(telefono)

  const { data, error } = await supabase
    .from('citas')
    .insert({
      cliente_id:           cliente.id,
      servicio_id:          servicioId,
      barbero_id:           barberoId,
      fecha,
      hora,
      estado:               'confirmada',
      recordatorio_enviado: false
    })
    .select()
    .single()

  if (error) console.error('❌ Error guardando cita:', error)
  return data
}

// ─── Obtener citas del cliente ────────────────────────────────────────────────

async function obtenerCitasCliente(telefono) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', telefono)
    .single()

  if (!cliente) return []

  const hoy = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('citas')
    .select('id, fecha, hora, servicios(nombre, precio), barberos(nombre)')
    .eq('cliente_id', cliente.id)
    .eq('estado', 'confirmada')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .order('hora',  { ascending: true })

  return data || []
}

// ─── Cancelar cita ────────────────────────────────────────────────────────────

async function cancelarCita(citaId) {
  const { error } = await supabase
    .from('citas')
    .update({ estado: 'cancelada' })
    .eq('id', citaId)

  if (error) console.error('❌ Error cancelando cita:', error)
}

// ─── Helpers de tiempo ────────────────────────────────────────────────────────

function horaAMinutos(hora) {
  const [h, m] = hora.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

function minutosAHora(minutos) {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0')
  const m = (minutos % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function generarSlots(horaInicio, horaFin, duracion) {
  const slots  = []
  const inicio = horaAMinutos(horaInicio)
  const fin    = horaAMinutos(horaFin)
  let   actual = inicio

  while (actual + duracion <= fin) {
    slots.push(minutosAHora(actual))
    actual += duracion
  }

  return slots
}

// ─── Horas disponibles por barbero, servicio y fecha ─────────────────────────

async function obtenerHorasDisponibles(fecha, servicioId, barberoId) {
  // 1. Duración del servicio
  const { data: servicio, error: errServicio } = await supabase
    .from('servicios')
    .select('duracion_minutos')
    .eq('id', servicioId)
    .single()

  if (errServicio || !servicio) {
    console.error('❌ Error obteniendo servicio:', errServicio)
    return []
  }

  const duracion  = servicio.duracion_minutos
  const diaSemana = new Date(fecha + 'T12:00:00').getDay()

  // 2. Franjas horarias del barbero ese día
  const { data: franjas, error: errFranjas } = await supabase
    .from('horarios_barbero')
    .select('hora_inicio, hora_fin')
    .eq('barbero_id', barberoId)
    .eq('dia_semana', diaSemana)
    .eq('activo', true)
    .order('hora_inicio', { ascending: true })

  if (errFranjas || !franjas || franjas.length === 0) return []

  // 3. Generar todos los slots del barbero ese día
  const todosLosSlots = franjas.flatMap(f =>
    generarSlots(f.hora_inicio, f.hora_fin, duracion)
  )

  // 4. Citas ya confirmadas del barbero ese día
  const { data: citasDelDia } = await supabase
    .from('citas')
    .select('hora, servicios(duracion_minutos)')
    .eq('fecha', fecha)
    .eq('barbero_id', barberoId)
    .eq('estado', 'confirmada')

  const ocupados = new Set()

  for (const cita of (citasDelDia || [])) {
    const citaInicio   = horaAMinutos(cita.hora)
    const citaDuracion = cita.servicios?.duracion_minutos || 30
    const citaFin      = citaInicio + citaDuracion

    for (const slot of todosLosSlots) {
      const slotInicio = horaAMinutos(slot)
      const slotFin    = slotInicio + duracion

      if (slotInicio < citaFin && slotFin > citaInicio) {
        ocupados.add(slot)
      }
    }
  }

  return todosLosSlots.filter(slot => !ocupados.has(slot))
}

module.exports = {
  obtenerServicios,
  invalidarCacheServicios,
  obtenerBarberosPorServicio,
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
}