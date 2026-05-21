import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import { hasGoogleAuthConfig } from "../config/googleAuth";
import { configureGoogleSignIn, requestGoogleIdToken } from "../services/googleSignInService";

export default function GoogleSignInButton({
  disabled = false,
  onMissingConfig,
  onSuccess,
  onError,
}) {
  const [waitingForGoogle, setWaitingForGoogle] = useState(false);
  const configured = hasGoogleAuthConfig(Platform.OS);

  useEffect(() => {
    if (!configured) {
      return;
    }

    configureGoogleSignIn();
  }, [configured]);

  const handlePress = async () => {
    if (!configured) {
      onMissingConfig?.();
      return;
    }

    try {
      setWaitingForGoogle(true);
      const idToken = await requestGoogleIdToken({ forceAccountSelection: true });

      if (!idToken) {
        return;
      }

      onSuccess?.(idToken);
    } catch (error) {
      onError?.(error);
    } finally {
      setWaitingForGoogle(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>O</Text>
        <View style={styles.dividerLine} />
      </View>
      <Pressable
        disabled={disabled || waitingForGoogle || !configured}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.button,
          (disabled || waitingForGoogle || !configured) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <View style={styles.iconWrap}>
          <Ionicons color="#DB4437" name="logo-google" size={18} />
        </View>
        <Text style={styles.text}>
          {waitingForGoogle ? "Conectando con Google..." : "Ingresar con Google"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dividerLine: {
    backgroundColor: colors.border,
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E7EB",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  text: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
});
