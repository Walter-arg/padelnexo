import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import {
  avatarColors,
  playerCategories,
  sexOptions,
} from "../data/profileOptions";
import { canAccessAdminPanel } from "../config/admin";
import {
  hasMercadoPagoCheckoutRuntimeConfig,
  hasMercadoPagoOAuthRuntimeConfig,
  hasMercadoPagoPublicKey,
} from "../config/mercadoPago";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import devLog from "../utils/devLog";
import {
  dateToFechaNacimiento,
  fechaNacimientoToDate,
  formatFechaNacimientoDisplay,
} from "../utils/ageUtils";
import { phoneCountryOptions } from "../data/phoneCountryOptions";
import {
  normalizeMercadoPagoConfig,
  DEFAULT_MERCADO_PAGO_CONFIG,
} from "../services/mercadoPagoConfigService";
import {
  linkOrganizerMercadoPagoAccount,
  recoverPendingMercadoPagoOAuth,
} from "../services/mercadoPagoOAuthService";
import {
  getAccountTypeLabel,
  isApprovedOrganizer,
  isPendingOrganizer,
  isRejectedOrganizer,
} from "../services/roleService";
import AppButton from "./AppButton";
import AppInput from "./AppInput";
import AvatarBadge from "./AvatarBadge";
import CountryCodeSelector from "./CountryCodeSelector";
import FeedbackModal from "./FeedbackModal";
import LocationPicker from "./LocationPicker";
import OrganizerRequestModal from "./OrganizerRequestModal";
import SelectField from "./SelectField";

const DESCRIPTION_MAX_LENGTH = 100;



function MpToggleRow({ label, value, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [mpToggleStyles.row, pressed && { opacity: 0.8 }]}
    >
      <Text style={mpToggleStyles.label}>{label}</Text>
      <View style={[mpToggleStyles.track, value ? mpToggleStyles.trackOn : mpToggleStyles.trackOff]}>
        <View style={[mpToggleStyles.thumb, value ? mpToggleStyles.thumbOn : mpToggleStyles.thumbOff]} />
      </View>
    </Pressable>
  );
}

const mpToggleStyles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF1F4",
  },
  label: {
    color: "#1a2e3b",
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    paddingRight: 12,
  },
  track: {
    width: 46,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  trackOn: { backgroundColor: "#1fa36d" },
  trackOff: { backgroundColor: "#D1D9E0" },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  thumbOn: { alignSelf: "flex-end" },
  thumbOff: { alignSelf: "flex-start" },
});

const defaultMercadoPagoConfig = DEFAULT_MERCADO_PAGO_CONFIG;

const defaultProfile = {
  name: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  countryCode: "+54",
  phoneCountry: "Argentina",
  isPhonePublic: false,
  city: "",
  category: "9na (Iniciantes)",
  sex: "Masculino",
  ladoJuego: "ambos",
  manoHabil: "",
  fechaNacimiento: "",
  description: "",
  avatarColor: avatarColors[0],
  avatarUrl: "",
  organizerLogoUrl: "",
  role: "user",
  organizerStatus: "none",
  complejos: [],
  localidad: null,
  mercadoPagoConfig: defaultMercadoPagoConfig,
};

const categoryOptions = playerCategories.map((option) => ({
  label: option,
  value: option,
}));

const sexDropdownOptions = sexOptions.map((option) => ({
  label: option,
  value: option,
}));

const mercadoPagoCategoryOptions = [
  { key: "turnos", label: "Turnos" },
  { key: "ligas", label: "Ligas" },
  { key: "torneos", label: "Torneos" },
];

const preferredSideOptions = [
  { label: "Drive", value: "drive" },
  { label: "Reves", value: "reves" },
  { label: "Ambos lados", value: "ambos" },
];

const dominantHandOptions = [
  { label: "Derecha", value: "Derecha" },
  { label: "Izquierda", value: "Izquierda" },
];

function normalizeLocalidad(localidad, fallback = {}) {
  if (!localidad) {
    return null;
  }

  if (typeof localidad === "string") {
    const nombre = localidad.trim();

    if (!nombre) {
      return null;
    }

    return {
      nombre,
      provincia: fallback.provincia || "",
      pais: fallback.pais || "Argentina",
    };
  }

  const nombre = localidad.nombre?.trim() || localidad.ciudad?.trim() || "";
  const provincia = localidad.provincia?.trim() || fallback.provincia || "";
  const pais = localidad.pais?.trim() || fallback.pais || "Argentina";

  if (!nombre) {
    return null;
  }

  return { nombre, provincia, pais };
}

function isValidLocalidad(localidad) {
  return Boolean(
    localidad?.nombre?.trim() &&
      localidad?.provincia?.trim() &&
      localidad?.pais?.trim()
  );
}

function sanitizePhoneValue(value = "") {
  return value.replace(/\D/g, "").slice(0, 16);
}

function hasValidPhoneDigits(value = "") {
  return value.replace(/\D/g, "").length >= 8;
}

export default function ProfileModal({
  navigation,
  onClose,
  onLogout,
  onSave,
  user,
  visible,
}) {
  const {
    deleteAccount,
    emailVerified,
    getOrganizerAccessMessage,
    logout,
    removeProfilePhoto,
    resendVerificationEmail,
    updateProfile,
  } = useAuth();
  const [profile, setProfile] = useState(defaultProfile);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [isCategoryVisible, setIsCategoryVisible] = useState(false);
  const [isSexVisible, setIsSexVisible] = useState(false);
  const [isPreferredSideVisible, setIsPreferredSideVisible] = useState(false);
  const [isDominantHandVisible, setIsDominantHandVisible] = useState(false);
  const [isOrganizerModalVisible, setIsOrganizerModalVisible] = useState(false);
  const [organizerModalMode, setOrganizerModalMode] = useState("request");
  const [isLogoutConfirmVisible, setIsLogoutConfirmVisible] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [loading, setLoading] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [tempDate, setTempDate] = useState(null);
  const isApprovedAccount = isApprovedOrganizer(profile);
  const showOrganizerHint = isPendingOrganizer(profile) || isRejectedOrganizer(profile);
  const mercadoPagoRuntimeReady = hasMercadoPagoCheckoutRuntimeConfig();
  const mercadoPagoOAuthReady = hasMercadoPagoOAuthRuntimeConfig();
  const mercadoPagoPublicKeyReady = hasMercadoPagoPublicKey();
  const mercadoPagoProfileConfig = normalizeMercadoPagoConfig(profile.mercadoPagoConfig);
  const mercadoPagoAccountLinked = mercadoPagoProfileConfig.accountLinked === true;
  const mercadoPagoConnectionStatus = String(
    mercadoPagoProfileConfig.connectionStatus || "checkout_pro_test"
  )
    .trim()
    .toLowerCase();

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  useEffect(() => {
    if (!visible) {
      setDatePickerVisible(false);
      setTempDate(null);
      return;
    }

    if (user) {
      const parsedLocalidad = normalizeLocalidad(user.localidad, {
        provincia: user.province || user.location?.provincia || "",
        pais: user.location?.pais || "Argentina",
      });

      const firstName = user.firstName || (user.name ? user.name.split(" ")[0] : "");
      const lastName = user.lastName || (user.name ? user.name.split(" ").slice(1).join(" ") : "");

      setProfile({
        ...defaultProfile,
        ...user,
        firstName,
        lastName,
        mercadoPagoConfig: normalizeMercadoPagoConfig(user.mercadoPagoConfig),
        city: parsedLocalidad?.nombre || user.city || "",
        province: parsedLocalidad?.provincia || user.province || "",
        localidad: parsedLocalidad,
      });
      setSelectedLocation(parsedLocalidad);
    }
  }, [user?.uid, visible]);

  useEffect(() => {
    if (!visible || !isApprovedAccount) {
      return;
    }

    let cancelled = false;

    const recoverOAuth = async () => {
      try {
        const result = await recoverPendingMercadoPagoOAuth();

        if (!result || cancelled) {
          return;
        }

        const nextConfig = normalizeMercadoPagoConfig({
          ...mercadoPagoProfileConfig,
          ...(result?.config || {}),
        });

        setProfile((current) => ({
          ...current,
          mercadoPagoConfig: nextConfig,
        }));

        showFeedback(
          "Cuenta vinculada",
          result?.accountDisplayName
            ? `Mercado Pago quedo vinculado con ${result.accountDisplayName}.`
            : "La cuenta de Mercado Pago quedo vinculada correctamente.",
          "success"
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        showFeedback(
          "No pudimos vincular la cuenta",
          error?.message || "Intenta nuevamente en unos instantes.",
          "danger"
        );
      }
    };

    recoverOAuth();

    return () => {
      cancelled = true;
    };
  }, [visible, isApprovedAccount]);

  const updateField = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const updateNameField = (field, value) => {
    setProfile((current) => {
      const next = { ...current, [field]: value };
      next.name = [next.firstName || "", next.lastName || ""].filter(Boolean).join(" ").trim();
      return next;
    });
  };

  const updateMercadoPagoField = (field, value) => {
    setProfile((current) => ({
      ...current,
      mercadoPagoConfig: {
        ...normalizeMercadoPagoConfig(current.mercadoPagoConfig),
        [field]: value,
      },
    }));
  };

  const handleMercadoPagoCategoryToggle = (categoryKey) => {
    if (!mercadoPagoRuntimeReady) {
      showFeedback(
        "Falta configurar Mercado Pago",
        "Para esta etapa de pruebas necesitas una Public Key en la app y la URL del backend para crear preferencias.",
        "warning"
      );
      return;
    }

    const normalizedConfig = normalizeMercadoPagoConfig(profile.mercadoPagoConfig);

    setProfile((current) => ({
      ...current,
      mercadoPagoConfig: {
        ...normalizedConfig,
        categories: {
          ...normalizedConfig.categories,
          [categoryKey]: !normalizedConfig.categories?.[categoryKey],
        },
      },
    }));
  };

  const handleMercadoPagoToggle = (field) => {
    if (!mercadoPagoRuntimeReady) {
      showFeedback(
        "Falta configurar Mercado Pago",
        "Para esta etapa de pruebas necesitas una Public Key en la app y la URL del backend para crear preferencias.",
        "warning"
      );
      return;
    }

    const normalizedConfig = normalizeMercadoPagoConfig(profile.mercadoPagoConfig);
    updateMercadoPagoField(field, !normalizedConfig[field]);
  };

  const handleMercadoPagoLinkAccount = async () => {
    if (!mercadoPagoOAuthReady) {
      showFeedback(
        "Falta configurar Mercado Pago",
        "La app todavia no tiene listas las URLs para vincular la cuenta del organizador.",
        "warning"
      );
      return;
    }

    try {
      setLoading(true);
      const result = await linkOrganizerMercadoPagoAccount(profile.uid || user?.uid || "");
      const nextConfig = normalizeMercadoPagoConfig({
        ...mercadoPagoProfileConfig,
        ...(result?.config || {}),
      });

      setProfile((current) => ({
        ...current,
        mercadoPagoConfig: nextConfig,
      }));

      showFeedback(
        "Cuenta vinculada",
        result?.accountDisplayName
          ? `Mercado Pago quedo vinculado con ${result.accountDisplayName}.`
          : "La cuenta de Mercado Pago quedo vinculada correctamente.",
        "success"
      );
    } catch (error) {
      if (error?.code === "mercado_pago_oauth_cancelled") {
        showFeedback(
          "Vinculacion cancelada",
          "La vinculacion con Mercado Pago no se completo.",
          "warning"
        );
      } else {
        showFeedback(
          "No pudimos vincular la cuenta",
          error?.message || "Intenta nuevamente en unos instantes.",
          "danger"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePickImage = async () => {
    try {
      devLog("[ProfileModal] Solicitando permiso para galeria");
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        showFeedback(
          "Permiso necesario",
          "Se necesita permiso para acceder a la galeria."
        );
        return;
      }

      devLog("[ProfileModal] Abriendo selector de imagen");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });

      if (result.canceled || !result.assets?.[0]?.uri) {
        devLog("[ProfileModal] Seleccion cancelada");
        return;
      }

      const uri = result.assets[0].uri;
      devLog("[ProfileModal] Imagen seleccionada:", uri);
      updateField("avatarUrl", uri);
    } catch (error) {
      devLog("[ProfileModal] Error al seleccionar imagen:", error);
      showFeedback("No pudimos seleccionar la imagen", "Intenta nuevamente.");
    }
  };

  const handlePickOrganizerLogo = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        showFeedback("Permiso necesario", "Se necesita permiso para acceder a la galeria.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]?.uri) {
        return;
      }

      updateField("organizerLogoUrl", result.assets[0].uri);
    } catch (error) {
      showFeedback("No pudimos seleccionar el logo", "Intenta nuevamente.");
    }
  };

  const handleSave = async () => {
    if (loading) {
      devLog("[ProfileModal] Guardado omitido porque ya esta en progreso");
      return;
    }

    try {
      setLoading(true);
      devLog("[ProfileModal] Guardando perfil");

      const normalizedLocalidad = normalizeLocalidad(selectedLocation || profile.localidad, {
        provincia: profile.province || profile.location?.provincia || "",
        pais: profile.location?.pais || "Argentina",
      });

      if (!isValidLocalidad(normalizedLocalidad)) {
        showFeedback("Localidad no valida", "Selecciona una localidad sugerida.");
        return;
      }

      const fullName = [profile.firstName?.trim(), profile.lastName?.trim()].filter(Boolean).join(" ");
      if (!fullName) {
        showFeedback("Nombre no valido", "Ingresa tu nombre y apellido.");
        return;
      }

      if (!profile.phone.trim() || !hasValidPhoneDigits(profile.phone)) {
        showFeedback("Celular no valido", "Ingresa un numero de celular valido.");
        return;
      }

      const updatedProfile = await updateProfile({
        ...profile,
        name: fullName,
        firstName: profile.firstName?.trim(),
        lastName: profile.lastName?.trim(),
        city: normalizedLocalidad.nombre,
        province: normalizedLocalidad.provincia,
        country: normalizedLocalidad.pais,
        localidad: normalizedLocalidad,
      });
      onSave?.(updatedProfile);
    } catch (error) {
      devLog("[ProfileModal] Error al guardar perfil:", error);
      showFeedback(
        "No pudimos guardar el perfil",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePhoto = () => {
    Alert.alert(
      "Eliminar foto",
      "Seguro que queres eliminar tu foto de perfil?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              devLog("[ProfileModal] Eliminando foto de perfil");

              if (profile.avatarUrl?.startsWith("file:")) {
                setProfile((current) => ({
                  ...current,
                  avatarUrl: "",
                }));
                return;
              }

              const updatedProfile = await removeProfilePhoto();
              setProfile((current) => ({
                ...current,
                ...updatedProfile,
                avatarUrl: "",
              }));
              onSave?.(updatedProfile);
            } catch (error) {
              devLog("[ProfileModal] Error al eliminar imagen:", error);
              showFeedback("No pudimos eliminar la foto", "Intenta nuevamente.");
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    setIsLogoutConfirmVisible(true);
  };

  const handleDeleteAccount = () => {
    setIsDeleteConfirmVisible(true);
  };

  const handleConfirmLogout = async () => {
    try {
      await logout();
      setIsLogoutConfirmVisible(false);
      onLogout?.();
    } catch (error) {
      setIsLogoutConfirmVisible(false);
      showFeedback(
        "No pudimos cerrar sesion",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  const handleConfirmDeleteAccount = async () => {
    try {
      await deleteAccount();
      setIsDeleteConfirmVisible(false);
      onClose?.();
      onLogout?.();
    } catch (error) {
      setIsDeleteConfirmVisible(false);
      showFeedback(
        "No pudimos eliminar la cuenta",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  return (
    <>
      <Modal animationType="slide" transparent visible={visible}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.overlay}
        >
          <Pressable onPress={onClose} style={styles.backdrop} />
          <View style={styles.card}>
            <View style={styles.handle} />
            <Text style={styles.title}>Tu perfil</Text>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.avatarSection}>
                <AvatarBadge
                  color={profile.avatarColor}
                  name={profile.name || "PadelNexo"}
                  size={120}
                  textSize={34}
                  uri={profile.avatarUrl}
                />
                <View style={styles.avatarActions}>
                  <AppButton
                    title="Subir foto"
                    onPress={handlePickImage}
                    style={styles.photoActionButton}
                    textStyle={styles.photoActionButtonText}
                  />
                  {profile.avatarUrl ? (
                    <AppButton
                      title="Eliminar foto"
                      onPress={handleDeletePhoto}
                      style={[styles.photoActionButton, styles.deletePhotoButton]}
                      textStyle={styles.deletePhotoButtonText}
                      variant="secondary"
                    />
                  ) : null}
                </View>
              </View>

              <View style={styles.accountCard}>
                <Text style={styles.accountLabel}>Tipo de cuenta</Text>
                <View
                  style={[
                    styles.accountBadge,
                    isApprovedAccount && styles.accountBadgeOrganizer,
                  ]}
                >
                  <Text
                    style={[
                      styles.accountValue,
                      isApprovedAccount && styles.accountValueOrganizer,
                    ]}
                  >
                    {getAccountTypeLabel(profile)}
                  </Text>
                </View>
                {showOrganizerHint ? (
                  <Text style={styles.accountHint}>{getOrganizerAccessMessage()}</Text>
                ) : null}
              </View>

              {canAccessAdminPanel(profile) ? (
                <AppButton
                  title="Ir a panel admin"
                  onPress={() => {
                    onClose?.();
                    navigation?.navigate("Admin");
                  }}
                  style={styles.adminButton}
                  variant="secondary"
                />
              ) : null}

              {profile.role === "user" ? (
                <AppButton
                  title="Solicitar acceso como organizador"
                  onPress={() => {
                    if (!emailVerified) {
                      Alert.alert(
                        "Email no verificado",
                        "Necesitas verificar tu correo electronico antes de solicitar acceso como organizador.\n\nRevisá tu bandeja de entrada o solicitá un nuevo email de verificacion.",
                        [
                          {
                            text: "Reenviar email",
                            onPress: () => {
                              resendVerificationEmail()
                                .then(() =>
                                  showFeedback(
                                    "Email enviado",
                                    "Revisa tu bandeja de entrada y hace click en el link de verificacion.",
                                    "success"
                                  )
                                )
                                .catch((error) =>
                                  showFeedback(
                                    "No pudimos enviar el email",
                                    error?.message || "Intenta nuevamente en unos minutos.",
                                    "danger"
                                  )
                                );
                            },
                          },
                          { text: "Cancelar", style: "cancel" },
                        ]
                      );
                      return;
                    }
                    setOrganizerModalMode("request");
                    setIsOrganizerModalVisible(true);
                  }}
                  style={styles.organizerButton}
                  textStyle={styles.organizerButtonText}
                  variant="secondary"
                />
              ) : null}

              {isApprovedOrganizer(profile) ? (
                <View style={styles.complexesSection}>
                  <View style={styles.organizerLogoSection}>
                    <Text style={styles.organizerLogoTitle}>Logo del organizador</Text>
                    <View style={styles.organizerLogoRow}>
                      <AvatarBadge
                        color={profile.avatarColor}
                        size={68}
                        uri={profile.organizerLogoUrl}
                      />
                      <View style={styles.organizerLogoActions}>
                        <AppButton
                          title={profile.organizerLogoUrl ? "Cambiar logo" : "Cargar logo"}
                          onPress={handlePickOrganizerLogo}
                          style={styles.organizerLogoButton}
                          textStyle={styles.organizerLogoButtonText}
                        />
                        {profile.organizerLogoUrl ? (
                          <AppButton
                            title="Quitar logo"
                            onPress={() => updateField("organizerLogoUrl", "")}
                            style={[styles.organizerLogoButton, styles.deletePhotoButton]}
                            textStyle={styles.organizerLogoDeleteButtonText}
                            variant="secondary"
                          />
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={styles.complexesHeader}>
                    <Text style={styles.complexesTitle}>Tus complejos</Text>
                    <Pressable
                      onPress={() => {
                        setOrganizerModalMode("edit");
                        setIsOrganizerModalVisible(true);
                      }}
                    >
                      <Text style={styles.editComplexesText}>Editar</Text>
                    </Pressable>
                  </View>

                  {(profile.complejos || []).map((complex, index) => (
                    <View key={`${complex.nombre}-${index}`} style={styles.complexCard}>
                      <Text style={styles.complexName}>{complex.nombre}</Text>
                      <Text style={styles.complexMeta}>Blindex: {complex.blindex}</Text>
                      <Text style={styles.complexMeta}>
                        Cemento con cesped sintetico: {complex.cesped}
                      </Text>
                      <Text style={styles.complexMeta}>
                        Cemento piso de cemento: {complex.cemento}
                      </Text>
                      <Text style={styles.complexMeta}>
                        Total de canchas: {complex.totalCanchas}
                      </Text>
                      <Text style={styles.complexAddress}>{complex.direccion}</Text>
                    </View>
                  ))}

                  <View style={styles.mercadoPagoSection}>
                    {/* Header */}
                    <View style={styles.mercadoPagoHeader}>
                      <View style={styles.mercadoPagoHeaderCopy}>
                        <Text style={styles.mercadoPagoTitle}>Cobros y pagos</Text>
                        <Text style={styles.mercadoPagoSubtitle}>Mercado Pago</Text>
                      </View>
                      <View
                        style={[
                          styles.mercadoPagoStatusBadge,
                          mercadoPagoAccountLinked
                            ? styles.mercadoPagoStatusBadgeLinked
                            : styles.mercadoPagoStatusBadgePending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.mercadoPagoStatusText,
                            mercadoPagoAccountLinked
                              ? styles.mercadoPagoStatusTextLinked
                              : styles.mercadoPagoStatusTextPending,
                          ]}
                        >
                          {mercadoPagoAccountLinked ? "✓ Vinculada" : "Sin vincular"}
                        </Text>
                      </View>
                    </View>

                    {/* Cuenta vinculada: mostrar nombre */}
                    {mercadoPagoAccountLinked && mercadoPagoProfileConfig.accountDisplayName ? (
                      <Text style={styles.mercadoPagoAccountName}>
                        {mercadoPagoProfileConfig.accountDisplayName}
                      </Text>
                    ) : null}

                    {/* Botón vincular */}
                    <AppButton
                      title={
                        loading
                          ? "Esperando autorizacion..."
                          : mercadoPagoAccountLinked
                            ? "Actualizar vinculacion"
                            : "Vincular mi cuenta de Mercado Pago"
                      }
                      onPress={handleMercadoPagoLinkAccount}
                      disabled={!mercadoPagoOAuthReady || loading}
                      style={styles.mercadoPagoLinkButton}
                      textStyle={styles.mercadoPagoLinkButtonText}
                    />

                    {/* Toggles */}
                    <MpToggleRow
                      label="Cobros con Mercado Pago"
                      value={normalizeMercadoPagoConfig(profile.mercadoPagoConfig).enabled}
                      onPress={() => handleMercadoPagoToggle("enabled")}
                    />
                    <MpToggleRow
                      label="Activar en nuevas publicaciones"
                      value={normalizeMercadoPagoConfig(profile.mercadoPagoConfig).autoEnableNewPayments}
                      onPress={() => handleMercadoPagoToggle("autoEnableNewPayments")}
                    />

                    {/* Categorías */}
                    <View style={styles.mercadoPagoCategoriesSection}>
                      <Text style={styles.mercadoPagoCategoriesTitle}>Habilitado para</Text>
                      <View style={styles.mpCategoryRow}>
                        {mercadoPagoCategoryOptions.map((category) => {
                          const normalizedMercadoPagoConfig = normalizeMercadoPagoConfig(
                            profile.mercadoPagoConfig
                          );
                          const isCategoryEnabled =
                            normalizedMercadoPagoConfig.categories?.[category.key] === true;
                          const categoriesDisabled = !normalizedMercadoPagoConfig.enabled;

                          return (
                            <Pressable
                              key={category.key}
                              disabled={categoriesDisabled}
                              onPress={() => handleMercadoPagoCategoryToggle(category.key)}
                              style={({ pressed }) => [
                                styles.mpCategoryChip,
                                isCategoryEnabled && !categoriesDisabled
                                  ? styles.mpCategoryChipActive
                                  : styles.mpCategoryChipInactive,
                                categoriesDisabled ? styles.mercadoPagoToggleButtonDisabled : null,
                                pressed ? styles.mercadoPagoToggleButtonPressed : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.mpCategoryChipText,
                                  isCategoryEnabled && !categoriesDisabled
                                    ? styles.mpCategoryChipTextActive
                                    : styles.mpCategoryChipTextInactive,
                                ]}
                              >
                                {category.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <Text style={styles.mercadoPagoHelpText}>
                      Asegurate de tener abierta la cuenta correcta en Mercado Pago antes de vincular.
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.nameRow}>
                <AppInput
                  autoCapitalize="words"
                  containerStyle={styles.nameField}
                  inputStyle={styles.compactInput}
                  label="Nombre"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => updateNameField("firstName", value)}
                  placeholder="Nombre"
                  value={profile.firstName || ""}
                />
                <AppInput
                  autoCapitalize="words"
                  containerStyle={styles.nameField}
                  inputStyle={styles.compactInput}
                  label="Apellido"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => updateNameField("lastName", value)}
                  placeholder="Apellido"
                  value={profile.lastName || ""}
                />
              </View>
              <View style={styles.compactField}>
                <Text style={[styles.centeredLabel, styles.dateLabel]}>Fecha de nacimiento</Text>
                <Pressable
                  onPress={() => {
                    const initialDate = profile.fechaNacimiento
                      ? fechaNacimientoToDate(profile.fechaNacimiento)
                      : new Date(2000, 0, 1);
                    if (Platform.OS === "android") {
                      DateTimePickerAndroid.open({
                        value: initialDate,
                        mode: "date",
                        display: "spinner",
                        maximumDate: new Date(),
                        minimumDate: new Date(1900, 0, 1),
                        onChange: (event, selectedDate) => {
                          if (event.type === "set" && selectedDate) {
                            updateField("fechaNacimiento", dateToFechaNacimiento(selectedDate));
                          }
                        },
                      });
                    } else {
                      setTempDate(initialDate);
                      setDatePickerVisible(true);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.dateField,
                    pressed && styles.dateFieldPressed,
                  ]}
                >
                  <Text style={profile.fechaNacimiento ? styles.dateValue : styles.datePlaceholder}>
                    {profile.fechaNacimiento
                      ? formatFechaNacimientoDisplay(profile.fechaNacimiento)
                      : "DD/MM/AAAA"}
                  </Text>
                </Pressable>
                {datePickerVisible && (
                  <>
                    <DateTimePicker
                      value={tempDate || new Date(2000, 0, 1)}
                      mode="date"
                      display="spinner"
                      maximumDate={new Date()}
                      minimumDate={new Date(1900, 0, 1)}
                      onChange={(_, selectedDate) => {
                        if (selectedDate) setTempDate(selectedDate);
                      }}
                    />
                    <Pressable
                      onPress={() => {
                        if (tempDate) {
                          updateField("fechaNacimiento", dateToFechaNacimiento(tempDate));
                        }
                        setDatePickerVisible(false);
                      }}
                      style={styles.dateConfirmButton}
                    >
                      <Text style={styles.dateConfirmButtonText}>Listo</Text>
                    </Pressable>
                  </>
                )}
              </View>
              <AppInput
                autoCapitalize="none"
                containerStyle={styles.compactField}
                inputStyle={styles.compactInput}
                keyboardType="email-address"
                label="Email"
                labelStyle={styles.centeredLabel}
                editable={false}
                placeholder="tuemail@mail.com"
                value={profile.email}
              />
              <View style={styles.phoneRow}>
                <AppInput
                  containerStyle={styles.phoneField}
                  leftElement={
                    <CountryCodeSelector
                      onChange={(option) => {
                        updateField("countryCode", option.code);
                        updateField("phoneCountry", option.country);
                      }}
                      options={phoneCountryOptions}
                      value={profile.phoneCountry || "Argentina"}
                    />
                  }
                  inputStyle={styles.compactInput}
                  keyboardType="phone-pad"
                  label="Celular"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => updateField("phone", sanitizePhoneValue(value))}
                  placeholder="11 5555 5555"
                  value={profile.phone}
                />
                <View style={styles.phoneVisibilityBox}>
                  <Text style={styles.phoneVisibilityLabel}>Mostrar celular</Text>
                  <Pressable
                    onPress={() => updateField("isPhonePublic", !profile.isPhonePublic)}
                    style={({ pressed }) => [
                      styles.phoneVisibilityButton,
                      profile.isPhonePublic
                        ? styles.phoneVisibilityButtonActive
                        : styles.phoneVisibilityButtonInactive,
                      pressed ? styles.phoneVisibilityButtonPressed : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.phoneVisibilityButtonText,
                        profile.isPhonePublic
                          ? styles.phoneVisibilityButtonTextActive
                          : styles.phoneVisibilityButtonTextInactive,
                      ]}
                    >
                      {profile.isPhonePublic ? "ON" : "OFF"}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <LocationPicker
                containerStyle={styles.compactField}
                inputStyle={styles.compactInput}
                label="Localidad"
                labelStyle={styles.centeredLabel}
                onChangeText={(text) => {
                  setSelectedLocation(null);
                  setProfile((current) => ({
                    ...current,
                    city: text,
                    localidad: null,
                  }));
                }}
                onSelect={(location) => {
                  setSelectedLocation(location);
                  setProfile((current) => ({
                    ...current,
                    city: location?.nombre || "",
                    province: location?.provincia || current.province,
                    localidad: location || null,
                    location: location
                      ? {
                          ...(current.location || {}),
                          ciudad: location.nombre,
                          provincia: location.provincia,
                          pais: location.pais,
                        }
                      : current.location,
                  }));
                }}
                placeholder="Escribe tu localidad"
                selectedLocation={selectedLocation}
                value={profile.city}
              />
              <AppInput
                containerStyle={styles.compactField}
                editable={false}
                label="Provincia"
                labelStyle={styles.centeredLabel}
                inputStyle={styles.compactInput}
                placeholder=""
                value={selectedLocation?.provincia || profile.localidad?.provincia || ""}
              />
              <SelectField
                label="Categoria"
                labelStyle={styles.centeredLabel}
                containerStyle={styles.compactField}
                fieldStyle={styles.compactSelectField}
                onClose={() => setIsCategoryVisible(false)}
                onOpen={() => setIsCategoryVisible(true)}
                onSelect={(value) => updateField("category", value)}
                options={categoryOptions}
                placeholder="Selecciona una categoria"
                value={profile.category}
                visible={isCategoryVisible}
              />
              <SelectField
                label="Sexo"
                labelStyle={styles.centeredLabel}
                containerStyle={styles.compactField}
                fieldStyle={styles.compactSelectField}
                onClose={() => setIsSexVisible(false)}
                onOpen={() => setIsSexVisible(true)}
                onSelect={(value) => updateField("sex", value)}
                options={sexDropdownOptions}
                placeholder="Selecciona una opcion"
                value={profile.sex}
                visible={isSexVisible}
              />
              <SelectField
                label="Lado preferido de juego"
                labelStyle={styles.centeredLabel}
                containerStyle={styles.compactField}
                fieldStyle={styles.compactSelectField}
                onClose={() => setIsPreferredSideVisible(false)}
                onOpen={() => setIsPreferredSideVisible(true)}
                onSelect={(value) => updateField("ladoJuego", value)}
                options={preferredSideOptions}
                placeholder="Selecciona una opcion"
                value={profile.ladoJuego}
                visible={isPreferredSideVisible}
              />
              <SelectField
                label="Mano habil"
                labelStyle={styles.centeredLabel}
                containerStyle={styles.compactField}
                fieldStyle={styles.compactSelectField}
                onClose={() => setIsDominantHandVisible(false)}
                onOpen={() => setIsDominantHandVisible(true)}
                onSelect={(value) => updateField("manoHabil", value)}
                options={dominantHandOptions}
                placeholder="Selecciona una opcion"
                value={profile.manoHabil || ""}
                visible={isDominantHandVisible}
              />

              <View style={styles.bioBlock}>
                <Text style={styles.bioLabel}>Descripcion personal</Text>
                <TextInput
                  multiline
                  numberOfLines={4}
                  onChangeText={(value) => updateField("description", value)}
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  placeholder="Escribe algo acerca de ti"
                  style={styles.bioInput}
                  textAlignVertical="top"
                  value={profile.description}
                />
              </View>

              <View style={styles.actionBlock}>
                <AppButton
                  disabled={loading}
                  title={loading ? "Guardando..." : "Guardar perfil"}
                  onPress={handleSave}
                  style={styles.compactButton}
                />
                <AppButton
                  title="Cerrar sesion"
                  onPress={handleLogout}
                  style={[styles.compactButton, styles.compactSecondaryButton]}
                  variant="secondary"
                />
              </View>
              <View style={styles.deleteAccountRow}>
                <Pressable
                  disabled={loading}
                  onPress={handleDeleteAccount}
                  style={({ pressed }) => [
                    styles.deleteAccountTextButton,
                    pressed && styles.confirmButtonPressed,
                  ]}
                >
                  <Text style={styles.deleteAccountText}>Eliminar cuenta</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <OrganizerRequestModal
        mode={organizerModalMode}
        onClose={() => setIsOrganizerModalVisible(false)}
        onSaved={(updatedProfile) => {
          setProfile({
            ...defaultProfile,
            ...updatedProfile,
          });
        }}
        user={profile}
        visible={isOrganizerModalVisible}
      />
      <FeedbackModal
        confirmLabel="Entendido"
        message={feedback.message}
        onClose={() =>
          setFeedback((current) => ({
            ...current,
            visible: false,
          }))
        }
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => setIsDeleteConfirmVisible(false)}
        transparent
        visible={isDeleteConfirmVisible}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setIsDeleteConfirmVisible(false)}
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Eliminar cuenta</Text>
            <Text style={styles.confirmText}>
              Esta accion eliminara tu acceso a PadelNexo. Quieres continuar?
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setIsDeleteConfirmVisible(false)}
                style={({ pressed }) => [
                  styles.confirmSecondaryButton,
                  pressed && styles.confirmButtonPressed,
                ]}
              >
                <Text style={styles.confirmSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmDeleteAccount}
                style={({ pressed }) => [
                  styles.confirmPrimaryButton,
                  pressed && styles.confirmButtonPressed,
                ]}
              >
                <Text style={styles.confirmPrimaryButtonText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setIsLogoutConfirmVisible(false)}
        transparent
        visible={isLogoutConfirmVisible}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setIsLogoutConfirmVisible(false)}
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Cerrar sesion</Text>
            <Text style={styles.confirmText}>Quieres salir de tu cuenta actual?</Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setIsLogoutConfirmVisible(false)}
                style={({ pressed }) => [
                  styles.confirmSecondaryButton,
                  pressed && styles.confirmButtonPressed,
                ]}
              >
                <Text style={styles.confirmSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmLogout}
                style={({ pressed }) => [
                  styles.confirmPrimaryButton,
                  pressed && styles.confirmButtonPressed,
                ]}
              >
                <Text style={styles.confirmPrimaryButtonText}>Cerrar sesion</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "92%",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xl + 36,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 5,
    marginBottom: spacing.md,
    width: 52,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
  },
  avatarSection: {
    alignItems: "center",
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  avatarActions: {
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  photoActionButton: {
    borderRadius: 14,
    flex: 1,
    height: 40,
    marginBottom: 0,
    marginHorizontal: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
  },
  deletePhotoButton: {
    backgroundColor: "#F6E4E4",
    borderColor: "#E6BBBB",
  },
  photoActionButtonText: {
    fontSize: 14,
    textAlign: "center",
  },
  deletePhotoButtonText: {
    color: "#A64747",
    fontSize: 14,
    textAlign: "center",
  },
  accountCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  accountLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  accountBadge: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
  },
  accountBadgeOrganizer: {
    backgroundColor: "#FFF0DF",
    borderColor: "#F0BF87",
  },
  accountValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  accountValueOrganizer: {
    color: "#BF6800",
  },
  accountHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  organizerButton: {
    backgroundColor: "#FFF4DF",
    borderColor: "#E4C082",
    borderWidth: 1,
    minHeight: 42,
    paddingVertical: 8,
    marginTop: 0,
  },
  organizerButtonText: {
    color: "#A15E00",
  },
  adminButton: {
    marginTop: 0,
  },
  organizerLogoSection: {
    marginBottom: spacing.md,
  },
  organizerLogoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  organizerLogoRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "center",
  },
  organizerLogoActions: {
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  organizerLogoButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    height: 32,
    marginBottom: 0,
    minHeight: 0,
    minWidth: 108,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
  },
  organizerLogoButtonText: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  organizerLogoDeleteButtonText: {
    color: "#A64747",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  complexesSection: {
    marginBottom: spacing.md,
  },
  mercadoPagoSection: {
    backgroundColor: "#F7FAFD",
    borderColor: "#D7E3EC",
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  mercadoPagoHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  mercadoPagoHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  mercadoPagoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  mercadoPagoSubtitle: {
    color: "#3C6E91",
    fontSize: 13,
    fontWeight: "800",
  },
  mercadoPagoStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  mercadoPagoStatusBadgeLinked: {
    backgroundColor: "#EEF9F1",
    borderColor: "#B7DFBF",
  },
  mercadoPagoStatusBadgePending: {
    backgroundColor: "#FFF9E6",
    borderColor: "#E5D07F",
  },
  mercadoPagoStatusText: {
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  mercadoPagoStatusTextLinked: {
    color: "#237547",
  },
  mercadoPagoStatusTextPending: {
    color: "#8C6A05",
  },
  mercadoPagoInfoCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D7E3EC",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  mercadoPagoInfoLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  mercadoPagoInfoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  mercadoPagoLinkButton: {
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  mercadoPagoLinkButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },
  mercadoPagoToggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginBottom: spacing.xs,
    paddingVertical: 2,
  },
  mercadoPagoCategoriesSection: {
    borderTopColor: "#D7E3EC",
    borderTopWidth: 1,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  mercadoPagoCategoriesTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  mercadoPagoToggleLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  mercadoPagoToggleLabelDisabled: {
    color: "#8A97A5",
  },
  mercadoPagoToggleButton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 74,
    paddingHorizontal: spacing.sm,
  },
  mercadoPagoToggleButtonActive: {
    backgroundColor: "#E8F5EE",
    borderColor: "#B8DCC7",
  },
  mercadoPagoToggleButtonInactive: {
    backgroundColor: "#F3F5F7",
    borderColor: "#D4DBE2",
  },
  mercadoPagoToggleButtonPressed: {
    opacity: 0.86,
  },
  mercadoPagoToggleButtonDisabled: {
    opacity: 0.45,
  },
  mercadoPagoToggleButtonText: {
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  mercadoPagoToggleButtonTextActive: {
    color: colors.primaryDark,
  },
  mercadoPagoToggleButtonTextInactive: {
    color: "#667482",
  },
  mercadoPagoAccountName: {
    color: "#3C6E91",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  mpCategoryRow: {
    flexDirection: "row",
    gap: spacing.xs,
    flexWrap: "wrap",
    marginTop: 4,
  },
  mpCategoryChip: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  mpCategoryChipActive: {
    backgroundColor: "#E8F5EE",
    borderColor: "#1fa36d",
  },
  mpCategoryChipInactive: {
    backgroundColor: "#F3F5F7",
    borderColor: "#C8D3DC",
  },
  mpCategoryChipText: {
    fontSize: 13,
    fontWeight: "700",
  },
  mpCategoryChipTextActive: {
    color: "#0d5c3a",
  },
  mpCategoryChipTextInactive: {
    color: "#7A8B99",
  },
  mercadoPagoHelpText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  complexesHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  complexesTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  editComplexesText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  complexCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  complexName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  complexMeta: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  complexAddress: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  bioBlock: {
    marginBottom: spacing.lg,
  },
  bioLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
    textAlign: "center",
  },
  bioInput: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
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
  actionBlock: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  compactButton: {
    marginBottom: 0,
    minHeight: 48,
    paddingVertical: 12,
  },
  compactSecondaryButton: {
    marginTop: 0,
  },
  deleteAccountRow: {
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    marginBottom: spacing.lg,
    marginTop: 6,
    width: "100%",
  },
  deleteAccountTextButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "transparent",
    borderRadius: 999,
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 0,
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: "100%",
  },
  deleteAccountText: {
    color: "#6FAED9",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    width: "100%",
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  confirmText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  confirmActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  confirmSecondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  confirmPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#C53B3B",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  confirmSecondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  confirmPrimaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  confirmButtonPressed: {
    opacity: 0.9,
  },
  nameRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 0,
  },
  nameField: {
    flex: 1,
    marginBottom: 0,
  },
  dateLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
    marginTop: 6,
  },
  dateField: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  dateFieldPressed: {
    opacity: 0.7,
  },
  dateValue: {
    color: colors.text,
    fontSize: 15,
  },
  datePlaceholder: {
    color: colors.muted,
    fontSize: 15,
  },
  dateConfirmButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: "center",
    marginBottom: spacing.xs,
    minHeight: 42,
  },
  dateConfirmButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  dateBlock: {
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  dateBlockLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 6,
    textTransform: "uppercase",
    textAlign: "center",
  },
  dateBlockField: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  dateBlockFieldPressed: {
    opacity: 0.7,
  },
  dateBlockValue: {
    color: colors.text,
    fontSize: 15,
  },
  dateBlockPlaceholder: {
    color: colors.muted,
    fontSize: 15,
  },
});


