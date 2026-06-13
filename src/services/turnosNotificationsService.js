import { doc, serverTimestamp, updateDoc } from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { sendChatMessage } from "./chatService";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function getTurnoPaymentStatusLabel(reservation = {}) {
  const paymentMethod = normalizeText(reservation.paymentMethod).toLowerCase();
  const paymentStatus = normalizeText(reservation.paymentStatus).toLowerCase();
  const mercadoPagoStatus = normalizeText(reservation.mercadoPagoStatus).toLowerCase();

  if (
    paymentMethod === "mercado_pago" &&
    (paymentStatus === "pagado" || mercadoPagoStatus === "approved")
  ) {
    return "Pagada";
  }

  if (paymentMethod === "transferencia") {
    return "Pago a verificar";
  }

  if (paymentMethod === "efectivo") {
    return "Pago en efectivo en sede";
  }

  return "Pendiente";
}

function getTurnoPaymentNotificationKey(reservation = {}) {
  const paymentMethod = normalizeText(reservation.paymentMethod).toLowerCase();
  const paymentStatus = normalizeText(reservation.paymentStatus).toLowerCase();
  const mercadoPagoStatus = normalizeText(reservation.mercadoPagoStatus).toLowerCase();

  if (
    paymentMethod === "mercado_pago" &&
    (paymentStatus === "pagado" || mercadoPagoStatus === "approved")
  ) {
    return "mercado_pago_paid";
  }

  if (paymentMethod === "transferencia") {
    return "transfer_review";
  }

  if (paymentMethod === "efectivo") {
    return "cash_pending";
  }

  return "reservation_registered";
}

export function buildTurnoReservationStatusMessage(reservation = {}, options = {}) {
  const title = options.boldTitle
    ? "**Tu reserva fue registrada.**"
    : "Tu reserva fue registrada.";
  const paymentLabel = getTurnoPaymentStatusLabel(reservation);

  return [
    title,
    "",
    `Complejo: ${reservation.complexName || "A confirmar"}`,
    `Cancha: ${reservation.courtName || "A confirmar"}`,
    `Fecha: ${reservation.dateLabel || "A confirmar"}`,
    `Horario: ${reservation.time || "A confirmar"} hs`,
    `Duracion: ${reservation.durationMinutes || 60} min`,
    `Estado del pago: ${paymentLabel}`,
  ].join("\n");
}

export async function sendTurnoReservationStatusMessage(
  reservation = {},
  { organizerId = "", organizerName = "", force = false } = {}
) {
  if (!reservation?.id || !reservation?.playerId) {
    return false;
  }

  const notificationKey = getTurnoPaymentNotificationKey(reservation);

  if (!force && reservation.playerStatusNotificationKey === notificationKey) {
    return false;
  }

  await sendChatMessage({
    currentUserId: organizerId || reservation.organizerId || "",
    currentUserName:
      organizerName || reservation.complexName || reservation.organizerName || "Complejo",
    otherUserId: reservation.playerId,
    otherUserName: reservation.playerName || "Jugador",
    text: buildTurnoReservationStatusMessage(reservation, { boldTitle: true }),
  });

  await updateDoc(doc(db, "turnoReservations", reservation.id), {
    playerStatusNotificationKey: notificationKey,
    playerStatusNotificationSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).catch(() => null);

  return true;
}
