const supabase = require('../database/db')

// ─── Servicios desde BD ───────────────────────────────────────────────────────

// Cache en memoria para no consultar en cada mensaje
let _serviciosCache = null

async function obtenerServicios() {
  if (_serviciosCache) return _serviciosCache

  const { data, error } = await supabase
    .from('servicios')
    .select('id, nombre, precio, duracion_minutos')
    .order('id', { ascending: true })

  if (error || !data) {
    console.error('❌ Error obteniendo servicios:', error)
    return {}
  }

  // Construye el mismo formato que antes: { '1': { id, nombre, precio }, ... }
  _serviciosCache = {}
  data.forEach((s, idx) => {
    _serviciosCache[String(idx + 1)] = {
      id:                s.id,
      nombre:            s.nombre,
      precio:            `${s.precio}€`,
      duracion_minutos:  s.duracion_minutos
    }
  })

  return _serviciosCache
}

// Invalida el cache (útil si cambias servicios en BD sin reiniciar)
function invalidarCacheServicios() {
  _serviciosCache = null
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

async function guardarCita(telefono, servicioId, fecha, hora) {
  const cliente = await obtenerOCrearCliente(telefono)

  const { data, error } = await supabase
    .from('citas')
    .insert({
      cliente_id:           cliente.id,
      servicio_id:          servicioId,
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

// ─── Obtener citas del cliente (solo futuras y confirmadas) ───────────────────

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
    .select('id, fecha, hora, servicios(nombre, precio)')
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

// ─── Horas disponibles por servicio y fecha ───────────────────────────────────

async function obtenerHorasDisponibles(fecha, servicioId) {
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

  const { data: franjas, error: errFranjas } = await supabase
    .from('horarios')
    .select('hora_inicio, hora_fin')
    .eq('dia_semana', diaSemana)
    .eq('activo', true)
    .order('hora_inicio', { ascending: true })

  if (errFranjas || !franjas || franjas.length === 0) return []

  const todosLosSlots = franjas.flatMap(f =>
    generarSlots(f.hora_inicio, f.hora_fin, duracion)
  )

  const { data: citasDelDia } = await supabase
    .from('citas')
    .select('hora, servicios(duracion_minutos)')
    .eq('fecha', fecha)
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
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
}