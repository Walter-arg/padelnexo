import { Pressable, StyleSheet, Text } from "react-native";

import { colors, spacing } from "../config/theme";

export default function AppButton({
  title,
  onPress,
  variant = "primary",
  style,
  textStyle: customTextStyle,
  disabled = false,
}) {
  const buttonStyle =
    variant === "secondary" ? styles.buttonSecondary : styles.buttonPrimary;
  const textStyle =
    variant === "secondary" ? styles.textSecondary : styles.textPrimary;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buttonBase,
        buttonStyle,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      <Text style={[styles.textBase, textStyle, customTextStyle]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    alignItems: "center",
    borderRadius: 18,
    justifyContent: "center",
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  buttonSecondary: {
    backgroundColor: colors.secondary,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  textBase: {
    fontSize: 16,
    fontWeight: "700",
  },
  textPrimary: {
    color: colors.surface,
  },
  textSecondary: {
    color: colors.primary,
  },
});

