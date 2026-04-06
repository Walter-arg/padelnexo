import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import CountryCodeSelector from "../components/CountryCodeSelector";
import FeedbackModal from "../components/FeedbackModal";
import LocationPicker from "../components/LocationPicker";
import ScreenWrapper from "../components/ScreenWrapper";
import SelectField from "../components/SelectField";
import { defaultPhoneCountry, phoneCountryOptions } from "../data/phoneCountryOptions";
import {
  avatarColors,
  playerCategories,
  sexOptions,
} from "../data/profileOptions";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";

const NAME_REGEX = /^[A-Za-z\u00c0-\u00ff\s]+$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 4;

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

const sanitizeName = (value) => value.replace(/[^A-Za-z\u00c0-\u00ff\s]/g, "");
const sanitizePhoneValue = (value) => value.replace(/\D/g, "").slice(0, 16);
const hasValidPhoneDigits = (value) => value.replace(/\D/g, "").length >= 8;
const sanitizeLocalidadValue = (value) => value.replace(/[^A-Za-z\u00c0-\u00ff\s]/g, "");

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

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedPhoneCountry, setSelectedPhoneCountry] = useState(
    defaultPhoneCountry?.country || "Argentina"
  );
  const [countryCode, setCountryCode] = useState(defaultPhoneCountry?.code || "+54");
  const [localidadInput, setLocalidadInput] = useState("");
  const [localidad, setLocalidad] = useState(null);
  const [category, setCategory] = useState("");
  const [sex, setSex] = useState("");
  const [ladoJuego, setLadoJuego] = useState("ambos");
  const [password, setPassword] = useState("");
  const [isCategoryVisible, setIsCategoryVisible] = useState(false);
  const [isSexVisible, setIsSexVisible] = useState(false);
  const [isPreferredSideVisible, setIsPreferredSideVisible] = useState(false);

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const handleRegister = async () => {
    const trimmedIdentifier = identifier.trim();

    if (!name.trim()) {
      showFeedback("Falta tu nombre", "Ingresa tu nombre y apellido para continuar.", "danger");
      return;
    }

    if (!NAME_REGEX.test(name.trim())) {
      showFeedback("Nombre invalido", "Usa solo letras y espacios.", "danger");
      return;
    }

    if (!hasValidFullName(name)) {
      showFeedback(
        "Nombre invalido",
        "Ingresa nombre y apellido con maximo 3 palabras y hasta 10 caracteres por palabra.",
        "danger"
      );
      return;
    }

    if (!trimmedIdentifier) {
      showFeedback("Falta un dato de contacto", "Ingresa tu email para continuar.", "danger");
      return;
    }

    if (!localidadInput.trim()) {
      showFeedback("Falta tu localidad", "Ingresa y selecciona una localidad.", "danger");
      return;
    }

    if (!isValidLocalidad(localidad, localidadInput)) {
      showFeedback("Localidad no valida", "Selecciona una localidad sugerida.", "danger");
      return;
    }

    if (!localidad?.provincia?.trim()) {
      showFeedback("Provincia no valida", "Debes seleccionar una localidad con provincia.", "danger");
      return;
    }

    if (!category) {
      showFeedback("Falta la categoria", "Selecciona tu categoria de jugador.", "danger");
      return;
    }

    if (!sex) {
      showFeedback("Falta el sexo", "Selecciona una opcion en sexo.", "danger");
      return;
    }

    if (!phone.trim() || !hasValidPhoneDigits(phone)) {
      showFeedback("Falta tu celular", "Ingresa tu numero de celular para continuar.", "danger");
      return;
    }

    if (!password.trim()) {
      showFeedback("Falta la contraseña", "Ingresa una contraseña para continuar.", "danger");
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      showFeedback(
        "Contraseña muy corta",
        `Debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
        "danger"
      );
      return;
    }

    const email = trimmedIdentifier.toLowerCase();

    if (!email.includes("@")) {
      showFeedback("Email no valido", "Debe ingresar un email válido.", "danger");
      return;
    }

    if (!emailRegex.test(email)) {
      showFeedback("Email no valido", "Para crear tu cuenta debes usar un email valido.", "danger");
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
        isPhonePublic: false,
        localidad: normalizedLocalidad,
        category,
        sex,
        ladoJuego,
        password,
        description: "",
        avatarColor: avatarColors[0],
        avatarUrl: "",
      });

      showFeedback("Registro listo", "Tu cuenta ya quedo creada en Firebase.", "success");
    } catch (error) {
      showFeedback("No pudimos registrarte", error.message, "danger");
    }
  };

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.title}>Crear cuenta</Text>

          <AppInput
            autoCapitalize="words"
            containerStyle={styles.compactField}
            inputStyle={styles.compactInput}
            label="Nombre y Apellido"
            labelStyle={styles.centeredLabel}
            onChangeText={(value) => setName(sanitizeFullName(value))}
            placeholder="Tu nombre completo"
            value={name}
          />
          <AppInput
            autoCapitalize="none"
            containerStyle={styles.compactField}
            inputStyle={styles.compactInput}
            keyboardType="email-address"
            label="Email"
            labelStyle={styles.centeredLabel}
            onChangeText={(value) => setIdentifier(value.toLowerCase())}
            placeholder="tuemail@mail.com"
            value={identifier}
          />
          <AppInput
            containerStyle={styles.compactField}
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
          <LocationPicker
            containerStyle={styles.compactField}
            inputStyle={styles.compactInput}
            label="Localidad"
            labelStyle={styles.centeredLabel}
            sanitizeText={sanitizeLocalidadValue}
            onChangeText={(text) => {
              setLocalidadInput(text);
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
            containerStyle={styles.compactField}
            editable={false}
            inputStyle={styles.compactInput}
            label="Provincia"
            labelStyle={styles.centeredLabel}
            placeholder=""
            value={localidad?.provincia || ""}
          />
          <SelectField
            containerStyle={styles.compactField}
            fieldStyle={styles.compactSelectField}
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
            containerStyle={styles.compactField}
            fieldStyle={styles.compactSelectField}
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
            containerStyle={styles.compactField}
            fieldStyle={styles.compactSelectField}
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
          <AppInput
            containerStyle={styles.compactField}
            inputStyle={styles.compactInput}
            label="Contraseña"
            labelStyle={styles.centeredLabel}
            onChangeText={setPassword}
            placeholder="Ingrese contraseña"
            secureTextEntry
            value={password}
          />

          <AppButton title="Registrarme" onPress={handleRegister} style={styles.primaryButton} />
          <AppButton
            title="Ya tengo cuenta"
            onPress={() => navigation.goBack()}
            style={styles.secondaryButton}
            textStyle={styles.secondaryButtonText}
            variant="secondary"
          />
        </View>
      </ScrollView>
      <FeedbackModal
        confirmLabel={feedback.tone === "success" ? "Continuar" : "Entendido"}
        message={feedback.message}
        onClose={() => {
          const shouldGoBack = feedback.tone === "success";
          setFeedback((current) => ({ ...current, visible: false }));
          if (shouldGoBack) {
            navigation.goBack();
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
  content: {
    paddingBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 4,
    textAlign: "center",
  },
  compactInput: {
    fontSize: 15,
    minHeight: 42,
    paddingVertical: 0,
  },
  compactField: {
    marginBottom: 0,
  },
  compactSelectField: {
    minHeight: 42,
  },
  centeredLabel: {
    textAlign: "center",
  },
  primaryButton: {
    marginTop: 4,
  },
  secondaryButton: {
    marginBottom: 0,
    marginTop: 2,
  },
  secondaryButtonText: {
    color: colors.text,
  },
});
