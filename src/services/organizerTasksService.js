import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { listLeagues, mapLeagueDoc } from "./leaguesService";
import { listTournamentRegistrations, listTournaments } from "./tournamentsService";
import { listOrganizerTurnoReservations } from "./turnosService";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isOrganizerItem(item = {}, organizerId = "") {
  const normalizedOrganizerId = normalizeText(organizerId);

  return Boolean(
    normalizedOrganizerId &&
      (normalizeText(item.organizerId) === normalizedOrganizerId ||
        normalizeText(item.createdBy) === normalizedOrganizerId)
  );
}

export function hasPendingReplacementRequest(league = {}) {
  return (league.fixture?.rounds || []).some((round) =>
    (round.matches || []).some((match) =>
      Object.values(match.replacements || {}).some(
        (replacement) => replacement?.requested && !replacement?.replacement
      )
    )
  );
}

export function countPendingReplacementRequests(leagues = [], organizerId = "") {
  return leagues.filter((league) => isOrganizerItem(league, organizerId)).reduce(
    (total, league) =>
      total +
      (league.fixture?.rounds || []).reduce(
        (roundTotal, round) =>
          roundTotal +
          (round.matches || []).reduce(
            (matchTotal, match) =>
              matchTotal +
              Object.values(match.replacements || {}).filter(
                (replacement) => replacement?.requested && !replacement?.replacement
              ).length,
            0
          ),
        0
      ),
    0
  );
}

export function isActionableLeagueRegistration(request = {}) {
  return request.status === "pending";
}

export function isActionableTournamentRegistration(registration = {}) {
  return (
    registration.withdrawalStatus === "requested" ||
    registration.status === "pending" ||
    registration.status === "in_review"
  );
}

export function isActionableTurnoReservation(reservation = {}) {
  return reservation.status === "pending_organizer_confirmation";
}

export function hasUnreadTurnoReservationNotification(reservation = {}) {
  return reservation.organizerNotificationUnread === true;
}

export function isPendingTurnoNotification(reservation = {}) {
  return (
    isActionableTurnoReservation(reservation) ||
    hasUnreadTurnoReservationNotification(reservation)
  );
}

function mapLeagueRegistrationRequest(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    leagueId: data.leagueId || "",
    leagueName: data.leagueName || "Liga",
    organizerId: data.organizerId || "",
    organizerName: data.organizerName || "Organizador",
    requester: data.requester || {},
    partner: data.partner || null,
    status: data.status || "pending",
    teamType: data.teamType || "pair",
    createdAtMillis: data.createdAtMillis || 0,
  };
}

function getUserPhone(profile = {}) {
  return String(profile.telefono || profile.phone || "").trim();
}

function getUserCountryCode(profile = {}) {
  return String(profile.countryCode || "+54").trim();
}

function getUserName(profile = {}) {
  return [profile.nombre || profile.name || "", profile.apellido || profile.lastName || ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function buildUsersById(userIds = []) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const entries = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const snapshot = await getDoc(doc(db, "users", userId));

      return snapshot.exists() ? [userId, { uid: userId, ...(snapshot.data() || {}) }] : null;
    })
  );

  return new Map(entries.filter(Boolean));
}

function enrichLeagueRequestWithUsers(request = {}, usersById = new Map()) {
  const requesterId = request.requester?.linkedUserId || request.requester?.id || "";
  const partnerId = request.partner?.linkedUserId || request.partner?.id || "";
  const requesterProfile = usersById.get(requesterId) || {};
  const partnerProfile = usersById.get(partnerId) || {};

  return {
    ...request,
    requester: {
      ...(request.requester || {}),
      countryCode: request.requester?.countryCode || getUserCountryCode(requesterProfile),
      phone: request.requester?.phone || request.requester?.telefono || getUserPhone(requesterProfile),
    },
    partner: request.partner
      ? {
          ...request.partner,
          countryCode: request.partner.countryCode || getUserCountryCode(partnerProfile),
          phone: request.partner.phone || request.partner.telefono || getUserPhone(partnerProfile),
        }
      : null,
  };
}

function enrichTournamentRegistrationWithUsers(registration = {}, usersById = new Map()) {
  const player1Profile = usersById.get(registration.player1Id) || {};
  const player2Profile = usersById.get(registration.player2Id) || {};

  return {
    ...registration,
    player1Name: registration.player1Name || getUserName(player1Profile),
    player1CountryCode: registration.player1CountryCode || getUserCountryCode(player1Profile),
    player1Phone: registration.player1Phone || getUserPhone(player1Profile),
    player2Name: registration.player2Name || getUserName(player2Profile),
    player2CountryCode: registration.player2CountryCode || getUserCountryCode(player2Profile),
    player2Phone: registration.player2Phone || getUserPhone(player2Profile),
  };
}

function enrichTurnoReservationWithUsers(reservation = {}, usersById = new Map()) {
  const playerProfile = usersById.get(reservation.playerId) || {};

  return {
    ...reservation,
    playerCountryCode: reservation.playerCountryCode || getUserCountryCode(playerProfile),
    playerName: reservation.playerName || getUserName(playerProfile) || "Jugador",
    playerPhone: reservation.playerPhone || getUserPhone(playerProfile),
  };
}

export async function getOrganizerRegistrationsSummary(organizerId = "") {
  if (!organizerId) {
    return {
      count: 0,
      leagueRequests: [],
      turnoReservations: [],
      tournamentRequests: [],
    };
  }

  const [leagues, tournaments, turnoReservations] = await Promise.all([
    listLeagues(),
    listTournaments(),
    listOrganizerTurnoReservations(organizerId),
  ]);
  const organizerLeagues = leagues.filter((league) => isOrganizerItem(league, organizerId));
  const organizerTournaments = tournaments.filter((tournament) =>
    isOrganizerItem(tournament, organizerId)
  );

  const leagueRequestsSnapshot = await getDocs(
    query(collection(db, "leagueRegistrationRequests"), where("organizerId", "==", organizerId))
  );
  const leagueById = new Map(organizerLeagues.map((league) => [league.id, league]));
  const leagueRequests = leagueRequestsSnapshot.docs
    .map(mapLeagueRegistrationRequest)
    .filter((request) => leagueById.has(request.leagueId))
    .map((request) => ({
      ...request,
      league: leagueById.get(request.leagueId),
      type: "league",
    }));

  const tournamentRequests = (
    await Promise.all(
      organizerTournaments.map(async (tournament) => {
        const registrations = await listTournamentRegistrations(tournament.id);

        return registrations.map((registration) => ({
          ...registration,
          tournament,
          type: "tournament",
        }));
      })
    )
  ).flat();

  const userIds = [
    ...leagueRequests.flatMap((request) => [
      request.requester?.linkedUserId || request.requester?.id,
      request.partner?.linkedUserId || request.partner?.id,
    ]),
    ...tournamentRequests.flatMap((registration) => [
      registration.player1Id,
      registration.player2Id,
    ]),
    ...turnoReservations.map((reservation) => reservation.playerId),
  ];
  const usersById = await buildUsersById(userIds);
  const enrichedLeagueRequests = leagueRequests.map((request) =>
    enrichLeagueRequestWithUsers(request, usersById)
  );
  const enrichedTournamentRequests = tournamentRequests.map((registration) =>
    enrichTournamentRegistrationWithUsers(registration, usersById)
  );
  const enrichedTurnoReservations = turnoReservations.map((reservation) =>
    enrichTurnoReservationWithUsers(reservation, usersById)
  );

  const turnoNotificationCount = enrichedTurnoReservations.filter(
    isPendingTurnoNotification
  ).length;

  const count =
    enrichedLeagueRequests.filter(isActionableLeagueRegistration).length +
    enrichedTournamentRequests.filter(isActionableTournamentRegistration).length +
    turnoNotificationCount;

  return {
    count,
    leagueRequests: enrichedLeagueRequests,
    turnoReservations: enrichedTurnoReservations,
    tournamentRequests: enrichedTournamentRequests,
  };
}

export function subscribeToOrganizerReplacementCount({
  organizerId = "",
  onData,
  onError,
} = {}) {
  if (!organizerId) {
    onData?.(0);
    return () => {};
  }

  return onSnapshot(
    collection(db, "leagues"),
    (snapshot) => {
      const leagues = snapshot.docs
        .filter((docSnapshot) => {
          if (!docSnapshot.exists()) {
            return false;
          }

          const status = normalizeText(docSnapshot.data()?.status || "active");
          return status !== "deleted" && status !== "archived";
        })
        .map(mapLeagueDoc);

      onData?.(countPendingReplacementRequests(leagues, organizerId));
    },
    onError
  );
}
