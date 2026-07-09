import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "../../services/firebaseFirestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "../../services/firebaseStorage";

import { db, ensureDb, ensureStorage, storage } from "../../services/firebaseConfig";
import { argentinaCities, avatarColors } from "../data/profileOptions";
import {
  availabilityToFirestore,
  buildAvailabilityFromLegacy,
  normalizeAvailability,
} from "./availabilityService";
import {
  getOrganizerRequest,
  normalizeComplex,
} from "./organizerService";
import { getDefaultRoleData } from "./roleService";
import { calcularEdad } from "../utils/ageUtils";
import devLog from "../utils/devLog";

const DEFAULT_LOCATION = {
  ciudad: "",
  provincia: "",
  pais: "Argentina",
  lat: null,
  lng: null,
};
const DEFAULT_LOCALIDAD = {
  nombre: "",
  provincia: "",
  pais: "Argentina",
};
function findCityOption(city) {
  const normalizedCity = city?.trim().toLowerCase();

  if (!normalizedCity) {
    return null;
  }

  return (
    argentinaCities.find(
      (option) =>
        option.value.toLowerCase() === normalizedCity ||
        option.label.toLowerCase() === normalizedCity
    ) || null
  );
}

function buildLocation(city, province, country = DEFAULT_LOCATION.pais) {
  const selectedCity = findCityOption(city);
  const labelParts = selectedCity?.label?.split(",").map((part) => part.trim()) || [];

  return {
    ciudad: selectedCity?.value || city?.trim() || DEFAULT_LOCATION.ciudad,
    provincia: province?.trim() || labelParts[1] || DEFAULT_LOCATION.provincia,
    pais: country?.trim() || DEFAULT_LOCATION.pais,
    lat: null,
    lng: null,
  };
}

function normalizeLocalidadPayload(localidad, fallback = {}) {
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
      pais: fallback.pais || DEFAULT_LOCALIDAD.pais,
    };
  }

  const nombre = localidad.nombre?.trim() || localidad.ciudad?.trim() || "";
  const provincia = localidad.provincia?.trim() || fallback.provincia || "";
  const pais = localidad.pais?.trim() || fallback.pais || DEFAULT_LOCALIDAD.pais;

  if (!nombre) {
    return null;
  }

  return { nombre, provincia, pais };
}

function resolveLocalidadFromDoc(profileDoc = {}) {
  const legacyLocation = profileDoc.location || {};
  const fallbackFromLegacy = {
    provincia: legacyLocation.provincia || profileDoc.province || "",
    pais: legacyLocation.pais || profileDoc.country || DEFAULT_LOCALIDAD.pais,
  };
  const parsedLocalidad = normalizeLocalidadPayload(profileDoc.localidad, fallbackFromLegacy);

  if (parsedLocalidad) {
    return parsedLocalidad;
  }

  const legacyName =
    legacyLocation.ciudad ||
    profileDoc.city ||
    profileDoc.localidadNombre ||
    "";

  if (!legacyName) {
    return null;
  }

  return normalizeLocalidadPayload(
    {
      nombre: legacyName,
      provincia: fallbackFromLegacy.provincia,
      pais: fallbackFromLegacy.pais,
    },
    fallbackFromLegacy
  );
}

function mapDocToUserData(uid, profileDoc = {}, fallbackEmail = "") {
  const roleData = getDefaultRoleData(false);
  const complejos = Array.isArray(profileDoc.complejos)
    ? profileDoc.complejos.map(normalizeComplex)
    : [];
  const tournamentComplexes = Array.isArray(profileDoc.tournamentComplexes)
    ? profileDoc.tournamentComplexes.map(normalizeComplex)
    : [];
  const localidad = resolveLocalidadFromDoc(profileDoc);
  const resolvedCity =
    localidad?.nombre || profileDoc.location?.ciudad || DEFAULT_LOCATION.ciudad;
  const resolvedProvince =
    localidad?.provincia ||
    profileDoc.location?.provincia ||
    (localidad?.nombre ? "" : DEFAULT_LOCATION.provincia);
  const resolvedCountry =
    localidad?.pais || profileDoc.location?.pais || DEFAULT_LOCATION.pais;
  const location = {
    ...DEFAULT_LOCATION,
    ...(profileDoc.location || {}),
    ciudad: resolvedCity,
    provincia: resolvedProvince,
    pais: resolvedCountry,
  };
  const availability = profileDoc.availability
    ? normalizeAvailability(profileDoc.availability)
    : buildAvailabilityFromLegacy(profileDoc.disponibilidadDias, profileDoc.disponibilidadHoraria);
  const mercadoPagoConfig =
    profileDoc.mercadoPagoConfig && typeof profileDoc.mercadoPagoConfig === "object"
      ? {
          enabled: profileDoc.mercadoPagoConfig.enabled === true,
          accountLinked: profileDoc.mercadoPagoConfig.accountLinked === true,
          autoEnableNewPayments: profileDoc.mercadoPagoConfig.autoEnableNewPayments === true,
          accountDisplayName: profileDoc.mercadoPagoConfig.accountDisplayName || "",
          connectionStatus: profileDoc.mercadoPagoConfig.connectionStatus || "checkout_pro_test",
          categories: {
            turnos: profileDoc.mercadoPagoConfig?.categories?.turnos !== false,
            ligas: profileDoc.mercadoPagoConfig?.categories?.ligas !== false,
            torneos: profileDoc.mercadoPagoConfig?.categories?.torneos !== false,
          },
        }
      : {
          enabled: false,
          accountLinked: false,
          autoEnableNewPayments: false,
          accountDisplayName: "",
          connectionStatus: "checkout_pro_test",
          categories: {
            turnos: true,
            ligas: true,
            torneos: true,
          },
        };

  return {
    uid,
    name: profileDoc.nombre || "Jugador",
    email: profileDoc.email || fallbackEmail || "",
    phone: profileDoc.telefono || "",
    countryCode: profileDoc.countryCode || "+54",
    phoneCountry: profileDoc.phoneCountry || "Argentina",
    isPhonePublic: Boolean(profileDoc.mostrarTelefono),
    accountDeleted: Boolean(profileDoc.accountDeleted),
    blockStatus: profileDoc.blockStatus || "none",
    blockedAt: profileDoc.blockedAt || null,
    blockedUntilMillis: Number(profileDoc.blockedUntilMillis || 0),
    blockReason: profileDoc.blockReason || "",
    category: profileDoc.categoria || "Iniciante",
    sex: profileDoc.sexo || "Masculino",
    ladoJuego: profileDoc.ladoJuego || "ambos",
    manoHabil: profileDoc.manoHabil || "",
    description: profileDoc.descripcion || "",
    avatarUrl: profileDoc.fotoURL || "",
    organizerLogoUrl: profileDoc.organizerLogoURL || "",
    avatarColor: profileDoc.avatarColor || avatarColors[0],
    city: resolvedCity,
    province: resolvedProvince,
    localidad,
    location,
    role: profileDoc.role || roleData.role,
    adminStatus: profileDoc.adminStatus || "none",
    organizerStatus: profileDoc.organizerStatus || roleData.organizerStatus,
    leagueDefaults: profileDoc.leagueDefaults || null,
    leaguePaymentDefaults: profileDoc.leaguePaymentDefaults || null,
    mercadoPagoConfig,
    tournamentFixtureDefaults: profileDoc.tournamentFixtureDefaults || null,
    availability,
    complejos,
    tournamentComplexes,
    fechaNacimiento: profileDoc.fechaNacimiento || "",
    createdAt: profileDoc.createdAt || null,
  };
}

async function getProfileImageDownloadUrl(userId) {
  const activeStorage = await ensureStorage();

  if (!activeStorage) {
    throw new Error("Storage no esta disponible en este momento.");
  }

  const imageRef = ref(activeStorage, `profileImages/${userId}`);
  return getDownloadURL(imageRef);
}

async function uploadUserImage(userId, imageUri, folder = "profileImages", errorMessage) {
  try {
    const activeStorage = await ensureStorage();

    if (!activeStorage) {
      throw new Error("Storage no esta disponible en este momento.");
    }

    devLog("[userService] Preparando imagen de perfil:", imageUri);
    const response = await fetch(imageUri);
    const blob = await response.blob();
    const imageRef = ref(activeStorage, `${folder}/${userId}`);

    devLog("[userService] Subiendo imagen a Firebase Storage");
    await uploadBytes(imageRef, blob, {
      contentType: blob.type || "image/jpeg",
    });

    devLog("[userService] Obteniendo download URL");
    const downloadURL = await getDownloadURL(imageRef);
    devLog("[userService] URL publica generada:", downloadURL);

    return downloadURL;
  } catch (error) {
    devLog("[userService] Error al subir imagen:", error);
    throw new Error(errorMessage || "No pudimos subir tu imagen.");
  }
}

async function uploadProfileImage(userId, imageUri) {
  return uploadUserImage(userId, imageUri, "profileImages", "No pudimos subir tu foto de perfil.");
}

async function uploadOrganizerLogo(userId, imageUri) {
  return uploadUserImage(
    userId,
    imageUri,
    "organizerLogos",
    "No pudimos subir el logo del organizador."
  );
}

export async function removeUserProfilePhoto(uid) {
  const activeDb = await ensureDb();
  const activeStorage = await ensureStorage();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const userRef = doc(activeDb, "users", uid);
  const imageRef = activeStorage ? ref(activeStorage, `profileImages/${uid}`) : null;

  try {
    if (imageRef) {
      devLog("[userService] Eliminando foto de Firebase Storage");
      await deleteObject(imageRef);
    }
  } catch (error) {
    if (error?.code !== "storage/object-not-found") {
      devLog("[userService] Error al eliminar foto de Storage:", error);
      throw new Error("No pudimos eliminar tu foto de perfil.");
    }
  }

  devLog("[userService] Limpiando fotoURL en Firestore");
  await updateDoc(userRef, {
    fotoURL: null,
  });

  return getUserProfile(uid);
}

export async function hideUserProfile(uid) {
  const activeDb = await ensureDb();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const userRef = doc(activeDb, "users", uid);

  await updateDoc(userRef, {
    accountDeleted: true,
    deletedAt: serverTimestamp(),
  });
}

export async function deleteUserProfileData(uid) {
  const activeDb = await ensureDb();
  const activeStorage = await ensureStorage();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const userRef = doc(activeDb, "users", uid);
  const organizerRequestRef = doc(activeDb, "organizerRequests", uid);
  const imageRef = activeStorage ? ref(activeStorage, `profileImages/${uid}`) : null;

  try {
    if (imageRef) {
      await deleteObject(imageRef);
    }
  } catch (error) {
    if (error?.code !== "storage/object-not-found") {
      devLog("[userService] Error al eliminar foto durante baja de cuenta:", error);
    }
  }

  try {
    await deleteDoc(organizerRequestRef);
  } catch (error) {
    devLog("[userService] No se pudo eliminar organizerRequest:", error);
  }

  try {
    await deleteDoc(userRef);
  } catch (error) {
    devLog("[userService] No se pudo eliminar perfil de usuario:", error);
  }
}

async function normalizeProfileImage(uid, profileDoc) {
  if (!profileDoc?.fotoURL || !profileDoc.fotoURL.startsWith("gs://")) {
    return profileDoc;
  }

  try {
    const downloadURL = await getProfileImageDownloadUrl(uid);
    const activeDb = await ensureDb();

    if (!activeDb) {
      return {
        ...profileDoc,
        fotoURL: "",
      };
    }

    await updateDoc(doc(activeDb, "users", uid), {
      fotoURL: downloadURL,
    });

    return {
      ...profileDoc,
      fotoURL: downloadURL,
    };
  } catch (error) {
    return {
      ...profileDoc,
      fotoURL: "",
    };
  }
}

async function syncOrganizerApproval(uid, profileDoc) {
  const hasOrganizerFlow =
    profileDoc?.role === "organizer" || profileDoc?.organizerStatus !== "none";

  if (!hasOrganizerFlow) {
    return profileDoc;
  }

  const organizerRequest = await getOrganizerRequest(uid);

  if (!organizerRequest) {
    return profileDoc;
  }

  const approvedByAdmin =
    profileDoc.organizerStatus === "approved" ||
    organizerRequest.status === "approved";

  if (!approvedByAdmin) {
    return {
      ...profileDoc,
      complejos: Array.isArray(profileDoc.complejos) ? profileDoc.complejos : [],
    };
  }

  const hasUserComplexes =
    Array.isArray(profileDoc.complejos) && profileDoc.complejos.length > 0;
  const complejos = hasUserComplexes ? profileDoc.complejos : organizerRequest.complejos || [];
  const shouldSyncUserDoc =
    profileDoc.role !== "organizer" ||
    profileDoc.organizerStatus !== "approved" ||
    !hasUserComplexes;

  if (shouldSyncUserDoc) {
    const activeDb = await ensureDb();

    if (!activeDb) {
      return {
        ...profileDoc,
        role: "organizer",
        organizerStatus: "approved",
        complejos,
      };
    }

    await updateDoc(doc(activeDb, "users", uid), {
      role: "organizer",
      organizerStatus: "approved",
      complejos,
    });
  }

  return {
    ...profileDoc,
    role: "organizer",
    organizerStatus: "approved",
    complejos,
  };
}

export async function createUserProfile(uid, payload) {
  const activeDb = await ensureDb();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const userRef = doc(activeDb, "users", uid);
  const localidad =
    normalizeLocalidadPayload(payload.localidad) ||
    normalizeLocalidadPayload(
      {
        nombre: payload.city,
        provincia: payload.province,
        pais: payload.country,
      },
      DEFAULT_LOCALIDAD
    ) ||
    { ...DEFAULT_LOCALIDAD };
  const location = buildLocation(localidad.nombre, localidad.provincia, localidad.pais);
  const roleData = getDefaultRoleData(false);
  const availability = availabilityToFirestore(payload.availability);

  await setDoc(userRef, {
    nombre: payload.name,
    firstName: payload.firstName || "",
    lastName: payload.lastName || "",
    apellido: payload.lastName || "",
    email: payload.email,
    telefono: payload.phone || "",
    countryCode: payload.countryCode || "+54",
    phoneCountry: payload.phoneCountry || "Argentina",
    mostrarTelefono: Boolean(payload.isPhonePublic),
    categoria: payload.category || "Iniciante",
    sexo: payload.sex || "Masculino",
    ladoJuego: payload.ladoJuego || "ambos",
    manoHabil: payload.manoHabil || "",
    descripcion: payload.description || "",
    fotoURL: payload.avatarUrl || "",
    organizerLogoURL: payload.organizerLogoUrl || "",
    avatarColor: payload.avatarColor || avatarColors[0],
    localidad,
    location,
    role: roleData.role,
    organizerStatus: roleData.organizerStatus,
    availability,
    tournamentComplexes: [],
    fechaNacimiento: payload.fechaNacimiento || "",
    chatHabilitado: (calcularEdad(payload.fechaNacimiento) ?? 0) >= 14,
    createdAt: serverTimestamp(),
  });

  return mapDocToUserData(uid, {
    nombre: payload.name,
    firstName: payload.firstName || "",
    lastName: payload.lastName || "",
    apellido: payload.lastName || "",
    email: payload.email,
    telefono: payload.phone || "",
    countryCode: payload.countryCode || "+54",
    phoneCountry: payload.phoneCountry || "Argentina",
    mostrarTelefono: Boolean(payload.isPhonePublic),
    categoria: payload.category || "Iniciante",
    sexo: payload.sex || "Masculino",
    ladoJuego: payload.ladoJuego || "ambos",
    manoHabil: payload.manoHabil || "",
    descripcion: payload.description || "",
    fotoURL: payload.avatarUrl || "",
    organizerLogoURL: payload.organizerLogoUrl || "",
    avatarColor: payload.avatarColor || avatarColors[0],
    localidad,
    location,
    role: roleData.role,
    organizerStatus: roleData.organizerStatus,
    availability,
    tournamentComplexes: [],
    fechaNacimiento: payload.fechaNacimiento || "",
  });
}

export async function getUserProfile(uid, fallbackEmail = "") {
  const activeDb = await ensureDb();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const userRef = doc(activeDb, "users", uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    return null;
  }

  const profileWithImage = await normalizeProfileImage(uid, snapshot.data());
  const normalizedProfile = await syncOrganizerApproval(uid, profileWithImage);

  return mapDocToUserData(uid, normalizedProfile, fallbackEmail);
}

export async function recordUserLogin(uid) {
  const activeDb = await ensureDb();

  if (!activeDb || !uid) {
    return;
  }

  await updateDoc(doc(activeDb, "users", uid), {
    lastLoginAt: serverTimestamp(),
  });
}

export async function updateUserProfile(uid, updates) {
  const activeDb = await ensureDb();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const userRef = doc(activeDb, "users", uid);
  const payload = {};

  if (typeof updates.name === "string") {
    payload.nombre = updates.name.trim();
  }

  if (typeof updates.phone === "string") {
    payload.telefono = updates.phone.trim();
  }

  if (typeof updates.countryCode === "string" && updates.countryCode.trim()) {
    payload.countryCode = updates.countryCode.trim();
  }

  if (typeof updates.phoneCountry === "string" && updates.phoneCountry.trim()) {
    payload.phoneCountry = updates.phoneCountry.trim();
  }

  if (typeof updates.isPhonePublic === "boolean") {
    payload.mostrarTelefono = updates.isPhonePublic;
  }

  if (typeof updates.accountDeleted === "boolean") {
    payload.accountDeleted = updates.accountDeleted;
  }

  if (typeof updates.category === "string") {
    payload.categoria = updates.category;
  }

  if (typeof updates.sex === "string") {
    payload.sexo = updates.sex;
  }

  if (typeof updates.ladoJuego === "string") {
    payload.ladoJuego = updates.ladoJuego;
  }

  if (typeof updates.manoHabil === "string") {
    payload.manoHabil = updates.manoHabil.trim();
  }

  if (typeof updates.description === "string") {
    payload.descripcion = updates.description.trim();
  }

  if (updates.availability) {
    payload.availability = availabilityToFirestore(updates.availability);
  }

  if (typeof updates.avatarColor === "string") {
    payload.avatarColor = updates.avatarColor;
  }

  if (updates.leagueDefaults && typeof updates.leagueDefaults === "object") {
    payload.leagueDefaults = updates.leagueDefaults;
  }

  if (updates.leaguePaymentDefaults && typeof updates.leaguePaymentDefaults === "object") {
    payload.leaguePaymentDefaults = updates.leaguePaymentDefaults;
  }

  if (updates.mercadoPagoConfig && typeof updates.mercadoPagoConfig === "object") {
    payload.mercadoPagoConfig = {
      enabled: updates.mercadoPagoConfig.enabled === true,
      accountLinked: updates.mercadoPagoConfig.accountLinked === true,
      autoEnableNewPayments: updates.mercadoPagoConfig.autoEnableNewPayments === true,
      accountDisplayName: String(updates.mercadoPagoConfig.accountDisplayName || "").trim(),
      connectionStatus:
        String(updates.mercadoPagoConfig.connectionStatus || "checkout_pro_test").trim() ||
        "checkout_pro_test",
      categories: {
        turnos: updates.mercadoPagoConfig?.categories?.turnos !== false,
        ligas: updates.mercadoPagoConfig?.categories?.ligas !== false,
        torneos: updates.mercadoPagoConfig?.categories?.torneos !== false,
      },
    };
  }

  if (updates.tournamentFixtureDefaults && typeof updates.tournamentFixtureDefaults === "object") {
    payload.tournamentFixtureDefaults = updates.tournamentFixtureDefaults;
  }

  if (typeof updates.fechaNacimiento === "string" && updates.fechaNacimiento) {
    payload.fechaNacimiento = updates.fechaNacimiento;
    payload.chatHabilitado = (calcularEdad(updates.fechaNacimiento) ?? 0) >= 14;
  }

  if (Array.isArray(updates.tournamentComplexes)) {
    payload.tournamentComplexes = updates.tournamentComplexes.map(normalizeComplex);
  }

  const localidadFromUpdates =
    normalizeLocalidadPayload(updates.localidad) ||
    normalizeLocalidadPayload({
      nombre: updates.city,
      provincia: updates.province,
      pais: updates.country,
    });

  if (localidadFromUpdates) {
    payload.localidad = localidadFromUpdates;
    payload.location = buildLocation(
      localidadFromUpdates.nombre,
      localidadFromUpdates.provincia,
      localidadFromUpdates.pais
    );
  }

  if (typeof updates.avatarUrl === "string" && updates.avatarUrl) {
    if (updates.avatarUrl.startsWith("file:")) {
      devLog("[userService] Detectada imagen local para subir");
      payload.fotoURL = await uploadProfileImage(uid, updates.avatarUrl);
    } else if (updates.avatarUrl.startsWith("gs://")) {
      devLog("[userService] Detectada URL gs://, convirtiendo a download URL");
      payload.fotoURL = await getProfileImageDownloadUrl(uid);
    } else {
      devLog("[userService] Usando URL remota existente para avatar");
      payload.fotoURL = updates.avatarUrl;
    }
  }

  if (typeof updates.organizerLogoUrl === "string") {
    if (!updates.organizerLogoUrl.trim()) {
      payload.organizerLogoURL = "";
    } else if (updates.organizerLogoUrl.startsWith("file:")) {
      payload.organizerLogoURL = await uploadOrganizerLogo(uid, updates.organizerLogoUrl);
    } else {
      payload.organizerLogoURL = updates.organizerLogoUrl;
    }
  }

  devLog("[userService] Actualizando perfil de usuario");
  await updateDoc(userRef, payload);

  const profile = await getUserProfile(uid, updates.email || "");

  return profile;
}

export async function listUserBrandingProfiles() {
  const activeDb = await ensureDb();

  if (!activeDb) {
    throw new Error("Firestore no esta disponible en este momento.");
  }

  const snapshot = await getDocs(collection(activeDb, "users"));

  return snapshot.docs
    .filter((docSnapshot) => docSnapshot.exists())
    .map((docSnapshot) => ({
      uid: docSnapshot.id,
      organizerLogoUrl: docSnapshot.data()?.organizerLogoURL || "",
    }));
}

