import { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

const LOADING_SEGMENTS = Array.from({ length: 36 }, (_, index) => index);

export default function PadelNexoLoadingOverlay({
  message = "Cargando...",
  visible = false,
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 1500,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: 180,
          easing: Easing.in(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [progress, visible]);

  if (!visible) {
    return null;
  }

  return (
    <View pointerEvents="auto" style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.logoStage}>
          {LOADING_SEGMENTS.map((segment) => {
            const start = Math.max(segment / LOADING_SEGMENTS.length, 0.001);
            const end = Math.min(start + 0.045, 1);
            const opacity = progress.interpolate({
              inputRange: [0, start, end],
              outputRange: [0.18, 0.18, 1],
              extrapolate: "clamp",
            });
            const scaleX = progress.interpolate({
              inputRange: [0, start, end],
              outputRange: [0.4, 0.4, 1],
              extrapolate: "clamp",
            });

            return (
              <Animated.View
                key={segment}
                style={[
                  styles.segment,
                  {
                    opacity,
                    transform: [
                      { rotate: `${segment * (360 / LOADING_SEGMENTS.length)}deg` },
                      { translateY: -56 },
                      { scaleX },
                    ],
                  },
                ]}
              />
            );
          })}
          <View style={styles.logoFrame}>
            <Image
              resizeMode="contain"
              source={require("../../assets/loading-icon-rounded.png")}
              style={styles.logo}
            />
          </View>
        </View>
        <Text style={styles.brand}>PadelNexo</Text>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "rgba(245, 248, 246, 0.92)",
    justifyContent: "center",
    zIndex: 999,
  },
  card: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 28,
    borderWidth: 1,
    minWidth: 230,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  logoStage: {
    alignItems: "center",
    height: 132,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 132,
  },
  segment: {
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    height: 4,
    position: "absolute",
    width: 26,
  },
  logoFrame: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  logo: {
    height: 54,
    width: 54,
  },
  brand: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  text: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
