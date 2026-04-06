import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";

function SectionBall({ subtitle }) {
  const normalizedSubtitle = String(subtitle || "").toUpperCase();
  const isLongTitle = normalizedSubtitle.length >= 8;
  const isVeryLongTitle = normalizedSubtitle.length >= 9;

  return (
    <View pointerEvents="none" style={styles.ballWrap}>
      <View style={styles.ballShadow} />
      <View style={styles.ball}>
        <View style={styles.ballStripePrimary} />
        <View style={styles.ballStripeSecondary} />
        <Text
          numberOfLines={2}
          style={[
            styles.ballTitle,
            isLongTitle && styles.ballTitleLong,
            isVeryLongTitle && styles.ballTitleVeryLong,
          ]}
        >
          {normalizedSubtitle}
        </Text>
      </View>
    </View>
  );
}

export default function SectionHeader({ children, onBack, subtitle }) {
  return (
    <View style={styles.wrap}>
      <SectionBall subtitle={subtitle} />
      <View style={styles.row}>
        <View style={styles.leftBlock}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            >
              <Ionicons color={colors.text} name="chevron-back" size={20} />
            </Pressable>
          ) : null}
          <Text style={styles.brand}>PadelNexo</Text>
        </View>
      </View>
      {children ? <View style={styles.childrenWrap}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    overflow: "hidden",
    paddingBottom: 6,
    paddingTop:
      Platform.OS === "android"
        ? (StatusBar.currentHeight || 0) + spacing.xs
        : spacing.md,
  },
  row: {
    justifyContent: "center",
    minHeight: 58,
    paddingLeft: spacing.sm,
    paddingRight: 132,
  },
  leftBlock: {
    alignItems: "center",
    flexDirection: "row",
  },
  brand: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
    lineHeight: 28,
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderColor: "rgba(207,231,220,0.95)",
    borderRadius: 999,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 38,
  },
  backButtonPressed: {
    opacity: 0.9,
  },
  childrenWrap: {
    paddingBottom: 4,
  },
  ballWrap: {
    height: 156,
    position: "absolute",
    right: -48,
    top: -34,
    width: 156,
  },
  ballShadow: {
    backgroundColor: "rgba(11,132,87,0.16)",
    borderRadius: 999,
    bottom: 8,
    left: 18,
    position: "absolute",
    right: 4,
    top: 20,
  },
  ball: {
    alignItems: "center",
    backgroundColor: "#B7DD46",
    borderColor: "#8EB631",
    borderRadius: 999,
    borderWidth: 2,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  ballStripePrimary: {
    borderColor: "#F4F7EC",
    borderRadius: 999,
    borderWidth: 8,
    height: 180,
    left: -58,
    position: "absolute",
    top: -10,
    width: 132,
  },
  ballStripeSecondary: {
    borderColor: "#F4F7EC",
    borderRadius: 999,
    borderWidth: 8,
    height: 180,
    position: "absolute",
    right: -56,
    top: -8,
    width: 132,
  },
  ballTitle: {
    color: "#234315",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 18,
    maxWidth: 88,
    position: "absolute",
    right: 52,
    textAlign: "center",
    top: 62,
    transform: [{ rotate: "-12deg" }],
  },
  ballTitleLong: {
    maxWidth: 102,
    right: 64,
  },
  ballTitleVeryLong: {
    fontSize: 14,
    lineHeight: 15,
    maxWidth: 118,
    right: 56,
    top: 65,
  },
});
