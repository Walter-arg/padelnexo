import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";

function MiniBall({ style }) {
  return (
    <View pointerEvents="none" style={[styles.miniBall, style]}>
      <View style={styles.miniBallCurveLeft} />
      <View style={styles.miniBallCurveRight} />
    </View>
  );
}

export default function SectionHeader({ children, onBack, subtitle }) {
  const sectionTitle = String(subtitle || "").toUpperCase();

  return (
    <View style={styles.wrap}>
      <MiniBall style={styles.ballTopRight} />
      <MiniBall style={styles.ballBottomLeft} />
      <MiniBall style={styles.ballCenterSoft} />

      <Text pointerEvents="none" numberOfLines={1} style={styles.brand}>
        PadelNexo
      </Text>

      <View style={styles.row}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Ionicons color={colors.primaryDark} name="chevron-back" size={20} />
          </Pressable>
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}

        <Text numberOfLines={1} style={styles.sectionTitle}>
          {sectionTitle}
        </Text>

        <View style={styles.backButtonPlaceholder} />
      </View>

      {children ? <View style={styles.childrenWrap}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#F2FAF4",
    minHeight: 88,
    overflow: "visible",
    paddingBottom: 4,
    paddingTop:
      Platform.OS === "android"
        ? (StatusBar.currentHeight || 0) + 0
        : spacing.xs,
  },
  brand: {
    color: "rgba(18,86,60,0.28)",
    fontFamily: "serif",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0.8,
    lineHeight: 34,
    marginTop: -5,
    textAlign: "center",
  },
  miniBall: {
    backgroundColor: "rgba(192,222,64,0.42)",
    borderColor: "rgba(114,162,34,0.22)",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    overflow: "hidden",
    position: "absolute",
    width: 34,
  },
  miniBallCurveLeft: {
    borderColor: "rgba(255,255,255,0.86)",
    borderRadius: 999,
    borderWidth: 3,
    height: 42,
    left: -26,
    position: "absolute",
    top: -4,
    width: 34,
  },
  miniBallCurveRight: {
    borderColor: "rgba(255,255,255,0.78)",
    borderRadius: 999,
    borderWidth: 3,
    height: 42,
    position: "absolute",
    right: -26,
    top: -4,
    width: 34,
  },
  ballTopRight: {
    opacity: 0.62,
    right: 18,
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 8 : 12,
    transform: [{ rotate: "18deg" }],
  },
  ballBottomLeft: {
    bottom: 6,
    height: 26,
    left: 18,
    opacity: 0.35,
    transform: [{ rotate: "-16deg" }],
    width: 26,
  },
  ballCenterSoft: {
    bottom: 12,
    height: 20,
    opacity: 0.24,
    right: 88,
    transform: [{ rotate: "28deg" }],
    width: 20,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  sectionTitle: {
    color: "#1D8B45",
    flex: 1,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1.4,
    textAlign: "center",
    textShadowColor: "rgba(29,139,69,0.16)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
    borderColor: "rgba(29,139,69,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  backButtonPlaceholder: {
    height: 36,
    width: 36,
  },
  backButtonPressed: {
    opacity: 0.85,
  },
  childrenWrap: {
    paddingBottom: 8,
    paddingTop: 2,
  },
});

