import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../config/theme";
import devLog from "../utils/devLog";
import {
  getPlansOffering,
  purchasePlanPackage,
  restorePlanPurchases,
} from "../services/purchasesService";
import AppButton from "./AppButton";
import FeedbackModal from "./FeedbackModal";

// El identifier de cada package en RevenueCat debe seguir esta convencion
// para que el paywall los pueda mapear: "<plan>_mensual" / "<plan>_anual",
// ej. "plus_anual" -> producto nexo_plus_anual en las tiendas.
const PLAN_TIERS = [
  {
    key: "simple",
    label: "Nexo Simple",
    description: "Para empezar a organizar con lo esencial.",
    features: ["Hasta 3 canchas", "3 ligas por mes", "2 torneos por mes", "Gestion desde la app"],
  },
  {
    key: "plus",
    label: "Nexo Plus",
    description: "El plan mas elegido por organizadores activos.",
    features: [
      "Hasta 6 canchas",
      "6 ligas por mes",
      "4 torneos por mes",
      "Turnos online + acceso web",
    ],
  },
  {
    key: "premium",
    label: "Nexo Premium",
    description: "Sin limites para organizadores de alto volumen.",
    features: [
      "Canchas ilimitadas",
      "Ligas y torneos ilimitados",
      "Turnos online + acceso web",
      "Soporte prioritario",
    ],
  },
];

const BILLING_CYCLES = [
  { key: "mensual", label: "Mensual" },
  { key: "anual", label: "Anual" },
];

function findPackage(offering, planKey, cycle) {
  if (!offering?.availablePackages) return null;
  const identifier = `${planKey}_${cycle}`;
  return offering.availablePackages.find((pkg) => pkg.identifier === identifier) || null;
}

export default function PlansPaywallModal({ visible, onClose, onPurchaseSuccess }) {
  const insets = useSafeAreaInsets();
  const [offering, setOffering] = useState(null);
  const [isLoadingOffering, setIsLoadingOffering] = useState(true);
  const [billingCycle, setBillingCycle] = useState("mensual");
  const [purchasingPlan, setPurchasingPlan] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!visible) return;

    let isCancelled = false;
    setIsLoadingOffering(true);

    getPlansOffering()
      .then((current) => {
        if (!isCancelled) setOffering(current);
      })
      .catch((error) => {
        devLog("[PlansPaywallModal] Error al cargar oferta:", error?.message || error);
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingOffering(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [visible]);

  const plansWithPackages = useMemo(
    () =>
      PLAN_TIERS.map((tier) => ({
        ...tier,
        pkg: findPackage(offering, tier.key, billingCycle),
      })),
    [offering, billingCycle]
  );

  const handlePurchase = async (tier) => {
    if (!tier.pkg || purchasingPlan) return;
    setPurchasingPlan(tier.key);
    try {
      await purchasePlanPackage(tier.pkg);
      setFeedback({
        title: "Plan activado",
        message: `${tier.label} ya esta activo en tu cuenta.`,
        tone: "default",
      });
      onPurchaseSuccess?.(tier.key);
    } catch (error) {
      if (error?.userCancelled) return;
      devLog("[PlansPaywallModal] Error de compra:", error?.message || error);
      setFeedback({
        title: "No pudimos completar la compra",
        message: error?.message || "Intenta de nuevo en unos minutos.",
        tone: "danger",
      });
    } finally {
      setPurchasingPlan(null);
    }
  };

  const handleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    try {
      const customerInfo = await restorePlanPurchases();
      const hasActiveEntitlement = Object.keys(customerInfo?.entitlements?.active || {}).length > 0;
      setFeedback({
        title: hasActiveEntitlement ? "Compras restauradas" : "Sin compras para restaurar",
        message: hasActiveEntitlement
          ? "Encontramos tu suscripcion activa y la vinculamos a tu cuenta."
          : "No encontramos ninguna suscripcion activa asociada a tu cuenta de la tienda.",
        tone: hasActiveEntitlement ? "default" : "warning",
      });
      if (hasActiveEntitlement) {
        onPurchaseSuccess?.(null);
      }
    } catch (error) {
      devLog("[PlansPaywallModal] Error al restaurar:", error?.message || error);
      setFeedback({
        title: "No pudimos restaurar tus compras",
        message: error?.message || "Intenta de nuevo en unos minutos.",
        tone: "danger",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.handle} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Planes para organizadores</Text>
            <Text style={styles.subtitle}>
              Elegi el plan que mejor se adapte a tus ligas y torneos.
            </Text>

            <View style={styles.cycleToggle}>
              {BILLING_CYCLES.map((cycle) => (
                <Pressable
                  key={cycle.key}
                  onPress={() => setBillingCycle(cycle.key)}
                  style={[
                    styles.cycleOption,
                    billingCycle === cycle.key && styles.cycleOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.cycleOptionText,
                      billingCycle === cycle.key && styles.cycleOptionTextActive,
                    ]}
                  >
                    {cycle.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {isLoadingOffering ? (
              <ActivityIndicator color={colors.primary} style={styles.loader} />
            ) : (
              plansWithPackages.map((tier) => (
                <View key={tier.key} style={styles.planCard}>
                  <Text style={styles.planLabel}>{tier.label}</Text>
                  <Text style={styles.planDescription}>{tier.description}</Text>
                  <Text style={styles.planPrice}>
                    {tier.pkg
                      ? `${tier.pkg.product.priceString} / ${billingCycle === "anual" ? "año" : "mes"}`
                      : "No disponible por ahora"}
                  </Text>
                  {tier.features.map((feature) => (
                    <Text key={feature} style={styles.planFeature}>
                      {"•"} {feature}
                    </Text>
                  ))}
                  <AppButton
                    disabled={!tier.pkg || Boolean(purchasingPlan)}
                    onPress={() => handlePurchase(tier)}
                    title={purchasingPlan === tier.key ? "Procesando..." : "Suscribirme"}
                  />
                </View>
              ))
            )}

            <Text style={styles.disclosure}>
              La suscripcion se renueva automaticamente por el mismo periodo (mensual o anual)
              salvo que la canceles con al menos 24 horas de anticipacion desde los ajustes de tu
              cuenta de la tienda (App Store o Google Play). El pago se cobra a tu cuenta de la
              tienda al confirmar la compra. Podes administrar o cancelar tu suscripcion en
              cualquier momento desde los ajustes de tu dispositivo.{" "}
              <Text
                onPress={() => Linking.openURL("https://www.padelnexo.com.ar/terminos")}
                style={styles.disclosureLink}
              >
                Terminos de Uso
              </Text>{" "}
              ·{" "}
              <Text
                onPress={() => Linking.openURL("https://www.padelnexo.com.ar/privacidad")}
                style={styles.disclosureLink}
              >
                Politica de Privacidad
              </Text>
            </Text>

            <Pressable disabled={isRestoring} onPress={handleRestore} style={styles.restoreButton}>
              <Text style={styles.restoreButtonText}>
                {isRestoring ? "Restaurando..." : "Restaurar compras"}
              </Text>
            </Pressable>

            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Cerrar</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>

      <FeedbackModal
        message={feedback?.message}
        onClose={() => setFeedback(null)}
        title={feedback?.title}
        tone={feedback?.tone}
        visible={Boolean(feedback)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "88%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 3,
    height: 4,
    marginBottom: spacing.md,
    width: 40,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  cycleToggle: {
    backgroundColor: colors.secondary,
    borderRadius: 16,
    flexDirection: "row",
    marginBottom: spacing.lg,
    padding: 4,
  },
  cycleOption: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    paddingVertical: spacing.xs,
  },
  cycleOptionActive: {
    backgroundColor: colors.primary,
  },
  cycleOptionText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  cycleOptionTextActive: {
    color: colors.surface,
  },
  loader: {
    marginVertical: spacing.xl,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  planLabel: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  planDescription: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  planPrice: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  planFeature: {
    color: colors.text,
    fontSize: 13,
    marginBottom: 4,
  },
  disclosure: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  disclosureLink: {
    color: colors.primary,
    fontWeight: "700",
  },
  restoreButton: {
    alignItems: "center",
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
  },
  restoreButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  closeButton: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  closeButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
});
