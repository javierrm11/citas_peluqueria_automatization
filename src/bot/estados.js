const { enviarMensaje } = require("../services/whatsapp.js");
const {
  guardarCita,
  obtenerCitasCliente,
  cancelarCita,
  obtenerHorasDisponibles,
  SERVICIOS,
} = require("../services/citas");

const sesiones = {};

const MENU = `─────────────────\n¿Qué deseas hacer ahora?\n\n1️⃣ Reservar cita\n2️⃣ Ver mis citas\n3️⃣ Cancelar cita\n4️⃣ Hablar con soporte\n0️⃣ Salir`;

async function procesarMensaje(telefono, texto) {
  if (!sesiones[telefono]) {
    sesiones[telefono] = { estado: "INICIO" };
  }

  const sesion = sesiones[telefono];
  texto = texto.trim();

  // Opción 0 global: salir desde cualquier estado
  if (texto === "0") {
    sesion.estado = "INICIO";
    await enviarMensaje(
      telefono,
      `👋 ¡Hasta pronto! Si necesitas algo, escríbenos cuando quieras. 😊`,
    );
    delete sesiones[telefono];
    return;
  }

  switch (sesion.estado) {
    case "INICIO":
      await enviarMensaje(
        telefono,
        `👋 ¡Hola! Bienvenido a *Peluquería Javier*\n\n` +
          `¿Qué deseas hacer?\n\n` +
          `1️⃣ Reservar cita\n` +
          `2️⃣ Ver mis citas\n` +
          `3️⃣ Cancelar cita\n` +
          `4️⃣ Hablar con soporte\n` +
          `0️⃣ Salir`,
      );
      sesion.estado = "ESPERANDO_OPCION";
      break;

    case "ESPERANDO_OPCION":
      if (texto === "1") {
        await enviarMensaje(
          telefono,
          `✂️ ¿Qué servicio necesitas?\n\n` +
            `1️⃣ Corte - 15€\n` +
            `2️⃣ Tinte - 40€\n` +
            `3️⃣ Barba - 10€\n` +
            `4️⃣ Corte + Barba - 22€\n` +
            `0️⃣ Volver al menú`,
        );
        sesion.estado = "ELIGIENDO_SERVICIO";
      } else if (texto === "2") {
        const citas = await obtenerCitasCliente(telefono);
        if (citas.length === 0) {
          await enviarMensaje(
            telefono,
            `📅 No tienes citas próximas.\n\n${MENU}`,
          );
        } else {
          let msg = "📅 *Tus próximas citas:*\n\n";
          citas.forEach((c, i) => {
            msg += `${i + 1}️⃣ ${c.fecha} a las ${c.hora.substring(0, 5)}\n`;
            msg += `   💈 ${c.servicios.nombre} - ${c.servicios.precio}€\n\n`;
          });
          msg += MENU;
          await enviarMensaje(telefono, msg);
        }
        sesion.estado = "ESPERANDO_OPCION";
      } else if (texto === "3") {
        const citas = await obtenerCitasCliente(telefono);
        if (citas.length === 0) {
          await enviarMensaje(
            telefono,
            `❌ No tienes citas para cancelar.\n\n${MENU}`,
          );
          sesion.estado = "ESPERANDO_OPCION";
        } else {
          let msg = "❌ ¿Qué cita quieres cancelar?\n\n";
          citas.forEach((c, i) => {
            msg += `${i + 1}️⃣ ${c.fecha} a las ${c.hora.substring(0, 5)} - ${c.servicios.nombre}\n`;
          });
          msg += `\n0️⃣ Volver al menú`;
          sesion.citasPendientes = citas;
          await enviarMensaje(telefono, msg);
          sesion.estado = "CANCELANDO_CITA";
        }
      } else if (texto === "4") {
        await enviarMensaje(
          telefono,
          `💬 Has solicitado hablar con soporte.\n\n` +
            `Un responsable te atenderá lo antes posible.\n\n` +
            `✍️ Escribe tu consulta:`,
        );

        sesion.estado = "SOPORTE";
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Opción no válida. Por favor elige:\n\n` +
            `1️⃣ Reservar cita\n` +
            `2️⃣ Ver mis citas\n` +
            `3️⃣ Cancelar cita\n` +
            `4️⃣ Hablar con soporte\n` +
            `0️⃣ Salir`,
        );
      }
      break;

    case "ELIGIENDO_SERVICIO":
      if (SERVICIOS[texto]) {
        sesion.servicio = SERVICIOS[texto].nombre;
        sesion.servicioId = SERVICIOS[texto].id;

        const hoy = new Date();
        const fechas = [];
        let contador = 0;
        let i = 1;

        while (contador < 4) {
          const fecha = new Date(hoy);
          fecha.setDate(hoy.getDate() + i);
          if (fecha.getDay() !== 0) {
            fechas.push(fecha.toISOString().split("T")[0]);
            contador++;
          }
          i++;
        }

        sesion.fechasDisponibles = fechas;

        const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        let msg = `📅 Elige un día para tu *${sesion.servicio}*:\n\n`;
        fechas.forEach((f, idx) => {
          const d = new Date(f + "T12:00:00");
          msg += `${idx + 1}️⃣ ${dias[d.getDay()]} ${f}\n`;
        });
        msg += `\n0️⃣ Volver al menú`;

        await enviarMensaje(telefono, msg);
        sesion.estado = "ELIGIENDO_FECHA";
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción del 1 al 4\n\n0️⃣ Volver al menú`,
        );
      }
      break;

    case "ELIGIENDO_FECHA":
      const opcionFecha = parseInt(texto);
      if (opcionFecha >= 1 && opcionFecha <= sesion.fechasDisponibles.length) {
        sesion.fecha = sesion.fechasDisponibles[opcionFecha - 1];

        const horasLibres = await obtenerHorasDisponibles(sesion.fecha);

        if (horasLibres.length === 0) {
          await enviarMensaje(
            telefono,
            `😔 No hay horas disponibles el ${sesion.fecha}.\n\nElige otro día:\n\n0️⃣ Volver al menú`,
          );
        } else {
          sesion.horasDisponibles = horasLibres;
          let msg = `🕐 Horas disponibles para el *${sesion.fecha}*:\n\n`;
          horasLibres.forEach((h, idx) => {
            msg += `${idx + 1}️⃣ ${h}\n`;
          });
          msg += `\n0️⃣ Volver al menú`;
          await enviarMensaje(telefono, msg);
          sesion.estado = "ELIGIENDO_HORA";
        }
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción del 1 al ${sesion.fechasDisponibles.length}\n\n0️⃣ Volver al menú`,
        );
      }
      break;

    case "ELIGIENDO_HORA":
      const opcionHora = parseInt(texto);
      if (opcionHora >= 1 && opcionHora <= sesion.horasDisponibles.length) {
        sesion.hora = sesion.horasDisponibles[opcionHora - 1];

        const cita = await guardarCita(
          telefono,
          sesion.servicioId,
          sesion.fecha,
          sesion.hora,
        );

        if (cita) {
          await enviarMensaje(
            telefono,
            `✅ *¡Cita confirmada!*\n\n` +
              `💈 Servicio: ${sesion.servicio}\n` +
              `📅 Fecha: ${sesion.fecha}\n` +
              `🕐 Hora: ${sesion.hora}\n\n` +
              `Te esperamos 😊\n\n` +
              MENU,
          );
        } else {
          await enviarMensaje(
            telefono,
            `❌ Hubo un error al guardar la cita.\nInténtalo de nuevo.\n\n${MENU}`,
          );
        }

        sesion.estado = "ESPERANDO_OPCION";
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción del 1 al ${sesion.horasDisponibles.length}\n\n0️⃣ Volver al menú`,
        );
      }
      break;

    case "CANCELANDO_CITA":
      const opcionCancelar = parseInt(texto);
      if (
        opcionCancelar >= 1 &&
        opcionCancelar <= sesion.citasPendientes.length
      ) {
        const citaACancelar = sesion.citasPendientes[opcionCancelar - 1];
        await cancelarCita(citaACancelar.id);
        await enviarMensaje(
          telefono,
          `✅ *Cita cancelada:*\n\n` +
            `📅 ${citaACancelar.fecha} a las ${citaACancelar.hora.substring(0, 5)}\n` +
            `💈 ${citaACancelar.servicios.nombre}\n\n` +
            MENU,
        );
        sesion.estado = "ESPERANDO_OPCION";
      } else {
        await enviarMensaje(
          telefono,
          `⚠️ Elige una opción válida del 1 al ${sesion.citasPendientes.length}\n\n0️⃣ Volver al menú`,
        );
      }
      break;

    default:
      sesion.estado = "INICIO";
      await procesarMensaje(telefono, texto);
  }
}

module.exports = { procesarMensaje };
