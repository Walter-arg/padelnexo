import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import {
  clearPendingMercadoPagoCheckout,
  clearPendingTurnoCheckout,
  syncLeagueMercadoPagoPayment,
  syncTournamentMercadoPagoPayment,
  syncTurnoMercadoPagoPayment,
} from "../services/mercadoPagoCheckoutService";
import {
  clearPendingLeagueMercadoPagoAttempt,
  clearPendingLeagueMercadoPagoAttempts,
  getLeagueById,
} from "../services/leaguesService";
import {
  clearPendingTournamentMercadoPagoAttempt,
  getTournamentById,
  getTournamentRegistrationById,
} from "../services/tournamentsService";
import {
  cancelPendingMercadoPagoReservation,
  getTurnoReservationById,
  markTurnoReservationMercadoPagoNotified,
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

  if (fallbackStatus === "failure") {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "alert-circle",
      message:
        "No se completo el pago con Mercado Pago. Puedes volver a intentarlo o elegir efectivo en la sede.",
      note: "La reserva no quedo confirmada con este cobro.",
      title: "Pago no aprobado",
    };
  }

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

function findLeaguePaymentEntry(league = null, roundId = "", participantId = "") {
  const rounds = Array.isArray(league?.roundPayments) ? league.roundPayments : [];
  const round = rounds.find((item) => String(item?.roundId || "").trim() === String(roundId || "").trim());

  if (!round) {
    return { entry: null, round: null };
  }

  const entry =
    (Array.isArray(round.entries) ? round.entries : []).find(
      (item) => String(item?.participantId || "").trim() === String(participantId || "").trim()
    ) || null;

  return { entry, round };
}

function buildLeaguePaymentCopy(league = null, round = null, entry = null, fallbackStatus = "") {
  const paymentStatus = String(entry?.paymentStatus || "").trim().toLowerCase();
  const mercadoPagoStatus = String(entry?.mercadoPagoStatus || "").trim().toLowerCase();

  if (fallbackStatus === "failure") {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "alert-circle",
      message: "No se completo el pago de la liga con Mercado Pago.",
      note: "La fecha sigue impaga. Puedes intentarlo nuevamente cuando quieras.",
      title: "Pago no aprobado",
    };
  }

  if (paymentStatus === "pagado" || mercadoPagoStatus === "approved") {
    return {
      accent: "#1A7F5A",
      background: "#EAF8F3",
      icon: "checkmark-circle",
      message: "El pago de la liga ya quedo aprobado y el estado se actualizo correctamente.",
      note: "La fecha ya queda reflejada como abonada dentro de la liga.",
      title: "Pago aprobado",
    };
  }

  if (paymentStatus === "in_review" || ["pending", "in_process", "authorized"].includes(mercadoPagoStatus)) {
    return {
      accent: "#8A6A00",
      background: "#FFF8E1",
      icon: "time",
      message:
        "Mercado Pago dejo el cobro en revision o pendiente. En cuanto se confirme, tambien lo veremos reflejado en PadelNexo.",
      note: "Puedes volver a la liga y revisar el estado del pago en unos instantes.",
      title: "Pago pendiente",
    };
  }

  if (["rejected", "cancelled"].includes(mercadoPagoStatus)) {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "alert-circle",
      message: "No se completo el pago de la liga con Mercado Pago.",
      note: "Si quieres abonarlo, vuelve a intentarlo o usa el metodo que tenga disponible el organizador.",
      title: "Pago no aprobado",
    };
  }

  return getBaseStatusCopy(fallbackStatus);
}

function buildLeagueSummaryRows(league = null, round = null, entry = null) {
  return [
    {
      label: "Liga",
      value: String(league?.nombre || "").trim(),
    },
    {
      label: "Fecha",
      value: String(round?.title || "").trim(),
    },
    {
      label: "Participante",
      value: String(entry?.participantLabel || "").trim(),
    },
  ].filter((item) => item.value);
}

function findTournamentPaymentEntry(registration = null, playerId = "") {
  const payment =
    (Array.isArray(registration?.payments) ? registration.payments : []).find(
      (entry) =>
        String(entry?.playerId || "").trim() === String(playerId || "").trim() ||
        String(entry?.userId || "").trim() === String(playerId || "").trim()
    ) || null;

  return payment;
}

function buildTournamentPaymentCopy(tournament = null, registration = null, payment = null, fallbackStatus = "") {
  const paymentStatus = String(payment?.status || "").trim().toLowerCase();
  const mercadoPagoStatus = String(payment?.mercadoPagoStatus || "").trim().toLowerCase();

  if (fallbackStatus === "failure") {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "alert-circle",
      message: "No se completo el pago de la inscripcion del torneo con Mercado Pago.",
      note: "La inscripcion sigue pendiente. Puedes volver a intentarlo cuando quieras.",
      title: "Pago no aprobado",
    };
  }

  if (paymentStatus === "approved" || mercadoPagoStatus === "approved") {
    return {
      accent: "#1A7F5A",
      background: "#EAF8F3",
      icon: "checkmark-circle",
      message: "El pago del torneo ya quedo aprobado y la inscripcion se actualizo correctamente.",
      note:
        String(registration?.status || "").trim().toLowerCase() === "confirmed"
          ? "Tu lugar ya quedo confirmado dentro del torneo."
          : "El estado de tu inscripcion ya quedo actualizado segun la modalidad del torneo.",
      title: "Pago aprobado",
    };
  }

  if (paymentStatus === "in_review" || ["pending", "in_process", "authorized"].includes(mercadoPagoStatus)) {
    return {
      accent: "#8A6A00",
      background: "#FFF8E1",
      icon: "time",
      message:
        "Mercado Pago dejo el cobro en revision o pendiente. En cuanto se confirme, tambien lo veremos reflejado en PadelNexo.",
      note: "Puedes volver al torneo y revisar el estado del pago en unos instantes.",
      title: "Pago pendiente",
    };
  }

  if (["rejected", "cancelled"].includes(mercadoPagoStatus)) {
    return {
      accent: "#B54A4A",
      background: "#FFF1F1",
      icon: "alert-circle",
      message: "No se completo el pago de la inscripcion del torneo con Mercado Pago.",
      note: "Si quieres abonarla, vuelve a intentarlo cuando quieras.",
      title: "Pago no aprobado",
    };
  }

  return getBaseStatusCopy(fallbackStatus);
}

function buildTournamentSummaryRows(tournament = null, registration = null, payment = null) {
  return [
    {
      label: "Torneo",
      value: String(tournament?.name || "").trim(),
    },
    {
      label: "Inscripcion",
      value: String(registration?.pairLabel || "").trim(),
    },
    {
      label: "Jugador",
      value: String(payment?.playerName || "").trim(),
    },
  ].filter((item) => item.value);
}

export default function MercadoPagoReturnScreen({ navigation, route }) {
  const source = String(route?.params?.source || "turnos").trim().toLowerCase();
  const isLeaguePayment = source === "leagues";
  const isTournamentPayment = source === "tournaments";
  const batchCount = Number(route?.params?.batchCount || 0) || 0;
  const batchTargets = useMemo(
    () => (Array.isArray(route?.params?.batchTargets) ? route.params.batchTargets : []),
    [route?.params?.batchTargets]
  );
  const leagueId = String(route?.params?.leagueId || "").trim();
  const externalReference = String(route?.params?.externalReference || "").trim();
  const pairId = String(route?.params?.pairId || "").trim();
  const participantId = String(route?.params?.participantId || "").trim();
  const status = String(route?.params?.status || "pending").trim().toLowerCase();
  const reservationId = String(route?.params?.reservationId || "").trim();
  const paymentId = String(route?.params?.paymentId || "").trim();
  const playerId = String(route?.params?.playerId || "").trim();
  const registrationId = String(route?.params?.registrationId || "").trim();
  const tournamentId = String(route?.params?.tournamentId || "").trim();
  const roundId = String(route?.params?.roundId || "").trim();
  const [reservation, setReservation] = useState(null);
  const [leaguePayment, setLeaguePayment] = useState({
    entry: null,
    league: null,
    round: null,
  });
  const [tournamentPayment, setTournamentPayment] = useState({
    payment: null,
    registration: null,
    tournament: null,
  });
  const [checkingStatus, setCheckingStatus] = useState(
    Boolean(
      isLeaguePayment
        ? status !== "failure" && leagueId && ((roundId && participantId) || batchCount > 1 || paymentId || externalReference)
        : isTournamentPayment
        ? status !== "failure" && tournamentId && registrationId && playerId
        : status === "success" && reservationId
    )
  );

  useEffect(() => {
    if (status !== "failure") {
      return;
    }

    if (isLeaguePayment) {
      if (!leagueId) {
        return;
      }

      if (batchTargets.length > 1) {
        clearPendingLeagueMercadoPagoAttempts(
          leagueId,
          batchTargets,
          "payment_not_completed"
        ).catch(() => {});
      } else {
        if (!roundId || !participantId) {
          return;
        }

        clearPendingLeagueMercadoPagoAttempt(
          leagueId,
          roundId,
          participantId,
          "payment_not_completed"
        ).catch(() => {});
      }
      clearPendingMercadoPagoCheckout().catch(() => {});
      return;
    }

    if (isTournamentPayment) {
      if (!tournamentId || !registrationId || !playerId) {
        return;
      }

      clearPendingTournamentMercadoPagoAttempt(
        tournamentId,
        registrationId,
        playerId,
        "payment_not_completed"
      ).catch(() => {});
      clearPendingMercadoPagoCheckout().catch(() => {});
      return;
    }

    if (!reservationId) {
      return;
    }

    cancelPendingMercadoPagoReservation(reservationId, "payment_not_completed").catch(() => {});
    clearPendingTurnoCheckout().catch(() => {});
  }, [
    batchTargets,
    isLeaguePayment,
    isTournamentPayment,
    leagueId,
    participantId,
    playerId,
    registrationId,
    reservationId,
    roundId,
    status,
    tournamentId,
  ]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId = null;
    let cancelled = false;

    const shouldPoll = isLeaguePayment
      ? status !== "failure" &&
        Boolean(leagueId && ((roundId && participantId) || batchCount > 1 || paymentId || externalReference))
      : isTournamentPayment
      ? status !== "failure" &&
        Boolean(tournamentId && registrationId && playerId && (paymentId || externalReference))
      : status === "success" && Boolean(reservationId);

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
        if (isLeaguePayment) {
          try {
            await syncLeagueMercadoPagoPayment({
              batchTargets,
              leagueId,
              externalReference,
              pairId,
              participantId,
              paymentId,
              roundId,
            });
          } catch (error) {
            if (error?.code === "payment_not_found") {
              // Mercado Pago puede tardar unos segundos en exponer el pago
              // luego del retorno a la app, especialmente si la app reinicia.
            }
          }

          const nextLeague = await getLeagueById(leagueId);

          if (!isMounted) {
            return;
          }

          const { entry, round } =
            roundId && participantId
              ? findLeaguePaymentEntry(nextLeague, roundId, participantId)
              : { entry: null, round: null };
          setLeaguePayment({
            entry,
            league: nextLeague,
            round,
          });

          const paymentStatus = String(entry?.paymentStatus || "").trim().toLowerCase();
          const mercadoPagoStatus = String(entry?.mercadoPagoStatus || "").trim().toLowerCase();
          const batchResolvedByStatus = status === "success" && batchCount > 1;
          const resolved =
            batchResolvedByStatus ||
            paymentStatus === "pagado" ||
            mercadoPagoStatus === "approved" ||
            ["rejected", "cancelled"].includes(mercadoPagoStatus);

          if (resolved || attempt >= 7) {
            if (resolved) {
              clearPendingMercadoPagoCheckout().catch(() => {});
            }
            setCheckingStatus(false);
            return;
          }
        } else if (isTournamentPayment) {
          if (attempt === 0) {
            try {
              await syncTournamentMercadoPagoPayment({
                externalReference,
                paymentId,
                playerId,
                registrationId,
                tournamentId,
              });
            } catch (error) {
              if (error?.code === "payment_not_found") {
                await clearPendingTournamentMercadoPagoAttempt(
                  tournamentId,
                  registrationId,
                  playerId,
                  "payment_not_completed"
                ).catch(() => {});
                await clearPendingMercadoPagoCheckout().catch(() => {});
                setCheckingStatus(false);
                return;
              }
            }
          }

          const [nextTournament, nextRegistration] = await Promise.all([
            getTournamentById(tournamentId),
            getTournamentRegistrationById(tournamentId, registrationId),
          ]);

          if (!isMounted) {
            return;
          }

          const nextPayment = findTournamentPaymentEntry(nextRegistration, playerId);
          setTournamentPayment({
            payment: nextPayment,
            registration: nextRegistration,
            tournament: nextTournament,
          });

          const paymentStatus = String(nextPayment?.status || "").trim().toLowerCase();
          const mercadoPagoStatus = String(nextPayment?.mercadoPagoStatus || "")
            .trim()
            .toLowerCase();
          const resolved =
            paymentStatus === "approved" ||
            paymentStatus === "rejected" ||
            mercadoPagoStatus === "approved" ||
            ["rejected", "cancelled"].includes(mercadoPagoStatus);

          if (resolved || attempt >= 7) {
            if (resolved) {
              clearPendingMercadoPagoCheckout().catch(() => {});
            }
            setCheckingStatus(false);
            return;
          }
        } else {
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
              await markTurnoReservationMercadoPagoNotified(nextReservation.id).catch(() => null);
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
  }, [
    batchCount,
    externalReference,
    isLeaguePayment,
    isTournamentPayment,
    leagueId,
    pairId,
    participantId,
    paymentId,
    playerId,
    registrationId,
    reservationId,
    roundId,
    status,
    tournamentId,
  ]);

  useEffect(() => {
    if (!checkingStatus) {
      if (isLeaguePayment) {
        const paymentStatus = String(leaguePayment.entry?.paymentStatus || "").trim().toLowerCase();
        const mercadoPagoStatus = String(leaguePayment.entry?.mercadoPagoStatus || "")
          .trim()
          .toLowerCase();

        if (
          paymentStatus === "pagado" ||
          mercadoPagoStatus === "approved" ||
          ["rejected", "cancelled"].includes(mercadoPagoStatus)
        ) {
          clearPendingMercadoPagoCheckout().catch(() => {});
        }
        return;
      }

      if (isTournamentPayment) {
        const paymentStatus = String(tournamentPayment.payment?.status || "").trim().toLowerCase();
        const mercadoPagoStatus = String(tournamentPayment.payment?.mercadoPagoStatus || "")
          .trim()
          .toLowerCase();

        if (
          paymentStatus === "approved" ||
          paymentStatus === "rejected" ||
          mercadoPagoStatus === "approved" ||
          ["rejected", "cancelled"].includes(mercadoPagoStatus)
        ) {
          clearPendingMercadoPagoCheckout().catch(() => {});
        }
        return;
      }

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
  }, [checkingStatus, isLeaguePayment, isTournamentPayment, leaguePayment, reservation, tournamentPayment]);

  const copy = useMemo(() => {
    if (isLeaguePayment) {
      if (batchCount > 1 && status === "success") {
        return {
          accent: "#1A7F5A",
          background: "#EAF8F3",
          icon: "checkmark-circle",
          message: "El pago de las fechas seleccionadas ya quedo aprobado correctamente.",
          note: "Las fechas elegidas se actualizaron dentro de la liga.",
          title: "Pago aprobado",
        };
      }

      return buildLeaguePaymentCopy(
        leaguePayment.league,
        leaguePayment.round,
        leaguePayment.entry,
        status
      );
    }

    if (isTournamentPayment) {
      return buildTournamentPaymentCopy(
        tournamentPayment.tournament,
        tournamentPayment.registration,
        tournamentPayment.payment,
        status
      );
    }

    return buildReservationPaymentCopy(reservation, status);
  }, [isLeaguePayment, isTournamentPayment, leaguePayment, reservation, status, tournamentPayment]);
  const summaryRows = useMemo(() => {
    if (isLeaguePayment) {
      if (batchCount > 1) {
        return [
          {
            label: "Liga",
            value: String(leaguePayment.league?.nombre || "").trim(),
          },
          {
            label: "Fechas",
            value: `${batchCount} fecha(s) seleccionada(s)`,
          },
        ].filter((item) => item.value);
      }

      return buildLeagueSummaryRows(leaguePayment.league, leaguePayment.round, leaguePayment.entry);
    }

    if (isTournamentPayment) {
      return buildTournamentSummaryRows(
        tournamentPayment.tournament,
        tournamentPayment.registration,
        tournamentPayment.payment
      );
    }

    return buildReservationSummaryRows(reservation);
  }, [isLeaguePayment, isTournamentPayment, leaguePayment, reservation, tournamentPayment]);

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
          onPress={() =>
            navigation.replace(
              isLeaguePayment ? "LeaguePayments" : isTournamentPayment ? "TournamentRegistration" : "Turnos",
              isLeaguePayment
                ? {
                    leagueId,
                    leagueName: leaguePayment.league?.nombre || "Liga",
                  }
                : isTournamentPayment
                ? {
                    tournamentId,
                    tournamentName: tournamentPayment.tournament?.name || "Torneo",
                    initialPanel: "payments",
                  }
                : undefined
            )
          }
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
        >
          <Text style={styles.buttonText}>
            {isLeaguePayment ? "Volver a la Liga" : isTournamentPayment ? "Volver al Torneo" : "Volver a Turnos"}
          </Text>
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
