import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { ADMIN_ROLE, ORGANIZER_STATUS, USER_ROLE } from "./roleService";

function normalizeDate(value) {
  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
}

function mapAdminUser(docSnapshot) {
  const data = docSnapshot.data() || {};
  const localidad = data.localidad || {};
  const location = data.location || {};

  return {
    id: docSnapshot.id,
    uid: docSnapshot.id,
    name: data.nombre || data.name || "Usuario",
    email: data.email || "",
    phone: data.telefono || data.phone || "",
    avatarUrl: data.fotoURL || data.avatarUrl || "",
    avatarColor: data.avatarColor || "#0F8B5F",
    organizerLogoUrl: data.organizerLogoURL || data.organizerLogoUrl || "",
    category: data.categoria || data.category || "",
    sex: data.sexo || data.sex || "",
    side: data.ladoJuego || data.side || "",
    hand: data.manoHabil || data.hand || "",
    description: data.descripcion || data.description || "",
    city: localidad.nombre || location.ciudad || data.city || "",
    province: localidad.provincia || location.provincia || data.province || "",
    country: localidad.pais || location.pais || data.country || "Argentina",
    role: data.role || USER_ROLE,
    organizerStatus: data.organizerStatus || ORGANIZER_STATUS.NONE,
    adminStatus: data.adminStatus || "none",
    accountDeleted: Boolean(data.accountDeleted),
    blockStatus: data.blockStatus || "none",
    blockedAtMillis: resolveTimestampMillis(data.blockedAt),
    blockedUntilMillis: Number(data.blockedUntilMillis || 0),
    blockReason: data.blockReason || "",
    createdAt: normalizeDate(data.createdAt),
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    lastLoginAt: normalizeDate(data.lastLoginAt),
    lastLoginAtMillis: resolveTimestampMillis(data.lastLoginAt),
    updatedAt: normalizeDate(data.updatedAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
  };
}

function resolveTimestampMillis(value) {
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

function mapAdminLeague(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    type: "league",
    title: data.nombre || data.name || "Liga",
    organizerId: data.organizerId || data.createdBy || "",
    organizerName: data.organizerName || data.createdByName || "Organizador",
    status: data.status || "active",
    venue: data.complejoNombre || data.complexName || data.complejo?.nombre || "",
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
  };
}

function mapAdminTournament(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    type: "tournament",
    title: data.name || data.nombre || "Torneo",
    organizerId: data.organizerId || data.createdBy || "",
    organizerName: data.organizerName || data.createdByName || "Organizador",
    status: data.status || "draft",
    venue: Array.isArray(data.venues) && data.venues[0]?.name ? data.venues[0].name : "",
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
  };
}

export async function listAdminUsers() {
  const snapshot = await getDocs(collection(db, "users"));

  return snapshot.docs
    .map(mapAdminUser)
    .sort((first, second) => {
      const firstTime = first.createdAt instanceof Date ? first.createdAt.getTime() : 0;
      const secondTime = second.createdAt instanceof Date ? second.createdAt.getTime() : 0;

      return secondTime - firstTime;
    });
}

export async function listAdminContent() {
  const [leaguesSnapshot, tournamentsSnapshot] = await Promise.all([
    getDocs(collection(db, "leagues")),
    getDocs(collection(db, "tournaments")),
  ]);

  return [
    ...leaguesSnapshot.docs.map(mapAdminLeague),
    ...tournamentsSnapshot.docs.map(mapAdminTournament),
  ].sort((first, second) => {
    const firstTime = first.updatedAtMillis || first.createdAtMillis || 0;
    const secondTime = second.updatedAtMillis || second.createdAtMillis || 0;

    return secondTime - firstTime;
  });
}

export async function archiveLeagueAsAdmin(leagueId) {
  if (!leagueId) {
    return;
  }

  await updateDoc(doc(db, "leagues", leagueId), {
    status: "archived",
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function restoreLeagueAsAdmin(leagueId) {
  if (!leagueId) {
    return;
  }

  await updateDoc(doc(db, "leagues", leagueId), {
    status: "active",
    restoredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function cancelTournamentAsAdmin(tournamentId) {
  if (!tournamentId) {
    return;
  }

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: "cancelled",
    registrationStatus: "closed",
    cancellationReason: "Accion administrativa",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function restoreTournamentAsAdmin(tournamentId) {
  if (!tournamentId) {
    return;
  }

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: "published",
    restoredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function grantAdminAccess(userId) {
  if (!userId) {
    return;
  }

  await updateDoc(doc(db, "users", userId), {
    adminStatus: "active",
    updatedAt: serverTimestamp(),
  });
}

export async function revokeAdminAccess(userId, currentRole = "") {
  if (!userId) {
    return;
  }

  const payload = {
    adminStatus: "revoked",
    updatedAt: serverTimestamp(),
  };

  if (currentRole === ADMIN_ROLE) {
    payload.role = USER_ROLE;
  }

  await updateDoc(doc(db, "users", userId), payload);
}

export async function revokeOrganizerAccess(userId) {
  if (!userId) {
    return;
  }

  await updateDoc(doc(db, "users", userId), {
    role: USER_ROLE,
    organizerStatus: ORGANIZER_STATUS.REJECTED,
    updatedAt: serverTimestamp(),
  });
}

export async function blockUserAccount(userId, mode = "indefinite", currentProfile = {}) {
  if (!userId) {
    return;
  }

  const isTemporary = mode === "temporary_7_days";
  const blockedUntilMillis = isTemporary ? Date.now() + 1000 * 60 * 60 * 24 * 7 : 0;
  const payload = {
    adminStatus: "revoked",
    accountDeleted: false,
    blockStatus: isTemporary ? "temporary" : "indefinite",
    blockedAt: serverTimestamp(),
    blockedUntilMillis,
    blockReason: isTemporary
      ? "Bloqueo temporal por acciones impropias"
      : "Bloqueo indefinido por acciones impropias",
    preBlockRole:
      currentProfile.role && currentProfile.role !== "blocked" ? currentProfile.role : USER_ROLE,
    preBlockOrganizerStatus: currentProfile.organizerStatus || ORGANIZER_STATUS.NONE,
    updatedAt: serverTimestamp(),
  };

  if (!isTemporary) {
    payload.role = "blocked";
  }

  await updateDoc(doc(db, "users", userId), payload);
}

export async function restoreUserAccount(userId) {
  if (!userId) {
    return;
  }

  const userRef = doc(db, "users", userId);
  const snapshot = await getDoc(userRef);
  const data = snapshot.exists() ? snapshot.data() || {} : {};

  await updateDoc(userRef, {
    accountDeleted: false,
    blockStatus: "none",
    blockedUntilMillis: 0,
    blockReason: "",
    preBlockRole: "",
    preBlockOrganizerStatus: "",
    role: data.preBlockRole || (data.role === "blocked" ? USER_ROLE : data.role || USER_ROLE),
    organizerStatus:
      data.preBlockOrganizerStatus || data.organizerStatus || ORGANIZER_STATUS.NONE,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserProfileAsAdmin(userId, updates = {}) {
  if (!userId) {
    throw new Error("No encontramos el usuario que queres editar.");
  }

  const city = String(updates.city || "").trim();
  const province = String(updates.province || "").trim();
  const country = String(updates.country || "Argentina").trim() || "Argentina";

  await updateDoc(doc(db, "users", userId), {
    nombre: String(updates.name || "").trim(),
    telefono: String(updates.phone || "").trim(),
    categoria: String(updates.category || "").trim(),
    sexo: String(updates.sex || "").trim(),
    ladoJuego: String(updates.side || "").trim(),
    manoHabil: String(updates.hand || "").trim(),
    descripcion: String(updates.description || "").trim(),
    localidad: {
      nombre: city,
      provincia: province,
      pais: country,
    },
    location: {
      ciudad: city,
      provincia: province,
      pais: country,
    },
    updatedAt: serverTimestamp(),
  });
}
