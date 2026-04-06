import { collection, getDocs } from "firebase/firestore";

import { db } from "../../services/firebaseConfig";
import { getProfileImageUri } from "../utils/defaultProfileImage";
import {
  buildAvailabilityFromLegacy,
  getAvailabilityHeadline,
  isAvailableToday,
  normalizeAvailability,
} from "./availabilityService";

function formatSide(value = "ambos") {
  if (value === "drive") {
    return "Drive";
  }

  if (value === "reves") {
    return "Reves";
  }

  return "Ambos lados";
}

function formatSex(value = "") {
  const normalized = String(value).trim().toLowerCase();

  if (normalized === "prefiero no decirlo") {
    return "Prefiero no decirlo";
  }

  if (normalized === "femenino" || normalized === "dama") {
    return "Femenino";
  }

  return "Masculino";
}

function formatDominantHand(value = "") {
  const normalized = String(value).trim().toLowerCase();

  if (normalized === "izquierda") {
    return "Izquierda";
  }

  if (normalized === "derecha") {
    return "Derecha";
  }

  return "No especificada";
}

function shouldIncludePlayerDoc(data = {}) {
  if (Boolean(data.accountDeleted)) {
    return false;
  }

  const role = String(data.role || "user").trim().toLowerCase();
  const organizerStatus = String(data.organizerStatus || "none").trim().toLowerCase();

  if (organizerStatus === "rejected") {
    return false;
  }

  return role !== "blocked" && role !== "deleted";
}

export function mapUserDocToPlayer(docSnapshot) {
  const data = docSnapshot.data() || {};
  const localidad = data.localidad || {};
  const location = data.location || {};
  const phone = String(data.telefono || "").trim();
  const countryCode = String(data.countryCode || "+54").trim();
  const isPhonePublic = Boolean(data.mostrarTelefono);
  const availability = data.availability
    ? normalizeAvailability(data.availability)
    : buildAvailabilityFromLegacy(data.disponibilidadDias, data.disponibilidadHoraria);

  return {
    id: docSnapshot.id,
    nombre: data.nombre || "Jugador",
    categoria: data.categoria || "Iniciante",
    sexo: formatSex(data.sexo),
    ciudad: localidad.nombre || location.ciudad || "Buenos Aires",
    provincia: localidad.provincia || location.provincia || "Buenos Aires",
    disponibilidad: data.disponibilidad || getAvailabilityHeadline(availability),
    disponibleHoy: Boolean(data.disponibleHoy) || isAvailableToday(availability),
    manoHabil: formatDominantHand(data.manoHabil),
    ladoPreferido: formatSide(data.ladoJuego),
    descripcion: data.descripcion || "Perfil en crecimiento dentro de PadelNexo.",
    foto: getProfileImageUri(data.fotoURL),
    phone: phone,
    countryCode,
    phoneCountry: String(data.phoneCountry || "Argentina").trim(),
    isPhonePublic,
    availability,
    esFavorito: Boolean(data.esFavorito),
  };
}

export async function listPlayers() {
  const snapshot = await getDocs(collection(db, "users"));

  return snapshot.docs
    .filter((docSnapshot) => docSnapshot.exists() && shouldIncludePlayerDoc(docSnapshot.data()))
    .map(mapUserDocToPlayer);
}
