import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

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
import { dateToFechaNacimiento, formatFechaNacimientoDisplay } from "../utils/ageUtils";

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

const dominantHandOptions = [
  { label: "Derecha", value: "Derecha" },
  { label: "Izquierda", value: "Izquierda" },
];

const sanitizeName = (value) => value.replace(/[^A-Za-z\u00c0-\u00ff\s]/g, "");
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
  const [isCategoryVisible, setIsCategoryVisible] = useState(false);
  const [isSexVisible, setIsSexVisible] = useState(false);
  const [isPreferredSideVisible, setIsPreferredSideVisible] = useState(false);
  const [isDominantHandVisible, setIsDominantHandVisible] = useState(false);
  const [birthDate, setBirthDate] = useState(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

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

    if (!birthDate) {
      showFeedback("Falta la fecha de nacimiento", "Ingresa tu fecha de nacimiento para continuar.", "danger");
      return;
    }

    if (!password.trim()) {
      showFeedback("Falta la contrase\u00f1a", "Ingresa una contrase\u00f1a para continuar.", "danger");
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      showFeedback(
        "Contrase\u00f1a muy corta",
        `Debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
        "danger"
      );
      return;
    }

    const email = trimmedIdentifier.toLowerCase();

    if (!email.includes("@")) {
      showFeedback("Email no valido", "Debe ingresar un email v�lido.", "danger");
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
        fechaNacimiento: dateToFechaNacimiento(birthDate),
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
              <Pressable
                onPress={() => setIsPhonePublic((current) => !current)}
                style={({ pressed }) => [
                  styles.phoneVisibilityButton,
                  isPhonePublic
                    ? styles.phoneVisibilityButtonActive
                    : styles.phoneVisibilityButtonInactive,
                  pressed ? styles.phoneVisibilityButtonPressed : null,
                ]}
              >
                <Text
                  style={[
                    styles.phoneVisibilityButtonText,
                    isPhonePublic
                      ? styles.phoneVisibilityButtonTextActive
                      : styles.phoneVisibilityButtonTextInactive,
                  ]}
                >
                  {isPhonePublic ? "ON" : "OFF"}
                </Text>
              </Pressable>
            </View>
          </View>
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
          <SelectField
            containerStyle={styles.compactField}
            fieldStyle={styles.compactSelectField}
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
          <View style={styles.compactField}>
            <Text style={[styles.centeredLabel, styles.dateLabel]}>Fecha de nacimiento</Text>
            <Pressable
              onPress={() => setDatePickerVisible(true)}
              style={({ pressed }) => [
                styles.dateField,
                pressed ? styles.dateFieldPressed : null,
              ]}
            >
              <Text style={birthDate ? styles.dateValue : styles.datePlaceholder}>
                {birthDate
                  ? formatFechaNacimientoDisplay(dateToFechaNacimiento(birthDate))
                  : "DD/MM/AAAA"}
              </Text>
            </Pressable>
            {datePickerVisible && (
              <DateTimePicker
                display="default"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                mode="date"
                onChange={(_, selectedDate) => {
                  if (Platform.OS !== "ios") {
                    setDatePickerVisible(false);
                  }
                  if (selectedDate) {
                    setBirthDate(selectedDate);
                  }
                }}
                value={birthDate || new Date(2000, 0, 1)}
              />
            )}
          </View>

          <AppInput
            containerStyle={styles.compactField}
            inputStyle={styles.compactInput}
            label={"Contrase\u00f1a"}
            labelStyle={styles.centeredLabel}
            onChangeText={setPassword}
            placeholder={"Ingrese contrase\u00f1a"}
            secureTextEntry
            value={password}
          />

          <AppButton title="Registrarme" onPress={handleRegister} style={styles.primaryButton} />
          <Text style={styles.legalText}>
            Al registrarte aceptas los{" "}
            <Text
              onPress={() => Linking.openURL("https://www.padelnexo.com.ar/terminos-condiciones")}
              style={styles.legalLink}
            >
              Terminos y Condiciones
            </Text>
            {" "}y la{" "}
            <Text
              onPress={() => Linking.openURL("https://www.padelnexo.com.ar/politica-privacidad")}
              style={styles.legalLink}
            >
              Politica de Privacidad
            </Text>
            .
          </Text>
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
  phoneRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  phoneField: {
    flex: 1,
    marginBottom: 0,
  },
  phoneVisibilityBox: {
    alignItems: "center",
    flex: 0.72,
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
  phoneVisibilityButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  phoneVisibilityButtonActive: {
    backgroundColor: "#E8F5EE",
    borderColor: "#B8DCC7",
  },
  phoneVisibilityButtonInactive: {
    backgroundColor: "#F3F5F7",
    borderColor: "#D4DBE2",
  },
  phoneVisibilityButtonPressed: {
    opacity: 0.86,
  },
  phoneVisibilityButtonText: {
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  phoneVisibilityButtonTextActive: {
    color: colors.primaryDark,
  },
  phoneVisibilityButtonTextInactive: {
    color: "#667482",
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
  legalText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  legalLink: {
    color: colors.primaryDark,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  dateLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
    marginTop: spacing.xs,
    textTransform: "uppercase",
  },
  dateField: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  dateFieldPressed: {
    opacity: 0.7,
  },
  dateValue: {
    color: colors.text,
    fontSize: 15,
  },
  datePlaceholder: {
    color: colors.placeholder || colors.muted,
    fontSize: 15,
  },
});




