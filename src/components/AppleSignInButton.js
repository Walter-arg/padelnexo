import { useEffect, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

import { spacing } from "../config/theme";

function buildFullName(fullName) {
  if (!fullName) {
    return "";
  }

  return [fullName.givenName, fullName.familyName].filter(Boolean).join(" ").trim();
}

export default function AppleSignInButton({ disabled = false, onSuccess, onError }) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }

    AppleAuthentication.isAvailableAsync()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  if (Platform.OS !== "ios" || !available) {
    return null;
  }

  const handlePress = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        return;
      }

      onSuccess?.(credential.identityToken, buildFullName(credential.fullName));
    } catch (error) {
      if (error?.code === "ERR_REQUEST_CANCELED") {
        return;
      }

      onError?.(error);
    }
  };

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={16}
      disabled={disabled}
      onPress={handlePress}
      style={styles.button}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    marginBottom: spacing.sm,
    width: "100%",
  },
});
