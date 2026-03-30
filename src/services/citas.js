const { createClient } = require("@supabase/supabase-js");
const { enviarMensaje } = require("../services/whatsapp.js");
const {
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
  SERVICIOS,
} = require("../services/citas");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MENU = `─────────────────\n¿Qué deseas hacer ahora?\n\n1️⃣ Reservar cita\n2️⃣ Ver mis citas\n3️⃣ Cancelar cita\n4️⃣ Hablar con soporte\n0️⃣ Salir`;

// ─── Helpers de sesión ────────────────────────────────────────────────────────

async function obtenerSesion(telefono) {
  const { data, error } = await supabase
    .from("sesiones")
    .select("estado, datos")
    .eq("telefono", telefono)
    .single();

  if (error || !data) {
    return { estado: "INICIO", datos: {} };
  }

  return { estado: data.estado, datos: data.datos || {} };
}

async function guardarSesion(telefono, estado, datos = {}) {
  await supabase
    .from("sesiones")
    .upsert(
      { telefono, estado, datos, updated_at: new Date().toISOString() },
      { onConflict: "telefono" }
    );
}

async function eliminarSesion(telefono) {
  await supabase.from("sesiones").delete().eq("telefono", telefono);
}

// ─── Procesador principal ─────────────────────────────────────────────────────

async function procesarMensaje(telefono, texto) {
  let { estado, datos } = await obtenerSesion(telefono);
  texto = texto.trim();

  // Opción 0: salir si está en el menú principal, volver al menú si está en otro estado
  if (texto === "0") {
    if (estado === "ESPERANDO_OPCION" || estado === "INICIO") {
      await enviarMensaje(
        telefono,
        `👋 ¡Hasta pronto! Si necesitas algo, escríbenos cuando quieras. 😊`
      );
      await eliminarSesion(telefono);
    } else {
      await guardarSesion(telefono, "ESPERANDO_OPCION", {});
      await enviarMensaje(telefono, MENU);
    }
    return;
  }

  switch (estado) {
    case "INICIO": {
      await enviarMensaje(
        telefono,
        `👋 ¡Hola! Bienvenido a *Peluquería Javier*\n\n` +
          `¿Qué deseas hacer?\n\n` +
          `1️⃣ Reservar cita\n` +
          `2️⃣ Ver mis citas\n` +
          `3️⃣ Cancelar cita\n` +
          `4️⃣ Hablar con soporte\n` +
          `0️⃣ Salir`
      );
      await guardarSesion(telefono, "ESPERANDO_OPCION", {});
      break;
    }

    case "ESPERANDO_OPCION": {
      if (texto === "1") {
        await enviarMensaje(
          telefono,
          `✂️ ¿Qué servicio necesitas?\n\n` +
            `1️⃣ Corte - 15€\n` +
            `2️⃣ Tinte - 40€\n` +
            `3️⃣ Barba - 10€\n` +
            `4️⃣ Corte + Barba - 22€\n` +
            `0️⃣ Volver al menú`
        );
        await guardarSesion(telefono, "ELIGIENDO_SERVICIO", {});

      } else if (texto === "2") {
        const citas = await obtenerCitasCliente(telefono);
        if (citas.length === 0) {
          await enviarMensaje(telefono, `📅 No tienes citas próximas.\n\n${MENU}`);
        } else {
          let msg = "📅 *Tus próximas citas:*\n\n";
          citas.forEach((c, i) => {
            msg += `${i + 1}️⃣ ${c.fecha} a las ${c.hora.substring(0, 5)}\n`;
            msg += `   💈 ${c.servicios.nombre} - ${c.servicios.precio}€\n\n`;
          });
          msg += MENU;
          await enviarMensaje(telefono, msg);
        }
        await guardarSesion(telefono, "ESPERANDO_OPCION", {});

      } else if (texto === "3") {
        const citas = await obtenerCitasCliente(telefono);
        if (citas.length === 0) {
          await enviarMensaje(telefono, `❌ No tienes citas para cancelar.\n\n${MENU}`);
          await guardarSesion(telefono, "ESPERANDO_OPCION", {});
        } else {
          let msg = "❌ ¿Qué cita quieres cancelar?\n\n";
          citas.forEach((c, i) => {
            msg += `${i + 1}️⃣ ${c.fecha} a las ${c.hora.substring(0, 5)} - ${c.servicios.nombre}\n`;
          });
          msg += `\n0️⃣ Volver al menú`;
          await enviarMensaje(telefono, msg);
          await guardarSesion(telefono, "CANCELANDO_CITA", { citasPendientes: citas });
        }

      } else if (texto === "4") {
        await enviarMensaje(
          telefono,
          `💬 Has solicitado hablar con soporte.\n\n` +
            `Un responsable te atenderá lo antes posible.\n\n` +
            `✍️ Escribe tu consulta:\n\n` +
            `0️⃣ Volver al menú`
        );
        await guardarSesion(telefono, "SOPORTE", {});

      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Opción no válida. Por favor elige:\n\n` +
            `1️⃣ Reservar cita\n` +
            `2️⃣ Ver mis citas\n` +
            `3️⃣ Cancelar cita\n` +
            `4️⃣ Hablar con soporte\n` +
            `0️⃣ Salir`
        );
      }
      break;
    }

    case "SOPORTE": {
      await enviarMensaje(
        telefono,
        `✅ Tu mensaje ha sido recibido. En breve nos ponemos en contacto contigo.\n\n${MENU}`
      );
      await guardarSesion(telefono, "ESPERANDO_OPCION", {});
      break;
    }

    case "ELIGIENDO_SERVICIO": {
      if (SERVICIOS[texto]) {
        const servicio   = SERVICIOS[texto].nombre;
        const servicioId = SERVICIOS[texto].id;

        const hoy    = new Date();
        const fechas = [];
        let contador = 0;
        let i        = 1;

        while (contador < 4) {
          const fecha = new Date(hoy);
          fecha.setDate(hoy.getDate() + i);
          if (fecha.getDay() !== 0) {
            fechas.push(fecha.toISOString().split("T")[0]);
            contador++;
          }
          i++;
        }

        const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        let msg = `📅 Elige un día para tu *${servicio}*:\n\n`;
        fechas.forEach((f, idx) => {
          const d = new Date(f + "T12:00:00");
          msg += `${idx + 1}️⃣ ${dias[d.getDay()]} ${f}\n`;
        });
        msg += `\n0️⃣ Volver al menú`;

        await enviarMensaje(telefono, msg);
        await guardarSesion(telefono, "ELIGIENDO_FECHA", { servicio, servicioId, fechasDisponibles: fechas });
      } else {
        await enviarMensaje(telefono, `⚠️ Elige una opción del 1 al 4\n\n0️⃣ Volver al menú`);
      }
      break;
    }

    case "ELIGIENDO_FECHA": {
      const opcionFecha = parseInt(texto);
      const { fechasDisponibles, servicio, servicioId } = datos;

      if (opcionFecha >= 1 && opcionFecha <= fechasDisponibles.length) {
        const fecha      = fechasDisponibles[opcionFecha - 1];
        const horasLibres = await obtenerHorasDisponibles(fecha);

        if (horasLibres.length === 0) {
          await enviarMensaje(
            telefono,
            `😔 No hay horas disponibles el ${fecha}.\n\nElige otro día:\n\n0️⃣ Volver al menú`
          );
        } else {
          let msg = `🕐 Horas disponibles para el *${fecha}*:\n\n`;
          horasLibres.forEach((h, idx) => {
            msg += `${idx + 1}️⃣ ${h}\n`;
          });
          msg += `\n0️⃣ Volver al menú`;
          await enviarMensaje(telefono, msg);
          await guardarSesion(telefono, "ELIGIENDO_HORA", { servicio, servicioId, fecha, horasDisponibles: horasLibres });
        }
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción del 1 al ${fechasDisponibles.length}\n\n0️⃣ Volver al menú`
        );
      }
      break;
    }

    case "ELIGIENDO_HORA": {
      const opcionHora = parseInt(texto);
      const { servicio, servicioId, fecha, horasDisponibles } = datos;

      if (opcionHora >= 1 && opcionHora <= horasDisponibles.length) {
        const hora = horasDisponibles[opcionHora - 1];
        const cita = await guardarCita(telefono, servicioId, fecha, hora);

        if (cita) {
          await enviarMensaje(
            telefono,
            `✅ *¡Cita confirmada!*\n\n` +
              `💈 Servicio: ${servicio}\n` +
              `📅 Fecha: ${fecha}\n` +
              `🕐 Hora: ${hora}\n\n` +
              `Te esperamos 😊\n\n` +
              MENU
          );
        } else {
          await enviarMensaje(
            telefono,
            `❌ Hubo un error al guardar la cita.\nInténtalo de nuevo.\n\n${MENU}`
          );
        }
        await guardarSesion(telefono, "ESPERANDO_OPCION", {});
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción del 1 al ${horasDisponibles.length}\n\n0️⃣ Volver al menú`
        );
      }
      break;
    }

    case "CANCELANDO_CITA": {
      const opcionCancelar = parseInt(texto);
      const { citasPendientes } = datos;

      if (opcionCancelar >= 1 && opcionCancelar <= citasPendientes.length) {
        const citaACancelar = citasPendientes[opcionCancelar - 1];
        await cancelarCita(citaACancelar.id);
        await enviarMensaje(
          telefono,
          `✅ *Cita cancelada:*\n\n` +
            `📅 ${citaACancelar.fecha} a las ${citaACancelar.hora.substring(0, 5)}\n` +
            `💈 ${citaACancelar.servicios.nombre}\n\n` +
            MENU
        );
        await guardarSesion(telefono, "ESPERANDO_OPCION", {});
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción válida del 1 al ${citasPendientes.length}\n\n0️⃣ Volver al menú`
        );
      }
      break;
    }

    default: {
      await guardarSesion(telefono, "INICIO", {});
      await procesarMensaje(telefono, texto);
    }
  }
}

module.exports = { procesarMensaje };