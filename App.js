import React, { useEffect, useState } from "react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import AppNavigator from "./src/navigation/AppNavigator";
import devLog from "./src/utils/devLog";
import { AuthProvider } from "./src/context/AuthContext";
import { colors, spacing } from "./src/config/theme";
import {
  clearPendingMercadoPagoCheckout,
  clearPendingTurnoCheckout,
  readPendingMercadoPagoCheckout,
  readPendingTurnoCheckout,
  syncLeagueMercadoPagoPayment,
  syncTournamentMercadoPagoPayment,
  syncTurnoMercadoPagoPayment,
  updatePendingMercadoPagoCheckout,
} from "./src/services/mercadoPagoCheckoutService";
import {
  clearPendingLeagueMercadoPagoAttempt,
  clearPendingLeagueMercadoPagoAttempts,
} from "./src/services/leaguesService";
import { clearPendingTournamentMercadoPagoAttempt } from "./src/services/tournamentsService";
import { cancelPendingMercadoPagoReservation } from "./src/services/turnosService";

const navigationRef = createNavigationContainerRef();
let pendingCheckoutNavigation = null;
let lastCheckoutReturnHandledAt = 0;
const LEAGUE_PENDING_RECOVERY_GRACE_MS = 20000;

function buildCheckoutNavigationPayload(url = "", depth = 0) {
  if (!url || depth > 2) {
    return null;
  }

  const parsed = ExpoLinking.parse(url);
  const host = String(parsed.hostname || parsed.host || "").trim().toLowerCase();
  const path = String(parsed.path || "").trim().toLowerCase();
  const normalizedPath = path.replace(/^\/+/, "");
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  const isCheckoutHost = host === "checkout";
  const isCheckoutPath = pathSegments[0] === "checkout";
  const queryParams = parsed.queryParams || {};
  const nestedUrl = String(
    queryParams.url || queryParams.redirect_uri || queryParams.redirectUrl || ""
  ).trim();

  devLog("[mercadoPagoCheckout] Deep link recibido:", {
    host,
    path,
    queryParams,
    rawUrl: String(url || ""),
  });

  if (!isCheckoutHost && !isCheckoutPath && nestedUrl) {
    return buildCheckoutNavigationPayload(nestedUrl, depth + 1);
  }

  if (!isCheckoutHost && !isCheckoutPath) {
    return null;
  }

  if (pathSegments[pathSegments.length - 1] === "oauth") {
    return null;
  }

  const status = pathSegments[pathSegments.length - 1] || "pending";

  return {
    name: "MercadoPagoReturn",
    params: {
      batchCount: Number(queryParams.batch_count || 0) || 0,
      externalReference: String(queryParams.external_reference || "").trim(),
      leagueId: String(queryParams.leagueId || "").trim(),
      pairId: String(queryParams.pairId || "").trim(),
      participantId: String(queryParams.participantId || "").trim(),
      playerId: String(queryParams.playerId || "").trim(),
      registrationId: String(queryParams.registrationId || "").trim(),
      status,
      roundId: String(queryParams.roundId || "").trim(),
      reservationId: String(
        queryParams.external_reference || queryParams.reservationId || ""
      ).trim(),
      paymentId: String(queryParams.payment_id || queryParams.collection_id || "").trim(),
      source: String(queryParams.source || "turnos").trim().toLowerCase(),
      tournamentId: String(queryParams.tournamentId || "").trim(),
    },
  };
}

async function navigateFromCheckoutUrl(url = "") {
  const payload = buildCheckoutNavigationPayload(url);

  if (!payload) {
    devLog("[mercadoPagoCheckout] Deep link ignorado:", {
      rawUrl: String(url || ""),
    });
    return false;
  }

  devLog("[mercadoPagoCheckout] Navegando retorno Checkout Pro:", payload);
  lastCheckoutReturnHandledAt = Date.now();

  if (payload?.params?.source === "leagues") {
    await updatePendingMercadoPagoCheckout({
      externalReference: String(payload?.params?.externalReference || "").trim(),
      paymentId: String(payload?.params?.paymentId || "").trim(),
      status: String(payload?.params?.status || "pending").trim().toLowerCase(),
    }).catch(() => {});

    const paymentId = String(payload?.params?.paymentId || "").trim();
    const leagueId = String(payload?.params?.leagueId || "").trim();
    const participantId = String(payload?.params?.participantId || "").trim();
    const roundId = String(payload?.params?.roundId || "").trim();

    if (paymentId && (leagueId || String(payload?.params?.externalReference || "").trim())) {
      try {
        const syncResult = await syncLeagueMercadoPagoPayment({
          batchTargets: Array.isArray(payload?.params?.batchTargets)
            ? payload.params.batchTargets
            : [],
          externalReference: String(payload?.params?.externalReference || "").trim(),
          leagueId,
          pairId: String(payload?.params?.pairId || "").trim(),
          participantId,
          paymentId,
          roundId,
        });

        const syncedStatus = String(
          syncResult?.mercadoPagoStatus || syncResult?.paymentStatus || ""
        )
          .trim()
          .toLowerCase();

        payload.params.status =
          syncedStatus === "approved" || syncedStatus === "pagado"
            ? "success"
            : ["rejected", "cancelled", "payment_issue", "failure"].includes(syncedStatus)
              ? "failure"
              : payload.params.status;
      } catch (error) {
        devLog(
          "[mercadoPagoCheckout] No pudimos sincronizar la liga inmediatamente despues del retorno:",
          error?.message || error
        );
      }
    }
  } else if (payload?.params?.source === "tournaments") {
    await updatePendingMercadoPagoCheckout({
      externalReference: String(payload?.params?.externalReference || "").trim(),
      paymentId: String(payload?.params?.paymentId || "").trim(),
      playerId: String(payload?.params?.playerId || "").trim(),
      registrationId: String(payload?.params?.registrationId || "").trim(),
      status: String(payload?.params?.status || "pending").trim().toLowerCase(),
      tournamentId: String(payload?.params?.tournamentId || "").trim(),
    }).catch(() => {});

    const paymentId = String(payload?.params?.paymentId || "").trim();
    const tournamentId = String(payload?.params?.tournamentId || "").trim();
    const registrationId = String(payload?.params?.registrationId || "").trim();
    const playerId = String(payload?.params?.playerId || "").trim();

    if (paymentId && (tournamentId || String(payload?.params?.externalReference || "").trim())) {
      try {
        const syncResult = await syncTournamentMercadoPagoPayment({
          externalReference: String(payload?.params?.externalReference || "").trim(),
          paymentId,
          playerId,
          registrationId,
          tournamentId,
        });

        const syncedStatus = String(
          syncResult?.mercadoPagoStatus || syncResult?.paymentStatus || ""
        )
          .trim()
          .toLowerCase();

        payload.params.status =
          syncedStatus === "approved"
            ? "success"
            : ["rejected", "cancelled", "failure"].includes(syncedStatus)
              ? "failure"
              : payload.params.status;
      } catch (error) {
        devLog(
          "[mercadoPagoCheckout] No pudimos sincronizar el torneo inmediatamente despues del retorno:",
          error?.message || error
        );
      }
    }
  } else if (payload?.params?.source === "turnos") {
    await updatePendingMercadoPagoCheckout({
      paymentId: String(payload?.params?.paymentId || "").trim(),
      status: String(payload?.params?.status || "pending").trim().toLowerCase(),
    }).catch(() => {});
  }

  if (Platform.OS === "ios") {
    WebBrowser.dismissBrowser().catch(() => {});
  }

  if (navigationRef.isReady()) {
    navigationRef.navigate(payload.name, payload.params);
  } else {
    pendingCheckoutNavigation = payload;
  }

  return true;
}

async function recoverPendingCheckoutResult({
  trigger = "startup",
  skipIfRecentReturn = true,
} = {}) {
  if (skipIfRecentReturn && Date.now() - lastCheckoutReturnHandledAt < 5000) {
    return null;
  }

  try {
    const pendingCheckout =
      (await readPendingMercadoPagoCheckout()) || (await readPendingTurnoCheckout());

    if (!pendingCheckout?.source) {
      return null;
    }

    const createdAt = Number(pendingCheckout.createdAt || 0);
    const pendingAgeMs = createdAt ? Date.now() - createdAt : 0;
    const isStale = createdAt && Date.now() - createdAt > 1000 * 60 * 30;

    if (isStale) {
      if (pendingCheckout.source === "turnos") {
        await clearPendingTurnoCheckout().catch(() => {});
      } else {
        await clearPendingMercadoPagoCheckout().catch(() => {});
      }
      return null;
    }

    if (
      pendingCheckout.source === "leagues" &&
      !String(pendingCheckout.paymentId || "").trim()
    ) {
      const hasExternalReference = Boolean(
        String(pendingCheckout.externalReference || "").trim()
      );
      const shouldKeepWaiting =
        !hasExternalReference || pendingAgeMs < LEAGUE_PENDING_RECOVERY_GRACE_MS;

      if (!shouldKeepWaiting) {
        devLog(
          "[mercadoPagoCheckout] Intentando recuperar la liga por externalReference despues del tiempo de espera.",
          {
            hasExternalReference,
            pendingAgeMs,
            trigger,
          }
        );
      }

      if (!shouldKeepWaiting) {
        // Continuamos con la sincronizacion normal por externalReference.
      } else {
        devLog(
          "[mercadoPagoCheckout] Se omite la recuperacion automatica de liga hasta recibir el paymentId del retorno.",
          {
            hasExternalReference,
            pendingAgeMs,
            trigger,
          }
        );
        return null;
      }
    }

    devLog("[mercadoPagoCheckout] Recuperando checkout pendiente:", pendingCheckout);

    let syncedStatus = String(pendingCheckout.status || "pending").trim().toLowerCase();
    let shouldCancelReservation = false;

    try {
      const syncResult =
        pendingCheckout.source === "leagues"
          ? await syncLeagueMercadoPagoPayment({
              batchTargets: Array.isArray(pendingCheckout.batchTargets)
                ? pendingCheckout.batchTargets
                : [],
              leagueId: pendingCheckout.leagueId || "",
              externalReference: pendingCheckout.externalReference || "",
              pairId: pendingCheckout.pairId || "",
              participantId: pendingCheckout.participantId || "",
              paymentId: pendingCheckout.paymentId || "",
              roundId: pendingCheckout.roundId || "",
            })
          : pendingCheckout.source === "tournaments"
          ? await syncTournamentMercadoPagoPayment({
              externalReference: pendingCheckout.externalReference || "",
              paymentId: pendingCheckout.paymentId || "",
              playerId: pendingCheckout.playerId || "",
              registrationId: pendingCheckout.registrationId || "",
              tournamentId: pendingCheckout.tournamentId || "",
            })
          : await syncTurnoMercadoPagoPayment({
              paymentId: pendingCheckout.paymentId || "",
              reservationId: pendingCheckout.reservationId || "",
            });

      syncedStatus = String(
        syncResult?.mercadoPagoStatus || syncResult?.paymentStatus || syncedStatus
      )
        .trim()
        .toLowerCase();
    } catch (error) {
      if (error?.code === "payment_not_found" && pendingCheckout.source === "turnos") {
        shouldCancelReservation = true;
        syncedStatus = "failure";
      } else if (error?.code === "payment_not_found" && pendingCheckout.source === "tournaments") {
        await clearPendingTournamentMercadoPagoAttempt(
          pendingCheckout.tournamentId || "",
          pendingCheckout.registrationId || "",
          pendingCheckout.playerId || "",
          "payment_not_completed"
        ).catch(() => {});
        await clearPendingMercadoPagoCheckout().catch(() => {});
        syncedStatus = "failure";
      } else if (error?.code === "payment_not_found") {
        const hasPaymentId = Boolean(String(pendingCheckout.paymentId || "").trim());
        const exceededLeagueGraceWindow =
          pendingCheckout.source === "leagues" &&
          !hasPaymentId &&
          pendingAgeMs >= LEAGUE_PENDING_RECOVERY_GRACE_MS;

        syncedStatus = exceededLeagueGraceWindow ? "failure" : "pending";
        const failedSyncAttempts = Number(pendingCheckout.failedSyncAttempts || 0) + 1;

        if (pendingCheckout.source === "leagues" && exceededLeagueGraceWindow) {
          if (Array.isArray(pendingCheckout.batchTargets) && pendingCheckout.batchTargets.length > 1) {
            await clearPendingLeagueMercadoPagoAttempts(
              pendingCheckout.leagueId || "",
              pendingCheckout.batchTargets,
              "payment_not_completed"
            ).catch(() => {});
          } else {
            await clearPendingLeagueMercadoPagoAttempt(
              pendingCheckout.leagueId || "",
              pendingCheckout.roundId || "",
              pendingCheckout.participantId || "",
              "payment_not_completed"
            ).catch(() => {});
          }
          await clearPendingMercadoPagoCheckout().catch(() => {});
          devLog(
            "[mercadoPagoCheckout] No encontramos un pago real para la liga despues de varios intentos. Marcamos el checkout como no aprobado.",
            {
              leagueId: pendingCheckout.leagueId || "",
              participantId: pendingCheckout.participantId || "",
              roundId: pendingCheckout.roundId || "",
            }
          );
        } else if (pendingCheckout.source === "leagues" && failedSyncAttempts >= 2) {
          if (Array.isArray(pendingCheckout.batchTargets) && pendingCheckout.batchTargets.length > 1) {
            await clearPendingLeagueMercadoPagoAttempts(
              pendingCheckout.leagueId || "",
              pendingCheckout.batchTargets,
              "payment_not_completed"
            ).catch(() => {});
          } else {
            await clearPendingLeagueMercadoPagoAttempt(
              pendingCheckout.leagueId || "",
              pendingCheckout.roundId || "",
              pendingCheckout.participantId || "",
              "payment_not_completed"
            ).catch(() => {});
          }
          await clearPendingMercadoPagoCheckout().catch(() => {});
          devLog(
            "[mercadoPagoCheckout] No encontramos un pago real para la liga despues de varios intentos. Marcamos el checkout como no aprobado.",
            {
              leagueId: pendingCheckout.leagueId || "",
              participantId: pendingCheckout.participantId || "",
              roundId: pendingCheckout.roundId || "",
            }
          );
          syncedStatus = "failure";
        } else if (failedSyncAttempts >= 3) {
          await clearPendingMercadoPagoCheckout().catch(() => {});
          devLog("[mercadoPagoCheckout] Checkout pendiente de liga limpiado tras multiples intentos sin encontrar el pago.", {
            leagueId: pendingCheckout.leagueId || "",
            participantId: pendingCheckout.participantId || "",
            roundId: pendingCheckout.roundId || "",
          });
          return null;
        }

        if (syncedStatus !== "failure") {
          await updatePendingMercadoPagoCheckout({
            failedSyncAttempts,
          }).catch(() => {});
        }
      }

      devLog(
        "[mercadoPagoCheckout] No pudimos sincronizar automaticamente el checkout pendiente:",
        error?.message || error
      );
    }

    if (shouldCancelReservation) {
      await cancelPendingMercadoPagoReservation(
        pendingCheckout.reservationId,
        "payment_not_completed"
      ).catch(() => {});
      await clearPendingTurnoCheckout().catch(() => {});
    }

    const normalizedStatus =
      syncedStatus === "approved" || syncedStatus === "pagado"
        ? "success"
        : ["rejected", "cancelled", "payment_issue", "failure"].includes(syncedStatus)
          ? "failure"
          : "pending";

    devLog("[mercadoPagoCheckout] Resultado recuperado del checkout pendiente:", {
      normalizedStatus,
      trigger,
    });

    return {
      name: "MercadoPagoReturn",
      params: {
        batchCount: Number(pendingCheckout.batchCount || 0) || 0,
        batchTargets: Array.isArray(pendingCheckout.batchTargets)
          ? pendingCheckout.batchTargets
          : [],
        externalReference: String(pendingCheckout.externalReference || "").trim(),
        leagueId: String(pendingCheckout.leagueId || "").trim(),
        pairId: String(pendingCheckout.pairId || "").trim(),
        participantId: String(pendingCheckout.participantId || "").trim(),
        playerId: String(pendingCheckout.playerId || "").trim(),
        registrationId: String(pendingCheckout.registrationId || "").trim(),
        status: normalizedStatus,
        roundId: String(pendingCheckout.roundId || "").trim(),
        reservationId: String(pendingCheckout.reservationId || "").trim(),
        paymentId: String(pendingCheckout.paymentId || "").trim(),
        source: String(pendingCheckout.source || "turnos").trim().toLowerCase(),
        tournamentId: String(pendingCheckout.tournamentId || "").trim(),
      },
    };
  } catch (error) {
    devLog(
      "[mercadoPagoCheckout] No pudimos recuperar el checkout pendiente:",
      error?.message || error
    );
    return null;
  }
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
      info: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    devLog("[RootErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.title}>PadelNexo encontro un error</Text>
            <Text style={styles.subtitle}>
              Esta pantalla nos ayuda a ver exactamente que esta fallando en el build.
            </Text>

            <View style={styles.block}>
              <Text style={styles.blockLabel}>Mensaje</Text>
              <Text style={styles.blockText}>
                {String(this.state.error?.message || this.state.error || "Error desconocido")}
              </Text>
            </View>

            {this.state.error?.stack ? (
              <View style={styles.block}>
                <Text style={styles.blockLabel}>Stack</Text>
                <Text style={styles.stackText}>{String(this.state.error.stack)}</Text>
              </View>
            ) : null}

            {this.state.info?.componentStack ? (
              <View style={styles.block}>
                <Text style={styles.blockLabel}>Componente</Text>
                <Text style={styles.stackText}>{String(this.state.info.componentStack)}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
}

export default function App() {
  const linkingUrl = ExpoLinking.useLinkingURL();
  const [isCheckoutBootstrapping, setIsCheckoutBootstrapping] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const handleUrlEvent = ({ url }) => {
      navigateFromCheckoutUrl(String(url || "")).catch(() => {});
    };

    const bootstrapCheckoutReturn = async () => {
      try {
        const initialUrl = await Linking.getInitialURL().catch(() => "");
        const handledInitialUrl = initialUrl
          ? await navigateFromCheckoutUrl(String(initialUrl || ""))
          : false;

        if (!handledInitialUrl) {
          const recoveredPayload = await recoverPendingCheckoutResult({
            trigger: "startup",
            skipIfRecentReturn: false,
          });

          if (recoveredPayload) {
            if (navigationRef.isReady()) {
              navigationRef.navigate(recoveredPayload.name, recoveredPayload.params);
            } else {
              pendingCheckoutNavigation = recoveredPayload;
            }
          }
        }
      } finally {
        if (isMounted) {
          setIsCheckoutBootstrapping(false);
        }
      }
    };

    bootstrapCheckoutReturn();

    const subscription = Linking.addEventListener("url", handleUrlEvent);

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!linkingUrl) {
      return;
    }

    devLog("[mercadoPagoCheckout] useLinkingURL detecto:", linkingUrl);
    navigateFromCheckoutUrl(String(linkingUrl || "")).catch(() => {});
  }, [linkingUrl]);

  useEffect(() => {
    let recoveryTimeoutId = null;

    const scheduleRecovery = (trigger = "app_active") => {
      if (recoveryTimeoutId) {
        clearTimeout(recoveryTimeoutId);
      }

      recoveryTimeoutId = setTimeout(async () => {
        const payload = await recoverPendingCheckoutResult({ trigger });

        if (!payload) {
          return;
        }

        if (navigationRef.isReady()) {
          navigationRef.navigate(payload.name, payload.params);
        } else {
          pendingCheckoutNavigation = payload;
        }
      }, 450);
    };

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && !isCheckoutBootstrapping) {
        scheduleRecovery("app_active");
      }
    });

    return () => {
      if (recoveryTimeoutId) {
        clearTimeout(recoveryTimeoutId);
      }
      appStateSubscription.remove();
    };
  }, [isCheckoutBootstrapping]);

  return (
    <RootErrorBoundary>
      <AuthProvider>
        <NavigationContainer
          ref={navigationRef}
          onReady={() => {
            if (pendingCheckoutNavigation) {
              navigationRef.navigate(
                pendingCheckoutNavigation.name,
                pendingCheckoutNavigation.params
              );
              pendingCheckoutNavigation = null;
            }
          }}
        >
          <StatusBar style="dark" />
          <AppNavigator />
          {isCheckoutBootstrapping ? (
            <View pointerEvents="none" style={styles.checkoutBootstrapOverlay}>
              <View style={styles.checkoutBootstrapCard}>
                <ActivityIndicator color={colors.primaryDark} size="small" />
                <Text style={styles.checkoutBootstrapText}>Retomando el pago...</Text>
              </View>
            </View>
          ) : null}
        </NavigationContainer>
      </AuthProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  block: {
    marginTop: spacing.lg,
  },
  checkoutBootstrapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "rgba(244, 246, 248, 0.92)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  checkoutBootstrapCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  checkoutBootstrapText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  blockLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  blockText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  stackText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
});
