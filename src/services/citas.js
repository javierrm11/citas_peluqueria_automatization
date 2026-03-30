const supabase = require('../database/db')

const SERVICIOS = {
  '1': { id: 1, nombre: 'Corte', precio: '15€' },
  '2': { id: 2, nombre: 'Tinte', precio: '40€' },
  '3': { id: 3, nombre: 'Barba', precio: '10€' },
  '4': { id: 4, nombre: 'Corte + Barba', precio: '22€' }
}

// Guardar o crear cliente
async function obtenerOCrearCliente(telefono) {
  // Buscar si existe
  const { data: existing } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefono', telefono)
    .single()

  if (existing) return existing

  // Crear nuevo
  const { data: nuevo } = await supabase
    .from('clientes')
    .insert({ telefono })
    .select()
    .single()

  return nuevo
}

// Guardar cita
async function guardarCita(telefono, servicioId, fecha, hora) {
  const cliente = await obtenerOCrearCliente(telefono)

  const { data, error } = await supabase
    .from('citas')
    .insert({
      cliente_id: cliente.id,
      servicio_id: servicioId,
      fecha,
      hora,
      estado: 'confirmada'
    })
    .select()
    .single()

  if (error) console.error('❌ Error guardando cita:', error)
  return data
}

// Obtener citas del cliente
async function obtenerCitasCliente(telefono) {
  const hoy = new Date().toISOString().split("T")[0] // "YYYY-MM-DD"

  const { data, error } = await supabase
    .from("citas")
    .select("id, fecha, hora, servicios(nombre, precio)")
    .eq("clientes.telefono", telefono) // ajusta según tu join
    .gte("fecha", hoy)                 // solo desde hoy
    .neq("estado", "cancelada")        // excluir canceladas
    .order("fecha", { ascending: true })
    .order("hora",  { ascending: true })

  if (error) {
    console.error("[Citas] Error al obtener citas:", error.message)
    return []
  }

  return data || []
}

// Cancelar cita
async function cancelarCita(citaId) {
  const { error } = await supabase
    .from('citas')
    .update({ estado: 'cancelada' })
    .eq('id', citaId)

  if (error) console.error('❌ Error cancelando cita:', error)
}

// Horas disponibles en una fecha
async function obtenerHorasDisponibles(fecha) {
  const HORARIOS = ['10:00', '11:00', '12:00', '16:00', '17:00', '18:00']

  const { data } = await supabase
    .from('citas')
    .select('hora')
    .eq('fecha', fecha)
    .eq('estado', 'confirmada')

  const horasOcupadas = (data || []).map(r => r.hora.substring(0, 5))
  return HORARIOS.filter(h => !horasOcupadas.includes(h))
}

module.exports = {
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
  SERVICIOS
}