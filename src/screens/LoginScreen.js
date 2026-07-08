import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import FeedbackModal from "../components/FeedbackModal";
import GoogleSignInButton from "../components/GoogleSignInButton";
import ScreenWrapper from "../components/ScreenWrapper";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getLoginErrorTitle(message = "") {
  if (message.includes("bloqueada por 7 dias")) {
    return "CUENTA BLOQUEADA TEMPORALMENTE";
  }

  if (message.includes("bloqueada por acciones impropias")) {
    return "CUENTA BLOQUEADA";
  }

  return "No pudimos ingresar";
}

export default function LoginScreen({ navigation }) {
  const { login, loginWithGoogle, sendResetPassword, lastLoginEmail } = useAuth();
  const [mode, setMode] = useState("login");
  const [identifier, setIdentifier] = useState(lastLoginEmail || "");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ visible: false, title: "", message: "", tone: "default" });

  useEffect(() => {
    if (lastLoginEmail && !identifier) {
      setIdentifier(lastLoginEmail);
    }
  }, [identifier, lastLoginEmail]);

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({ visible: true, title, message, tone });
  };

  const validateEmail = () => {
    const trimmed = identifier.trim().toLowerCase();
    if (!trimmed) {
      showFeedback("Falta el email", "Ingresa tu email para continuar.", "danger");
      return null;
    }
    if (!emailRegex.test(trimmed)) {
      showFeedback("Email invalido", "Ingresa un email valido.", "danger");
      return null;
    }
    return trimmed;
  };

  const handleLogin = async () => {
    const email = validateEmail();
    if (!email) return;

    if (!password.trim()) {
      showFeedback("Falta la contraseña", "Ingresa tu contraseña para continuar.", "danger");
      return;
    }

    try {
      setSubmitting(true);
      await login({ email, password });
      navigation.goBack();
    } catch (error) {
      showFeedback(getLoginErrorTitle(error.message), error.message, "danger");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestRecovery = async () => {
    const email = validateEmail();
    if (!email) return;

    try {
      setSubmitting(true);
      await sendResetPassword(email);
      showFeedback(
        "Link enviado",
        "Revisa tu email para restablecer tu contraseña. Si no aparece, fijate en la carpeta de spam.",
        "success"
      );
    } catch (error) {
      showFeedback("No pudimos enviar el link", error.message, "danger");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleToken = async (idToken) => {
    try {
      setSubmitting(true);
      await loginWithGoogle(idToken);
      navigation.goBack();
    } catch (error) {
      showFeedback(getLoginErrorTitle(error.message), error.message, "danger");
    } finally {
      setSubmitting(false);
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

        {mode === "login" ? (
          <View style={styles.googleBlock}>
            <Text style={styles.googleBlockTitle}>Ingreso rapido</Text>
            <GoogleSignInButton
              onError={(error) =>
                showFeedback(
                  "No pudimos ingresar con Google",
                  error?.message || "Intenta nuevamente en unos instantes.",
                  "danger"
                )
              }
              onMissingConfig={() =>
                showFeedback(
                  "Google no configurado",
                  "Falta cargar el Client ID de Google para habilitar este ingreso.",
                  "danger"
                )
              }
              onSuccess={handleGoogleToken}
            />
          </View>
        ) : null}

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
            label={"Contraseña"}
            onChangeText={setPassword}
            placeholder={"Ingrese contraseña"}
            rightElement={
              <Pressable
                accessibilityLabel={isPasswordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                hitSlop={8}
                onPress={() => setIsPasswordVisible((c) => !c)}
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
            <AppButton
              disabled={submitting}
              title={submitting ? "Ingresando..." : "Ingresar"}
              onPress={handleLogin}
            />
            <Pressable onPress={() => setMode("recover")} style={styles.recoverLink}>
              <Text style={styles.recoverText}>Olvide mi contraseña</Text>
            </Pressable>
          </>
        ) : (
          <>
            <AppButton
              disabled={submitting}
              title={submitting ? "Enviando..." : "Enviar link de recuperacion"}
              onPress={handleRequestRecovery}
            />
            <Pressable onPress={() => setMode("login")} style={styles.recoverLink}>
              <Text style={styles.recoverText}>Volver al login</Text>
            </Pressable>
          </>
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() => {
          const wasSuccess = feedback.tone === "success";
          setFeedback((c) => ({ ...c, visible: false }));
          if (wasSuccess && mode === "recover") {
            setMode("login");
          }
        }}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
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
  googleBlock: {
    marginBottom: spacing.sm,
  },
  googleBlockTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  passwordToggle: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  recoverLink: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  recoverText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
});
