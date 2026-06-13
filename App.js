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
import { AuthProvider } from "./src/context/AuthContext";
import { colors, spacing } from "./src/config/theme";
import {
  clearPendingTurnoCheckout,
  readPendingTurnoCheckout,
  syncTurnoMercadoPagoPayment,
} from "./src/services/mercadoPagoCheckoutService";
import { cancelPendingMercadoPagoReservation } from "./src/services/turnosService";

const navigationRef = createNavigationContainerRef();
let pendingCheckoutNavigation = null;
let lastCheckoutReturnHandledAt = 0;

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

  console.log("[mercadoPagoCheckout] Deep link recibido:", {
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

  const status = pathSegments[pathSegments.length - 1] || "pending";

  return {
    name: "MercadoPagoReturn",
    params: {
      status,
      reservationId: String(
        queryParams.external_reference || queryParams.reservationId || ""
      ).trim(),
      paymentId: String(queryParams.payment_id || queryParams.collection_id || "").trim(),
    },
  };
}

function navigateFromCheckoutUrl(url = "") {
  const payload = buildCheckoutNavigationPayload(url);

  if (!payload) {
    console.log("[mercadoPagoCheckout] Deep link ignorado:", {
      rawUrl: String(url || ""),
    });
    return false;
  }

  console.log("[mercadoPagoCheckout] Navegando retorno Checkout Pro:", payload);
  lastCheckoutReturnHandledAt = Date.now();

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
    const pendingCheckout = await readPendingTurnoCheckout();

    if (!pendingCheckout?.reservationId) {
      return null;
    }

    const createdAt = Number(pendingCheckout.createdAt || 0);
    const isStale = createdAt && Date.now() - createdAt > 1000 * 60 * 30;

    if (isStale) {
      await clearPendingTurnoCheckout().catch(() => {});
      return null;
    }

    console.log("[mercadoPagoCheckout] Recuperando checkout pendiente:", pendingCheckout);

    let syncedStatus = String(pendingCheckout.status || "pending").trim().toLowerCase();
    let shouldCancelReservation = false;

    try {
      const syncResult = await syncTurnoMercadoPagoPayment({
        paymentId: pendingCheckout.paymentId || "",
        reservationId: pendingCheckout.reservationId || "",
      });

      syncedStatus = String(
        syncResult?.mercadoPagoStatus || syncResult?.paymentStatus || syncedStatus
      )
        .trim()
        .toLowerCase();
    } catch (error) {
      if (error?.code === "payment_not_found") {
        shouldCancelReservation = true;
        syncedStatus = "failure";
      }

      console.log(
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

    console.log("[mercadoPagoCheckout] Resultado recuperado del checkout pendiente:", {
      normalizedStatus,
      trigger,
    });

    return {
      name: "MercadoPagoReturn",
      params: {
        status: normalizedStatus,
        reservationId: String(pendingCheckout.reservationId || "").trim(),
        paymentId: String(pendingCheckout.paymentId || "").trim(),
      },
    };
  } catch (error) {
    console.log(
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
    console.log("[RootErrorBoundary]", error, info);
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
      navigateFromCheckoutUrl(String(url || ""));
    };

    const bootstrapCheckoutReturn = async () => {
      try {
        const initialUrl = await Linking.getInitialURL().catch(() => "");
        const handledInitialUrl = initialUrl
          ? navigateFromCheckoutUrl(String(initialUrl || ""))
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

    console.log("[mercadoPagoCheckout] useLinkingURL detecto:", linkingUrl);
    navigateFromCheckoutUrl(String(linkingUrl || ""));
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
