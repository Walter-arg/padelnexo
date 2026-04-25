import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function BallButton({
  label,
  subtitle,
  onPress,
  size = 220,
  style,
  compact = false,
}) {
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pressScale.setValue(1);
  }, [pressScale]);

  const handlePressIn = () => {
    Animated.spring(pressScale, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 18,
      bounciness: 7,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.pressable}
    >
      <Animated.View
        style={[
          styles.ball,
          {
            height: size,
            width: size,
            transform: [{ scale: pressScale }],
          },
          style,
        ]}
      >
        <View style={[styles.textureRing, styles.textureRingLeft]} />
        <View style={[styles.textureRing, styles.textureRingRight]} />
        <View style={styles.glow} />
        <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
        <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    backgroundColor: "transparent",
    overflow: "visible",
  },
  ball: {
    alignItems: "center",
    backgroundColor: colors.ball,
    borderColor: "rgba(255,255,255,0.45)",
    borderRadius: 999,
    borderWidth: 6,
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: colors.ballDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 3,
  },
  textureRing: {
    position: "absolute",
    top: -10,
    width: "78%",
    height: "115%",
    borderColor: "rgba(255,255,255,0.42)",
    borderWidth: 7,
    borderRadius: 999,
  },
  textureRingLeft: {
    left: "-40%",
  },
  textureRingRight: {
    right: "-40%",
  },
  glow: {
    position: "absolute",
    top: 22,
    left: 30,
    width: "34%",
    height: "18%",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    transform: [{ rotate: "-18deg" }],
  },
  label: {
    color: colors.ballText,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
  },
  subtitle: {
    color: "rgba(36,75,26,0.82)",
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.xs,
    textAlign: "center",
    width: "68%",
  },
  labelCompact: {
    fontSize: 22,
  },
  subtitleCompact: {
    fontSize: 11,
    width: "74%",
  },
});

