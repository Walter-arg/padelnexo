import { collection, getDocs } from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { callAdminAction } from "./adminActionsClient";

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
  // El email y el telefono real viven en users/{uid}/private/contact (solo
  // legible por el dueño), asi que el panel de admin los pide via Cloud
  // Function en vez de leer Firestore directo.
  const { users } = await callAdminAction("listAdminUsersData");

  return (Array.isArray(users) ? users : []).sort(
    (first, second) => (second.createdAtMillis || 0) - (first.createdAtMillis || 0)
  );
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

  await callAdminAction("archiveLeagueAsAdmin", { leagueId });
}

export async function restoreLeagueAsAdmin(leagueId) {
  if (!leagueId) {
    return;
  }

  await callAdminAction("restoreLeagueAsAdmin", { leagueId });
}

export async function cancelTournamentAsAdmin(tournamentId) {
  if (!tournamentId) {
    return;
  }

  await callAdminAction("cancelTournamentAsAdmin", { tournamentId });
}

export async function restoreTournamentAsAdmin(tournamentId) {
  if (!tournamentId) {
    return;
  }

  await callAdminAction("restoreTournamentAsAdmin", { tournamentId });
}

export async function grantAdminAccess(userId) {
  if (!userId) {
    return;
  }

  await callAdminAction("grantAdminAccess", { userId });
}

export async function revokeAdminAccess(userId, currentRole = "") {
  if (!userId) {
    return;
  }

  await callAdminAction("revokeAdminAccess", { userId, currentRole });
}

export async function revokeOrganizerAccess(userId) {
  if (!userId) {
    return;
  }

  await callAdminAction("revokeOrganizerAccess", { userId });
}

export async function blockUserAccount(userId, mode = "indefinite") {
  if (!userId) {
    return;
  }

  await callAdminAction("blockUserAccount", { userId, mode });
}

export async function restoreUserAccount(userId) {
  if (!userId) {
    return;
  }

  await callAdminAction("restoreUserAccount", { userId });
}

export async function assignOrganizerPlan(userId, plan, trialDays = 0) {
  if (!userId || !plan) return;

  await callAdminAction("assignOrganizerPlan", { userId, plan, trialDays: Number(trialDays) });
}

export async function revokeOrganizerPlan(userId) {
  if (!userId) return;

  await callAdminAction("revokeOrganizerPlan", { userId });
}

// Temporal: correr una sola vez para migrar email/telefono de los usuarios
// existentes al subdocumento privado (Paso 3 de privacidad). Sacar este
// export y el boton del panel de admin despues de usarlo.
export async function migrateUserContactData() {
  return callAdminAction("migrateUserContactData");
}

export async function updateUserProfileAsAdmin(userId, updates = {}) {
  if (!userId) {
    throw new Error("No encontramos el usuario que queres editar.");
  }

  await callAdminAction("updateUserProfileAsAdmin", { userId, updates });
}
