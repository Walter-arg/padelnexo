import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  avatarColors,
  playerCategories,
  sexOptions,
} from "../data/profileOptions";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import AppButton from "./AppButton";
import AppInput from "./AppInput";
import CountryCodeSelector from "./CountryCodeSelector";
import FeedbackModal from "./FeedbackModal";
import LocationPicker from "./LocationPicker";
import SelectField from "./SelectField";
import { defaultPhoneCountry, phoneCountryOptions } from "../data/phoneCountryOptions";

const NAME_REGEX = /^[A-Za-z\u00c0-\u00ff\s]+$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const categoryOptions = playerCategories.map((option) => ({
  label: option,
  value: option,
}));

const sexDropdownOptions = sexOptions.map((option) => ({
  label: option,
  value: option,
}));
const preferredSideOptions = [
  { label: "Drive", value: "drive" },
  { label: "Reves", value: "reves" },
  { label: "Ambos lados", value: "ambos" },
];

const dominantHandOptions = [
  { label: "Derecha", value: "Derecha" },
  { label: "Izquierda", value: "Izquierda" },
];

const sanitizeName = (value) => value.replace(/[^A-Za-z\u00c0-\u00ff\s]/g, "");
const MIN_PASSWORD_LENGTH = 4;
const sanitizePhoneValue = (value) => value.replace(/\D/g, "").slice(0, 16);
const hasValidPhoneDigits = (value) => value.replace(/\D/g, "").length >= 8;
const sanitizeLocalidadValue = (value) =>
  value.replace(/[^0-9A-Za-z\u00c0-\u00ff\s.'-]/g, "");


function sanitizeFullName(value) {
  const normalizedValue = sanitizeName(value)
    .toLowerCase()
    .replace(/^\s+/, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 30);

  const hasTrailingSpace = normalizedValue.endsWith(" ");
  const parts = normalizedValue.split(" ");
  const formattedParts = [];

  for (const part of parts) {
    if (!part) {
      continue;
    }

    if (formattedParts.length >= 3) {
      break;
    }

    const trimmedWord = part.slice(0, 12);
    formattedParts.push(
      `${trimmedWord.charAt(0).toUpperCase()}${trimmedWord.slice(1)}`
    );
  }

  const joinedValue = formattedParts.join(" ");

  if (hasTrailingSpace && formattedParts.length > 0 && formattedParts.length < 3) {
    return `${joinedValue} `;
  }

  return joinedValue;
}

function hasValidFullName(value) {
  const words = value.trim().split(/\s+/).filter(Boolean);

  if (!words.length || words.length > 3) {
    return false;
  }

  return value.trim().length <= 30 && words.every((word) => word.length <= 12);
}

function isValidLocalidad(localidad, inputValue) {
  return Boolean(
    localidad?.nombre &&
      localidad?.provincia &&
      localidad?.pais &&
      localidad.nombre === inputValue.trim()
  );
}

export default function LoginModal({ onClose, onLogin, visible }) {
  const { login, register, sendResetPassword, lastLoginEmail } = useAuth();
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [isPhonePublic, setIsPhonePublic] = useState(false);
  const [selectedPhoneCountry, setSelectedPhoneCountry] = useState(
    defaultPhoneCountry?.country || "Argentina"
  );
  const [countryCode, setCountryCode] = useState(defaultPhoneCountry?.code || "+54");
  const [localidadInput, setLocalidadInput] = useState("");
  const [localidad, setLocalidad] = useState(null);
  const [category, setCategory] = useState("");
  const [sex, setSex] = useState("");
  const [ladoJuego, setLadoJuego] = useState("ambos");
  const [manoHabil, setManoHabil] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isCategoryVisible, setIsCategoryVisible] = useState(false);
  const [isSexVisible, setIsSexVisible] = useState(false);
  const [isPreferredSideVisible, setIsPreferredSideVisible] = useState(false);
  const [isDominantHandVisible, setIsDominantHandVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setFeedback({
        visible: false,
        title: "",
        message: "",
        tone: "default",
      });
      setMode("login");
      setName("");
      setIdentifier(lastLoginEmail || "");
      setPhone("");
      setIsPhonePublic(false);
      setSelectedPhoneCountry(defaultPhoneCountry?.country || "Argentina");
      setCountryCode(defaultPhoneCountry?.code || "+54");
      setLocalidadInput("");
      setLocalidad(null);
      setCategory("");
      setSex("");
      setLadoJuego("ambos");
      setManoHabil("");
      setPassword("");
      setIsPasswordVisible(false);
      setIsCategoryVisible(false);
      setIsSexVisible(false);
      setIsPreferredSideVisible(false);
      setIsDominantHandVisible(false);
    }
  }, [lastLoginEmail, visible]);

  useEffect(() => {
    if (visible && mode !== "register" && !identifier && lastLoginEmail) {
      setIdentifier(lastLoginEmail);
    }
  }, [identifier, lastLoginEmail, mode, visible]);

  useEffect(() => {
    if (mode === "register") {
      setIdentifier("");
    }
  }, [mode]);

  const validateEmail = () => {
    const trimmedIdentifier = identifier.trim();

    if (!trimmedIdentifier) {
      setFeedback({
        visible: true,
        title: "Falta un dato de contacto",
        message: "Ingresa tu email para continuar.",
        tone: "danger",
      });
      return null;
    }

    if (!trimmedIdentifier.includes("@")) {
      setFeedback({
        visible: true,
        title: "Email no valido",
        message: "Debe ingresar un email v�lido.",
        tone: "danger",
      });
      return null;
    }

    if (!emailRegex.test(trimmedIdentifier)) {
      setFeedback({
        visible: true,
        title: "Email no valido",
        message: "Para usar Firebase debes ingresar un email valido.",
        tone: "danger",
      });
      return null;
    }

    return trimmedIdentifier.toLowerCase();
  };

  const handleSubmit = async () => {
    if (mode === "recover") {
      const email = validateEmail();
      if (!email) {
        return;
      }

      try {
        await sendResetPassword(email);
        setFeedback({
          visible: true,
          title: "Link enviado",
          message: "Revisa tu email para restablecer la contrase\u00f1a.",
          tone: "success",
        });
        setMode("login");
      } catch (error) {
        setFeedback({
          visible: true,
          title: "No pudimos enviar el link",
          message: error.message,
          tone: "danger",
        });
      }

      return;
    }

    const email = validateEmail();
    if (!email) {
      return;
    }

    if (mode === "register") {
      if (!name.trim()) {
        setFeedback({
          visible: true,
          title: "Falta tu nombre",
          message: "Ingresa tu nombre y apellido para continuar.",
          tone: "danger",
        });
        return;
      }

      if (!NAME_REGEX.test(name.trim())) {
        setFeedback({
          visible: true,
          title: "Nombre invalido",
          message: "Usa solo letras y espacios.",
          tone: "danger",
        });
        return;
      }

      if (!hasValidFullName(name)) {
        setFeedback({
          visible: true,
          title: "Nombre invalido",
          message:
            "Ingresa nombre y apellido con maximo 3 palabras y hasta 10 caracteres por palabra.",
          tone: "danger",
        });
        return;
      }

      if (!localidadInput.trim()) {
        setFeedback({
          visible: true,
          title: "Falta tu localidad",
          message: "Ingresa y selecciona una localidad.",
          tone: "danger",
        });
        return;
      }

      if (!isValidLocalidad(localidad, localidadInput)) {
        setFeedback({
          visible: true,
          title: "Falta tu localidad",
          message: "Selecciona una localidad sugerida.",
          tone: "danger",
        });
        return;
      }

      if (!localidad?.provincia?.trim()) {
        setFeedback({
          visible: true,
          title: "Provincia no valida",
          message: "Debes seleccionar una localidad con provincia.",
          tone: "danger",
        });
        return;
      }

      if (!category) {
        setFeedback({
          visible: true,
          title: "Falta la categoria",
          message: "Selecciona tu categoria de jugador.",
          tone: "danger",
        });
        return;
      }

      if (!sex) {
        setFeedback({
          visible: true,
          title: "Falta el sexo",
          message: "Selecciona una opcion en sexo.",
          tone: "danger",
        });
        return;
      }

      if (!phone.trim() || !hasValidPhoneDigits(phone)) {
        setFeedback({
          visible: true,
          title: "Falta tu celular",
          message: "Ingresa tu numero de celular para crear tu cuenta.",
          tone: "danger",
        });
        return;
      }

      if (!password.trim()) {
        setFeedback({
          visible: true,
          title: "Falta la contrase\u00f1a",
          message: "Ingresa una contrase\u00f1a para crear tu cuenta.",
          tone: "danger",
        });
        return;
      }

      if (password.length < MIN_PASSWORD_LENGTH) {
        setFeedback({
          visible: true,
          title: "Contrase\u00f1a muy corta",
          message: `Debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
          tone: "danger",
        });
        return;
      }

      const normalizedLocalidad = {
        nombre: localidad.nombre,
        provincia: localidad.provincia,
        pais: localidad.pais || "Argentina",
      };

      try {
        await register({
          name: name.trim(),
          email,
          phone: phone.trim(),
          countryCode,
          phoneCountry: selectedPhoneCountry,
          isPhonePublic,
          localidad: normalizedLocalidad,
          category,
          sex,
          ladoJuego,
          manoHabil,
          password,
          description: "",
          avatarColor: avatarColors[0],
          avatarUrl: "",
        });
        onLogin?.();
        onClose();
      } catch (error) {
        setFeedback({
          visible: true,
          title: "No pudimos registrarte",
          message: error.message,
          tone: "danger",
        });
      }

      return;
    }

    if (!password.trim()) {
      setFeedback({
        visible: true,
        title: "Datos incompletos",
        message: "Ingresa tu email y tu contrase\u00f1a.",
        tone: "danger",
      });
      return;
    }

    try {
      await login({ email, password });
      onLogin?.();
      onClose();
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos ingresar",
        message: error.message,
        tone: "danger",
      });
    }
  };

  const title =
    mode === "login"
      ? "Ingresar a tu cuenta"
      : mode === "register"
        ? "Crear cuenta"
        : "Recuperar acceso";

  const subtitle =
    mode === "login"
      ? ""
      : mode === "register"
        ? "Estas a un paso de hacer tu juego mas facil, todo en un mismo lugar."
        : "Recibe un link de recuperacion para restablecer tu contrase\u00f1a.";

  const actionLabel =
    mode === "recover"
      ? "Enviar link"
      : mode === "login"
        ? "Ingresar"
        : "Registrarme";

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={styles.card}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {mode === "register" ? (
              <>
                <AppInput
                  autoCapitalize="words"
                  inputStyle={styles.compactInput}
                  label="Nombre y Apellido"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => setName(sanitizeFullName(value))}
                  placeholder="Tu nombre completo"
                  value={name}
                />
                <AppInput
                  autoCapitalize="none"
                  autoComplete="email"
                  inputStyle={styles.compactInput}
                  keyboardType="email-address"
                  label="Email"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => setIdentifier(value.toLowerCase())}
                  placeholder="tuemail@mail.com"
                  value={identifier}
                />
                <View style={styles.phoneRow}>
                  <AppInput
                    containerStyle={styles.phoneField}
                    helperText="Tu numero no sera visible a otros usuarios"
                    inputStyle={styles.compactInput}
                    keyboardType="phone-pad"
                    label="Celular"
                    labelStyle={styles.centeredLabel}
                    leftElement={
                      <CountryCodeSelector
                        onChange={(option) => {
                          setSelectedPhoneCountry(option.country);
                          setCountryCode(option.code);
                        }}
                        options={phoneCountryOptions}
                        value={selectedPhoneCountry}
                      />
                    }
                    onChangeText={(value) => setPhone(sanitizePhoneValue(value))}
                    placeholder="Numero de celular"
                    value={phone}
                  />
                  <View style={styles.phoneVisibilityBox}>
                    <Text style={styles.phoneVisibilityLabel}>Mostrar celular</Text>
                    <Switch
                      onValueChange={setIsPhonePublic}
                      thumbColor={isPhonePublic ? "#FFFFFF" : "#F4F4F5"}
                      trackColor={{ false: "#D6DDD9", true: colors.primary }}
                      value={Boolean(isPhonePublic)}
                    />
                  </View>
                </View>
                <LocationPicker
                  label="Localidad"
                  labelStyle={styles.centeredLabel}
                  sanitizeText={sanitizeLocalidadValue}
                  onChangeText={(value) => {
                    setLocalidadInput(value);
                    setLocalidad(null);
                  }}
                  onSelect={(location) => {
                    setLocalidad(location);
                    setLocalidadInput(location?.nombre || "");
                  }}
                  placeholder="Escribe tu localidad"
                  selectedLocation={localidad}
                  value={localidadInput}
                />
                <AppInput
                  editable={false}
                  inputStyle={styles.compactInput}
                  label="Provincia"
                  labelStyle={styles.centeredLabel}
                  placeholder=""
                  value={localidad?.provincia || ""}
                />
                <SelectField
                  label="Categoria del jugador"
                  labelStyle={styles.centeredLabel}
                  onClose={() => setIsCategoryVisible(false)}
                  onOpen={() => setIsCategoryVisible(true)}
                  onSelect={setCategory}
                  options={categoryOptions}
                  placeholder="Selecciona una categoria"
                  value={category}
                  visible={isCategoryVisible}
                />
                <SelectField
                  label="Sexo"
                  labelStyle={styles.centeredLabel}
                  onClose={() => setIsSexVisible(false)}
                  onOpen={() => setIsSexVisible(true)}
                  onSelect={setSex}
                  options={sexDropdownOptions}
                  placeholder="Seleccione"
                  value={sex}
                  visible={isSexVisible}
                />
                <SelectField
                  label="Lado preferido de juego"
                  labelStyle={styles.centeredLabel}
                  onClose={() => setIsPreferredSideVisible(false)}
                  onOpen={() => setIsPreferredSideVisible(true)}
                  onSelect={setLadoJuego}
                  options={preferredSideOptions}
                  placeholder="Selecciona una opcion"
                  value={ladoJuego}
                  visible={isPreferredSideVisible}
                />
                <SelectField
                  label="Mano habil"
                  labelStyle={styles.centeredLabel}
                  onClose={() => setIsDominantHandVisible(false)}
                  onOpen={() => setIsDominantHandVisible(true)}
                  onSelect={setManoHabil}
                  options={dominantHandOptions}
                  placeholder="Selecciona una opcion"
                  value={manoHabil}
                  visible={isDominantHandVisible}
                />
              </>
            ) : (
              <AppInput
                autoCapitalize="none"
                autoComplete="email"
                containerStyle={styles.loginField}
                inputStyle={styles.compactInput}
                keyboardType="email-address"
                label="Email"
                labelStyle={styles.centeredLabel}
                onChangeText={(value) => setIdentifier(value.toLowerCase())}
                placeholder="tuemail@mail.com"
                value={identifier}
              />
            )}

            {mode !== "recover" ? (
              <AppInput
                autoComplete="password"
                containerStyle={styles.passwordField}
                inputStyle={styles.compactInput}
                label={"Contrase\u00f1a"}
                labelStyle={styles.centeredLabel}
                onChangeText={setPassword}
                placeholder={"Ingrese contrase\u00f1a"}
                rightElement={
                  <Pressable
                    accessibilityLabel={
                      isPasswordVisible ? "Ocultar contrase\u00f1a" : "Mostrar contrase\u00f1a"
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

            <AppButton title={actionLabel} onPress={handleSubmit} style={styles.submit} />

            {mode === "login" ? (
              <Pressable onPress={() => setMode("recover")} style={styles.recoverLink}>
                <Text style={styles.recoverLinkText}>{"Olvid\u00e9 mi contrase\u00f1a"}</Text>
              </Pressable>
            ) : null}

            <AppButton
              title={
                mode === "login"
                  ? "Registrarme"
                  : mode === "register"
                    ? "Ya tengo cuenta"
                    : "Volver a ingresar"
              }
              onPress={() =>
                setMode(mode === "login" ? "register" : "login")
              }
              style={styles.secondaryButton}
              textStyle={styles.secondaryButtonText}
              variant="secondary"
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <FeedbackModal
        confirmLabel={feedback.tone === "success" ? "Continuar" : "Entendido"}
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
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
  card: {
    backgroundColor: "#F4F8F1",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "88%",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 10,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 5,
    marginBottom: spacing.sm,
    width: 52,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  formContent: {
    paddingBottom: spacing.xs,
  },
  submit: {
    marginTop: spacing.sm,
  },
  recoverLink: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  recoverLinkText: {
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
  compactInput: {
    fontSize: 15,
    minHeight: 46,
    paddingVertical: 8,
  },
  loginField: {
    marginBottom: spacing.sm,
  },
  passwordField: {
    marginBottom: spacing.sm,
  },
  passwordToggle: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  phoneRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  phoneField: {
    flex: 1.18,
    marginBottom: 0,
  },
  phoneVisibilityBox: {
    alignItems: "center",
    flex: 0.54,
    justifyContent: "flex-end",
    marginBottom: 0,
  },
  phoneVisibilityLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
    textTransform: "uppercase",
  },
  centeredLabel: {
    textAlign: "center",
  },
});




