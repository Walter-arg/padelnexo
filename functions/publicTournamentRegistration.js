const { onRequest } = require("firebase-functions/v2/https");

const { admin, applyCors, getDb, handlePreflight, logger } = require("./mercadoPagoShared");

const OPEN_STATUSES = new Set(["published", "registration_open"]);
const QUICK_SLOT_KEYS = new Set(["morning", "afternoon", "night", "late_night"]);
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function buildDayKeySet(startDateMillis, endDateMillis) {
  const start = Number(startDateMillis || 0);
  const end = Number(endDateMillis || start);
  const keys = new Set();

  if (!start || !end || end < start) {
    return keys;
  }

  const totalDays = Math.min(Math.floor((end - start) / ONE_DAY_MS) + 1, 45);

  for (let index = 0; index < totalDays; index += 1) {
    const date = new Date(start + index * ONE_DAY_MS);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;
    keys.add(key);
  }

  return keys;
}

function normalizeCustomSlot(slot = {}) {
  const from = normalizeString(slot?.from);
  const to = normalizeString(slot?.to);

  if (!TIME_PATTERN.test(from) || !TIME_PATTERN.test(to) || from === to) {
    return null;
  }

  return { from, to };
}

function normalizePublicAvailability(rawAvailability = {}, validDayKeys = new Set()) {
  if (!rawAvailability || typeof rawAvailability !== "object") {
    return {};
  }

  return Object.entries(rawAvailability).reduce((accumulator, [dayKey, dayValue]) => {
    if (!DAY_KEY_PATTERN.test(dayKey) || !validDayKeys.has(dayKey)) {
      return accumulator;
    }

    const quickSlots = Array.isArray(dayValue?.quickSlots)
      ? [...new Set(dayValue.quickSlots.filter((slot) => QUICK_SLOT_KEYS.has(slot)))]
      : [];
    const customSlots = Array.isArray(dayValue?.customSlots)
      ? dayValue.customSlots.map(normalizeCustomSlot).filter(Boolean)
      : [];

    if (!quickSlots.length && !customSlots.length) {
      return accumulator;
    }

    accumulator[dayKey] = { quickSlots, customSlots };
    return accumulator;
  }, {});
}

function buildPublicPaymentEntry(playerId, playerName, entryFee) {
  const amount = Number(entryFee || 0);

  return {
    playerId,
    userId: "",
    playerName,
    amount,
    status: amount > 0 ? "pending" : "approved",
    method: "",
    receiptUrl: "",
    receiptPath: "",
    receiptFileName: "",
    uploadedAt: null,
    reviewedAt: null,
    reviewedBy: "",
    reviewedByName: "",
  };
}

function isRegistrationWithdrawnConfirmed(registration = {}) {
  return String(registration?.withdrawalStatus || "") === "confirmed";
}

async function listActiveRegistrations(db, tournamentId) {
  const snapshot = await db.collection("tournaments").doc(tournamentId).collection("registrations").get();

  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .filter((registration) => registration.status !== "rejected" && !isRegistrationWithdrawnConfirmed(registration));
}

async function listBatchCategories(db, tournament) {
  const batchId = normalizeString(tournament.creationBatchId);

  if (!batchId) {
    return [];
  }

  const snapshot = await db.collection("tournaments").where("creationBatchId", "==", batchId).get();

  return snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() || {};
      return {
        id: docSnapshot.id,
        label: normalizeString(data.compositionConfig?.label || data.compositionLabel, "Categoria"),
        createdAtMillis: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0,
      };
    })
    .sort((a, b) => a.createdAtMillis - b.createdAtMillis)
    .map(({ id, label }) => ({ id, label }));
}

async function resolveOrganizerLogoUrl(db, tournament) {
  const directLogoUrl = normalizeString(tournament.organizerLogoUrl);

  if (directLogoUrl) {
    return directLogoUrl;
  }

  const organizerId = normalizeString(tournament.organizerId || tournament.createdBy);

  if (!organizerId) {
    return "";
  }

  const organizerSnapshot = await db.collection("users").doc(organizerId).get();
  const organizerData = organizerSnapshot.exists ? organizerSnapshot.data() || {} : {};

  return normalizeString(organizerData.organizerLogoUrl);
}

function buildPublicTournamentInfo(tournamentId, tournament, activeCount, organizerLogoUrl, categories = []) {
  const maxPairs = Number(tournament.maxPairs || 0);
  const isOpenStatus = OPEN_STATUSES.has(String(tournament.status || ""));
  const isFull = maxPairs > 0 && activeCount >= maxPairs;
  const composition = tournament.compositionConfig || {};

  return {
    id: tournamentId,
    name: normalizeString(tournament.name, "Torneo"),
    baseName: normalizeString(tournament.baseName || tournament.name, "Torneo"),
    categories,
    startDateMillis: Number(tournament.startDateMillis || 0),
    endDateMillis: Number(tournament.endDateMillis || 0),
    compositionLabel: normalizeString(tournament.compositionConfig?.label || tournament.compositionLabel),
    categoryFormat: normalizeString(composition.categoryFormat, "libre"),
    sumRule: normalizeString(composition.sumRule),
    sumTarget: Number(composition.sumTarget || 0),
    fixedCategoryA: normalizeString(composition.fixedCategoryA),
    fixedCategoryB: normalizeString(composition.fixedCategoryB),
    availabilityRequired: Boolean(tournament.availabilityRequired),
    entryFee: Number(tournament.entryFee || 0),
    maxPairs,
    registeredCount: activeCount,
    organizerName: normalizeString(tournament.organizerName),
    venueName: normalizeString(
      Array.isArray(tournament.venues) && tournament.venues[0]
        ? tournament.venues[0].name
        : tournament.complejo?.nombre
    ),
    coverImage: normalizeString(tournament.coverImage),
    organizerLogoUrl: normalizeString(organizerLogoUrl),
    rules: String(tournament.rules || ""),
    status: tournament.status || "draft",
    open: isOpenStatus && !isFull,
    reason: !isOpenStatus ? "closed" : isFull ? "full" : "",
  };
}

const getPublicTournamentInfo = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const tournamentId = normalizeString(req.query?.tournamentId);

    if (!tournamentId) {
      res.status(400).json({ error: "tournamentId is required" });
      return;
    }

    const db = getDb();
    const tournamentSnapshot = await db.collection("tournaments").doc(tournamentId).get();

    if (!tournamentSnapshot.exists) {
      res.status(404).json({ error: "No encontramos el torneo." });
      return;
    }

    const tournament = tournamentSnapshot.data() || {};
    const [activeRegistrations, organizerLogoUrl, categories] = await Promise.all([
      listActiveRegistrations(db, tournamentId),
      resolveOrganizerLogoUrl(db, tournament),
      listBatchCategories(db, tournament),
    ]);

    res
      .status(200)
      .json(
        buildPublicTournamentInfo(
          tournamentId,
          tournament,
          activeRegistrations.length,
          organizerLogoUrl,
          categories
        )
      );
  } catch (error) {
    logger.error("getPublicTournamentInfo failed", error);
    res.status(500).json({ error: "No pudimos cargar el torneo." });
  }
});

const submitPublicTournamentRegistration = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const payload = req.body || {};
    const tournamentId = normalizeString(payload.tournamentId);
    const player1Name = normalizeString(payload.player1Name);
    const player2Name = normalizeString(payload.player2Name);
    const player1Category = normalizeString(payload.player1Category).slice(0, 20);
    const player2Category = normalizeString(payload.player2Category).slice(0, 20);
    const contactPhone = normalizeString(payload.contactPhone).slice(0, 40);
    const notes = normalizeString(payload.notes).slice(0, 500);

    if (!tournamentId || !player1Name || !player2Name) {
      res.status(400).json({ error: "tournamentId, player1Name y player2Name son obligatorios." });
      return;
    }

    const db = getDb();
    const tournamentRef = db.collection("tournaments").doc(tournamentId);
    const tournamentSnapshot = await tournamentRef.get();

    if (!tournamentSnapshot.exists) {
      res.status(404).json({ error: "No encontramos el torneo." });
      return;
    }

    const tournament = tournamentSnapshot.data() || {};

    if (!OPEN_STATUSES.has(String(tournament.status || ""))) {
      res.status(409).json({ error: "La inscripcion de este torneo no esta disponible." });
      return;
    }

    const activeRegistrations = await listActiveRegistrations(db, tournamentId);
    const maxPairs = Number(tournament.maxPairs || 0);

    if (maxPairs > 0 && activeRegistrations.length >= maxPairs) {
      res.status(409).json({ error: "El torneo ya alcanzo el cupo maximo de parejas." });
      return;
    }

    const pairLabel = `${player1Name} / ${player2Name}`;
    const normalizedPairLabel = pairLabel.trim().toLowerCase();
    const alreadySubmitted = activeRegistrations.some(
      (registration) => String(registration.pairLabel || "").trim().toLowerCase() === normalizedPairLabel
    );

    if (alreadySubmitted) {
      res.status(409).json({ error: "Esta pareja ya esta inscripta en este torneo." });
      return;
    }

    const validDayKeys = buildDayKeySet(tournament.startDateMillis, tournament.endDateMillis);
    const availability = normalizePublicAvailability(payload.availability, validDayKeys);

    if (tournament.availabilityRequired && Object.keys(availability).length === 0) {
      res.status(400).json({ error: "El organizador exige cargar al menos un horario antes de inscribirse." });
      return;
    }

    const entryFee = Number(tournament.entryFee || 0);
    const payments = [
      buildPublicPaymentEntry("player-1", player1Name, entryFee),
      buildPublicPaymentEntry("player-2", player2Name, entryFee),
    ];
    const pairConfirmationMode = normalizeString(tournament.pairConfirmationMode).toLowerCase();
    const registrationStatus =
      pairConfirmationMode === "none" || (entryFee <= 0 && pairConfirmationMode !== "manual")
        ? "confirmed"
        : "pending";

    const registrationPayload = {
      player1Id: "",
      player1Name,
      player1Category,
      player2Id: "",
      player2Name,
      player2Category,
      pairLabel,
      status: registrationStatus,
      availability,
      payments,
      contactPhone,
      notes,
      registrationSource: "public_link",
      groupId: "",
      groupPosition: 0,
      qualifiedToKnockout: false,
      withdrawalStatus: "none",
      withdrawalRequestedAt: null,
      withdrawalRequestedBy: "",
      withdrawalRequestedByName: "",
      withdrawalConfirmedAt: null,
      withdrawalConfirmedBy: "",
      withdrawalConfirmedByName: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      confirmedAt: registrationStatus === "confirmed" ? admin.firestore.FieldValue.serverTimestamp() : null,
      rejectedAt: null,
    };

    const createdRef = await tournamentRef.collection("registrations").add(registrationPayload);

    res.status(200).json({ id: createdRef.id });
  } catch (error) {
    logger.error("submitPublicTournamentRegistration failed", error);
    res.status(500).json({ error: "No pudimos registrar la inscripcion." });
  }
});

module.exports = {
  getPublicTournamentInfo,
  submitPublicTournamentRegistration,
};
