const { onRequest } = require("firebase-functions/v2/https");

const { applyCors, getDb, handlePreflight, logger } = require("./mercadoPagoShared");

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

// Mismo criterio de agrupado que lib/tournamentRanking.ts (web) y
// tournamentRankingService.js (app): suma por jugador dentro del rango de
// fechas, agrupado por categoria, con empate compartiendo puesto.
function buildOrganizerRanking(entries, config) {
  const fromMillis = Number(config?.fromMillis || 0);
  const toMillis = Number(config?.toMillis || 0) > 0 ? Number(config.toMillis) : Date.now();

  const filtered = entries.filter((entry) => {
    const entryDate = Number(entry.startDateMillis || entry.endDateMillis || 0);
    return entryDate >= fromMillis && entryDate <= toMillis;
  });

  const bucketsByCategory = new Map();

  filtered.forEach((entry) => {
    const category = entry.category || "General";
    const bucket = bucketsByCategory.get(category) || new Map();

    (entry.players || []).forEach((player) => {
      const existing = bucket.get(player.key);
      bucket.set(player.key, {
        key: player.key,
        name: player.name,
        points: (existing?.points || 0) + player.points,
      });
    });

    bucketsByCategory.set(category, bucket);
  });

  const categories = Array.from(bucketsByCategory.keys()).sort((a, b) => a.localeCompare(b, "es"));
  const rankingsByCategory = {};

  categories.forEach((category) => {
    const rows = Array.from(bucketsByCategory.get(category).values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name, "es");
    });

    let lastPoints = null;
    let lastRank = 0;

    rankingsByCategory[category] = rows.map((row, index) => {
      if (row.points !== lastPoints) {
        lastRank = index + 1;
        lastPoints = row.points;
      }

      return { ...row, rank: lastRank };
    });
  });

  return { categories, rankingsByCategory };
}

const getPublicOrganizerRanking = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const organizerId = normalizeString(req.query?.organizerId);

    if (!organizerId) {
      res.status(400).json({ error: "organizerId is required" });
      return;
    }

    const db = getDb();
    const [organizerSnapshot, entriesSnapshot] = await Promise.all([
      db.collection("users").doc(organizerId).get(),
      db.collection("tournamentRankingEntries").where("organizerId", "==", organizerId).get(),
    ]);

    if (!organizerSnapshot.exists) {
      res.status(404).json({ error: "No encontramos al organizador." });
      return;
    }

    const organizerData = organizerSnapshot.data() || {};
    const entries = entriesSnapshot.docs.map((docSnapshot) => docSnapshot.data());
    const config = organizerData.tournamentRankingConfig || { fromMillis: 0, toMillis: 0 };
    const { categories, rankingsByCategory } = buildOrganizerRanking(entries, config);

    res.status(200).json({
      organizerId,
      organizerName: normalizeString(organizerData.name),
      organizerLogoUrl: normalizeString(organizerData.organizerLogoUrl),
      venueName: normalizeString(organizerData.complejos?.[0]?.nombre),
      categories,
      rankingsByCategory,
    });
  } catch (error) {
    logger.error("getPublicOrganizerRanking failed", error);
    res.status(500).json({ error: "No pudimos cargar el ranking." });
  }
});

module.exports = { getPublicOrganizerRanking };
