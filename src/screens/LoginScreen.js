import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import ScreenWrapper from "../components/ScreenWrapper";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export default function LoginScreen({ navigation }) {
  const { login, sendResetPassword, lastLoginEmail } = useAuth();
  const [mode, setMode] = useState("login");
  const [identifier, setIdentifier] = useState(lastLoginEmail || "");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  useEffect(() => {
    if (lastLoginEmail && !identifier) {
      setIdentifier(lastLoginEmail);
    }
  }, [identifier, lastLoginEmail]);

  const validateEmail = () => {
    const trimmedIdentifier = identifier.trim().toLowerCase();

    if (!trimmedIdentifier) {
      Alert.alert("Falta contacto", "Ingresa tu email para continuar.");
      return null;
    }

    if (!emailRegex.test(trimmedIdentifier)) {
      Alert.alert("Email invalido", "Para usar Firebase debes ingresar un email valido.");
      return null;
    }

    return trimmedIdentifier;
  };

  const handleLogin = async () => {
    const email = validateEmail();
    if (!email) {
      return;
    }

    if (!password.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu contraseña para continuar.");
      return;
    }

    try {
      await login({ email, password });
      Alert.alert("Sesion iniciada", "Accediste correctamente a PadelNexo.");
      navigation.goBack();
    } catch (error) {
      Alert.alert("No pudimos ingresar", error.message);
    }
  };

  const handleRequestRecovery = async () => {
    const email = validateEmail();
    if (!email) {
      return;
    }

    try {
      await sendResetPassword(email);
      Alert.alert("Link enviado", "Revisa tu email para recuperar el acceso.");
      setMode("login");
    } catch (error) {
      Alert.alert("No pudimos enviar el link", error.message);
    }
  };

  return (
    <ScreenWrapper>
      <View style={styles.card}>
        <Text style={styles.title}>
          {mode === "login" ? "Iniciar sesion" : "Recuperar acceso"}
        </Text>
        <Text style={styles.subtitle}>
          {mode === "login"
            ? "Ingresa con tu email para entrar rapido a PadelNexo."
            : "Te enviaremos un link para restablecer tu contraseña."}
        </Text>

        <AppInput
          autoCapitalize="none"
          autoComplete="email"
          containerStyle={styles.compactField}
          keyboardType="email-address"
          label="Email"
          onChangeText={setIdentifier}
          placeholder="tuemail@mail.com"
          value={identifier}
        />

        {mode === "login" ? (
          <AppInput
            autoComplete="password"
            containerStyle={styles.compactField}
            label="Contraseña"
            onChangeText={setPassword}
            placeholder="Ingrese contraseña"
            rightElement={
              <Pressable
                accessibilityLabel={
                  isPasswordVisible ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                hitSlop={8}
                onPress={() => setIsPasswordVisible((current) => !current)}
                style={styles.passwordToggle}
              >
                <Ionicons
                  color={colors.muted}
                  name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
                  size={20}
                />
              </Pressable>
            }
            secureTextEntry={!isPasswordVisible}
            value={password}
          />
        ) : null}

        {mode === "login" ? (
          <>
            <AppButton title="Ingresar" onPress={handleLogin} />
            <Pressable onPress={handleRequestRecovery} style={styles.recoverLink}>
              <Text style={styles.recoverText}>Olvidé mi contraseña</Text>
            </Pressable>
          </>
        ) : (
          <AppButton title="Enviar link de recuperacion" onPress={handleRequestRecovery} />
        )}

        <AppButton
          title={mode === "login" ? "Ir a recuperacion" : "Volver a login"}
          onPress={() => setMode(mode === "login" ? "recover" : "login")}
          style={styles.secondaryButton}
          textStyle={styles.secondaryButtonText}
          variant="secondary"
        />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  compactField: {
    marginBottom: spacing.sm,
  },
  passwordToggle: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  recoverLink: {
    alignItems: "center",
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  recoverText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    marginBottom: 0,
    marginTop: spacing.xs,
  },
  secondaryButtonText: {
    color: colors.text,
  },
});


