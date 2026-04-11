const supabase = require('../database/db')

// ─── Servicios desde BD ───────────────────────────────────────────────────────

const _serviciosCache = {}   // { [empresaId]: { data, exp } }
const CACHE_TTL_MS    = 10 * 60 * 1000   // 10 minutos

async function obtenerServicios(empresaId) {
  const entry = _serviciosCache[empresaId]
  if (entry && Date.now() < entry.exp) return entry.data

  const { data, error } = await supabase
    .from('servicios')
    .select('id, nombre, precio, duracion_minutos')
    .eq('empresa_id', empresaId)
    .order('id', { ascending: true })

  if (error || !data) {
    console.error('❌ Error obteniendo servicios:', error)
    return entry?.data || {}
  }

  const result = {}
  data.forEach((s, idx) => {
    result[String(idx + 1)] = {
      id:               s.id,
      nombre:           s.nombre,
      precio:           `${s.precio}€`,
      duracion_minutos: s.duracion_minutos
    }
  })
  _serviciosCache[empresaId] = { data: result, exp: Date.now() + CACHE_TTL_MS }

  return result
}

function invalidarCacheServicios(empresaId) {
  delete _serviciosCache[empresaId]
}

// ─── Barberos disponibles para un servicio ────────────────────────────────────

async function obtenerBarberosPorServicio(servicioId, empresaId) {
  const { data, error } = await supabase
    .from('barbero_servicios')
    .select('barberos(id, nombre)')
    .eq('servicio_id', servicioId)
    .eq('barberos.activo', true)
    .eq('barberos.empresa_id', empresaId)

  if (error || !data) {
    console.error('❌ Error obteniendo barberos:', error)
    return []
  }

  return data.map(r => r.barberos).filter(Boolean)
}

// ─── Cliente ──────────────────────────────────────────────────────────────────

async function obtenerOCrearCliente(telefono, empresaId) {
  const { data: existing } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefono', telefono)
    .eq('empresa_id', empresaId)
    .single()

  if (existing) return existing

  const { data: nuevo } = await supabase
    .from('clientes')
    .insert({ telefono, empresa_id: empresaId })
    .select()
    .single()

  return nuevo
}

async function obtenerNombreCliente(telefono, empresaId) {
  const { data } = await supabase
    .from('clientes')
    .select('nombre')
    .eq('telefono', telefono)
    .eq('empresa_id', empresaId)
    .single()
  return data?.nombre || null
}

async function actualizarNombreCliente(telefono, nombre, empresaId) {
  await obtenerOCrearCliente(telefono, empresaId)
  await supabase
    .from('clientes')
    .update({ nombre })
    .eq('telefono', telefono)
    .eq('empresa_id', empresaId)
}

// ─── Guardar cita ─────────────────────────────────────────────────────────────

async function guardarCita(telefono, servicioId, barberoId, fecha, hora, empresaId) {
  const cliente = await obtenerOCrearCliente(telefono, empresaId)

  const { data, error } = await supabase
    .from('citas')
    .insert({
      cliente_id:           cliente.id,
      servicio_id:          servicioId,
      barbero_id:           barberoId,
      empresa_id:           empresaId,
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

async function obtenerCitasCliente(telefono, empresaId) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', telefono)
    .eq('empresa_id', empresaId)
    .single()

  if (!cliente) return []

  const hoy = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('citas')
    .select('id, fecha, hora, servicio_id, barbero_id, servicios(id, nombre, precio), barberos(id, nombre)')
    .eq('cliente_id', cliente.id)
    .eq('empresa_id', empresaId)
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

  // 2. Verificar si el barbero está de vacaciones ese día
  const { data: vacaciones } = await supabase
    .from('vacaciones')
    .select('id')
    .eq('barbero_id', barberoId)
    .lte('fecha_inicio', fecha)
    .gte('fecha_fin', fecha)

  if (vacaciones && vacaciones.length > 0) return []

  const diaSemana = new Date(fecha + 'T12:00:00').getDay()

  // 3. Franjas horarias del barbero ese día
  const { data: franjas, error: errFranjas } = await supabase
    .from('horarios_barbero')
    .select('hora_inicio, hora_fin')
    .eq('barbero_id', barberoId)
    .eq('dia_semana', diaSemana)
    .eq('activo', true)
    .order('hora_inicio', { ascending: true })

  if (errFranjas || !franjas || franjas.length === 0) return []

  // 4. Generar todos los slots del barbero ese día
  const todosLosSlots = franjas.flatMap(f =>
    generarSlots(f.hora_inicio, f.hora_fin, duracion)
  )

  // 5. Citas ya confirmadas del barbero ese día
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

  const libres = todosLosSlots.filter(slot => !ocupados.has(slot))

  // Si es hoy, descartar slots que ya han pasado (con 15 min de margen)
  const ahoraEspana = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  const yy  = ahoraEspana.getFullYear()
  const mm  = String(ahoraEspana.getMonth() + 1).padStart(2, '0')
  const dd  = String(ahoraEspana.getDate()).padStart(2, '0')
  const hoy = `${yy}-${mm}-${dd}`
  if (fecha === hoy) {
    const ahoraMin = ahoraEspana.getHours() * 60 + ahoraEspana.getMinutes()
    const margen   = 15
    return libres.filter(slot => horaAMinutos(slot) >= ahoraMin + margen)
  }

  return libres
}

module.exports = {
  obtenerServicios,
  invalidarCacheServicios,
  obtenerBarberosPorServicio,
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
  obtenerNombreCliente,
  actualizarNombreCliente,
}
