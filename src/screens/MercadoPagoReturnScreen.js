import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import {
  clearPendingTurnoCheckout,
  syncTurnoMercadoPagoPayment,
} from "../services/mercadoPagoCheckoutService";
import {
  cancelPendingMercadoPagoReservation,
  getTurnoReservationById,
} from "../services/turnosService";
import { sendTurnoReservationStatusMessage } from "../services/turnosNotificationsService";

function getBaseStatusCopy(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();

  if (normalizedStatus === "success") {
    return {
      accent: "#1A7F5A",
      background: "#EAF8F3",
      icon: "checkmark-circle",
      message:
        "Mercado Pago confirmo el regreso a PadelNexo. Estamos revisando el estado final del pago.",
      title: "Pago enviado",
    };
  }

  if (normalizedStatus === "failure") {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "close-circle",
      message:
        "No se completo el pago con Mercado Pago. La reserva fue cancelada. Si quieres reservar este turno, vuelve a intentarlo o elige efectivo en sede.",
      title: "Reserva cancelada",
    };
  }

  return {
    accent: "#8A6A00",
    background: "#FFF8E1",
    icon: "time",
    message:
      "Mercado Pago dejo la operacion en estado pendiente. Cuando el estado se actualice, PadelNexo lo reflejara.",
    title: "Pago pendiente",
  };
}

function buildReservationPaymentCopy(reservation = null, fallbackStatus = "") {
  const paymentStatus = String(reservation?.paymentStatus || "").trim().toLowerCase();
  const mercadoPagoStatus = String(reservation?.mercadoPagoStatus || "").trim().toLowerCase();
  const requiresApproval = reservation?.requiresOrganizerApproval !== false;
  const reservationStatus = String(reservation?.status || "").trim().toLowerCase();

  if (paymentStatus === "pagado" || mercadoPagoStatus === "approved") {
    return {
      accent: "#1A7F5A",
      background: "#EAF8F3",
      icon: "checkmark-circle",
      message:
        reservationStatus === "confirmed" || !requiresApproval
          ? "El pago del turno ya quedo aprobado y la reserva se encuentra asentada correctamente."
          : "El pago ya quedo aprobado. Ahora la reserva queda a la espera de la confirmacion final del organizador.",
      note:
        reservationStatus === "confirmed" || !requiresApproval
          ? "Ya puedes volver a turnos y continuar usando la app."
          : "El organizador vera el pago y podra terminar de confirmar la reserva.",
      title: "Pago aprobado",
    };
  }

  if (paymentStatus === "payment_issue" || ["rejected", "cancelled"].includes(mercadoPagoStatus)) {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "alert-circle",
      message:
        "Mercado Pago informo un problema con el cobro. Puedes volver a intentarlo o elegir otro metodo de pago.",
      note: "Si quieres reservar este turno, vuelve a intentarlo o elige efectivo en la sede.",
      title: "Pago no aprobado",
    };
  }

  if (paymentStatus === "in_review" || ["pending", "in_process", "authorized"].includes(mercadoPagoStatus)) {
    return {
      accent: "#8A6A00",
      background: "#FFF8E1",
      icon: "time",
      message:
        "El pago quedo en revision o pendiente de confirmacion. En cuanto Mercado Pago lo actualice, tambien lo veremos en PadelNexo.",
      note: "Por ahora mantendremos el estado del turno a la espera de esa actualizacion.",
      title: "Pago pendiente",
    };
  }

  return getBaseStatusCopy(fallbackStatus);
}

function buildReservationSummaryRows(reservation = {}) {
  if (!reservation || typeof reservation !== "object") {
    return [];
  }

  return [
    {
      label: "Complejo",
      value: String(reservation.complexName || "").trim(),
    },
    {
      label: "Cancha",
      value: String(reservation.courtName || "").trim(),
    },
    {
      label: "Fecha",
      value: String(reservation.dateLabel || "").trim(),
    },
    {
      label: "Horario",
      value: reservation.time ? `${String(reservation.time).trim()} hs` : "",
    },
  ].filter((item) => item.value);
}

export default function MercadoPagoReturnScreen({ navigation, route }) {
  const status = String(route?.params?.status || "pending").trim().toLowerCase();
  const reservationId = String(route?.params?.reservationId || "").trim();
  const paymentId = String(route?.params?.paymentId || "").trim();
  const [reservation, setReservation] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(status === "success" && Boolean(reservationId));

  useEffect(() => {
    if (status !== "failure" || !reservationId) {
      return;
    }

    cancelPendingMercadoPagoReservation(reservationId, "payment_not_completed").catch(() => {});
    clearPendingTurnoCheckout().catch(() => {});
  }, [reservationId, status]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;
    let cancelled = false;

    const shouldPoll = status === "success" && Boolean(reservationId);

    if (!shouldPoll) {
      setCheckingStatus(false);
      return () => {
        cancelled = true;
      };
    }

    async function pollReservation(attempt = 0) {
      if (cancelled) {
        return;
      }

      try {
        if (attempt === 0) {
          try {
            await syncTurnoMercadoPagoPayment({
              paymentId,
              reservationId,
            });
          } catch (error) {
            if (error?.code === "payment_not_found") {
              await cancelPendingMercadoPagoReservation(
                reservationId,
                "payment_not_completed"
              ).catch(() => {});
              await clearPendingTurnoCheckout().catch(() => {});
              setCheckingStatus(false);
              return;
            }
          }
        }

        const nextReservation = await getTurnoReservationById(reservationId);

        if (!isMounted) {
          return;
        }

        if (nextReservation) {
          setReservation(nextReservation);

          const paymentStatus = String(nextReservation?.paymentStatus || "").trim().toLowerCase();
          const mercadoPagoStatus = String(nextReservation?.mercadoPagoStatus || "")
            .trim()
            .toLowerCase();

          if (paymentStatus === "pagado" || mercadoPagoStatus === "approved") {
            await sendTurnoReservationStatusMessage(nextReservation, {
              organizerId: nextReservation.organizerId,
              organizerName: nextReservation.complexName,
            }).catch(() => null);
          }
        }

        const paymentStatus = String(nextReservation?.paymentStatus || "").trim().toLowerCase();
        const mercadoPagoStatus = String(nextReservation?.mercadoPagoStatus || "")
          .trim()
          .toLowerCase();
        const resolved =
          paymentStatus === "pagado" ||
          paymentStatus === "payment_issue" ||
          mercadoPagoStatus === "approved" ||
          ["rejected", "cancelled"].includes(mercadoPagoStatus);

        if (resolved || attempt >= 7) {
          if (resolved) {
            clearPendingTurnoCheckout().catch(() => {});
          }
          setCheckingStatus(false);
          return;
        }
      } catch (error) {
        if (isMounted && attempt >= 2) {
          setCheckingStatus(false);
          return;
        }
      }

      timeoutId = setTimeout(() => {
        pollReservation(attempt + 1);
      }, 1800);
    }

    setCheckingStatus(true);
    pollReservation();

    return () => {
      cancelled = true;
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [paymentId, reservationId, status]);

  useEffect(() => {
    if (!checkingStatus) {
      const paymentStatus = String(reservation?.paymentStatus || "").trim().toLowerCase();
      const mercadoPagoStatus = String(reservation?.mercadoPagoStatus || "").trim().toLowerCase();

      if (
        paymentStatus === "pagado" ||
        paymentStatus === "payment_issue" ||
        mercadoPagoStatus === "approved" ||
        ["rejected", "cancelled"].includes(mercadoPagoStatus)
      ) {
        clearPendingTurnoCheckout().catch(() => {});
      }
    }
  }, [checkingStatus, reservation]);

  const copy = useMemo(
    () => buildReservationPaymentCopy(reservation, status),
    [reservation, status]
  );
  const summaryRows = useMemo(() => buildReservationSummaryRows(reservation), [reservation]);

  return (
    <View style={styles.screen}>
      <View style={[styles.card, { backgroundColor: copy.background, borderColor: copy.accent }]}>
        <View style={[styles.iconWrap, { backgroundColor: `${copy.accent}18` }]}>
          <Ionicons color={copy.accent} name={copy.icon} size={34} />
        </View>
        <Text style={[styles.eyebrow, { color: copy.accent }]}>Mercado Pago</Text>
        <Text style={[styles.title, { color: copy.accent }]}>{copy.title}</Text>
        <Text style={styles.message}>{copy.message}</Text>
        {copy.note ? <Text style={styles.note}>{copy.note}</Text> : null}

        {checkingStatus ? (
          <View style={styles.checkingBox}>
            <ActivityIndicator color={copy.accent} size="small" />
            <Text style={styles.checkingText}>Estamos actualizando el estado del pago...</Text>
          </View>
        ) : null}

        {summaryRows.length ? (
          <View style={styles.summaryCard}>
            {summaryRows.map((row) => (
              <View key={row.label} style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{row.label}</Text>
                <Text style={styles.summaryValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => navigation.replace("Turnos")}
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
        >
          <Text style={styles.buttonText}>Volver a Turnos</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 1,
    borderRadius: 24,
    gap: spacing.sm,
    maxWidth: 420,
    padding: spacing.xl,
    width: "100%",
  },
  iconWrap: {
    alignItems: "center",
    borderRadius: 999,
    height: 72,
    justifyContent: "center",
    marginBottom: 2,
    width: 72,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  message: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 22,
    textAlign: "center",
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center",
  },
  checkingBox: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  checkingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  summaryCard: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 5,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
    textAlign: "right",
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    width: "100%",
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900",
  },
});
