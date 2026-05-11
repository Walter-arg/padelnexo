import { getQuickSlotDefinitions } from "./availabilityService";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOURNAMENT_DAYS = 45;

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeStartOfDayMillis(value) {
  const date = new Date(Number(value || 0));

  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(dayKey = "") {
  const value = String(dayKey || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map((item) => Number.parseInt(item, 10));
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function parseTimeToMinutes(value = "") {
  const [hour = "0", minute = "0"] = String(value).split(":");
  return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
}

function normalizeCustomSlot(slot = {}) {
  const from = String(slot.from || "").trim();
  const to = String(slot.to || "").trim();

  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from === to) {
    return null;
  }

  return { from, to };
}

function dedupeCustomSlots(slots = []) {
  const uniqueMap = new Map();

  slots.forEach((slot) => {
    const normalizedSlot = normalizeCustomSlot(slot);

    if (!normalizedSlot) {
      return;
    }

    uniqueMap.set(`${normalizedSlot.from}-${normalizedSlot.to}`, normalizedSlot);
  });

  return [...uniqueMap.values()].sort(
    (first, second) => parseTimeToMinutes(first.from) - parseTimeToMinutes(second.from)
  );
}

export function buildTournamentDayOptions(tournament = {}) {
  const startDateMillis = normalizeStartOfDayMillis(tournament?.startDateMillis);
  const fallbackEndDateMillis = startDateMillis || 0;
  const endDateMillis = normalizeStartOfDayMillis(
    tournament?.endDateMillis || fallbackEndDateMillis
  );

  if (!startDateMillis || !endDateMillis || endDateMillis < startDateMillis) {
    return [];
  }

  const totalDays = Math.min(
    Math.floor((endDateMillis - startDateMillis) / ONE_DAY_MS) + 1,
    MAX_TOURNAMENT_DAYS
  );

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(startDateMillis + index * ONE_DAY_MS);
    const key = formatDateKey(date);
    const dayLabel = date.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    });
    const shortLabel = date.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
    });
    const chipLabel = date.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });

    return {
      key,
      label: chipLabel.replace(".", ""),
      shortLabel,
      fullLabel: dayLabel,
    };
  });
}

export function createEmptyTournamentAvailability(dayOptions = []) {
  return (Array.isArray(dayOptions) ? dayOptions : []).reduce((accumulator, day) => {
    if (day?.key) {
      accumulator[day.key] = {
        quickSlots: [],
        customSlots: [],
      };
    }

    return accumulator;
  }, {});
}

export function normalizeTournamentAvailability(rawAvailability = {}, dayOptions = []) {
  const safeDayOptions = Array.isArray(dayOptions) ? dayOptions : [];
  const allowedDayKeys = new Set(safeDayOptions.map((day) => day.key).filter(Boolean));
  const validQuickSlotKeys = new Set(getQuickSlotDefinitions().map((slot) => slot.key));
  const base = createEmptyTournamentAvailability(safeDayOptions);

  safeDayOptions.forEach((day) => {
    const dayValue = rawAvailability?.[day.key] || {};

    base[day.key] = {
      quickSlots: uniqueStrings(dayValue.quickSlots || []).filter((slotKey) =>
        validQuickSlotKeys.has(slotKey)
      ),
      customSlots: dedupeCustomSlots(dayValue.customSlots),
    };
  });

  return Object.entries(base).reduce((accumulator, [dayKey, dayValue]) => {
    if (!allowedDayKeys.has(dayKey)) {
      return accumulator;
    }

    if (!dayValue.quickSlots.length && !dayValue.customSlots.length) {
      return accumulator;
    }

    accumulator[dayKey] = dayValue;
    return accumulator;
  }, {});
}

export function toggleTournamentQuickSlot(availability = {}, dayKey, slotKey, dayOptions = []) {
  const nextAvailability = normalizeTournamentAvailability(availability, dayOptions);
  const currentDay = nextAvailability[dayKey] || { quickSlots: [], customSlots: [] };

  nextAvailability[dayKey] = {
    ...currentDay,
    quickSlots: currentDay.quickSlots.includes(slotKey)
      ? currentDay.quickSlots.filter((currentSlot) => currentSlot !== slotKey)
      : [...currentDay.quickSlots, slotKey],
  };

  return normalizeTournamentAvailability(nextAvailability, dayOptions);
}

export function addTournamentCustomSlot(availability = {}, dayKey, slot, dayOptions = []) {
  const nextAvailability = normalizeTournamentAvailability(availability, dayOptions);
  const currentDay = nextAvailability[dayKey] || { quickSlots: [], customSlots: [] };

  nextAvailability[dayKey] = {
    ...currentDay,
    customSlots: dedupeCustomSlots([...currentDay.customSlots, slot]),
  };

  return normalizeTournamentAvailability(nextAvailability, dayOptions);
}

export function removeTournamentCustomSlot(
  availability = {},
  dayKey,
  targetIndex,
  dayOptions = []
) {
  const nextAvailability = normalizeTournamentAvailability(availability, dayOptions);
  const currentDay = nextAvailability[dayKey] || { quickSlots: [], customSlots: [] };

  nextAvailability[dayKey] = {
    ...currentDay,
    customSlots: currentDay.customSlots.filter((_, index) => index !== targetIndex),
  };

  return normalizeTournamentAvailability(nextAvailability, dayOptions);
}

export function clearTournamentDayAvailability(availability = {}, dayKey, dayOptions = []) {
  const nextAvailability = normalizeTournamentAvailability(availability, dayOptions);
  delete nextAvailability[dayKey];
  return normalizeTournamentAvailability(nextAvailability, dayOptions);
}

export function getTournamentDayLabel(dayKey = "", dayOptions = [], format = "full") {
  const dayOption = (Array.isArray(dayOptions) ? dayOptions : []).find((day) => day.key === dayKey);

  if (dayOption) {
    if (format === "short") {
      return dayOption.shortLabel || dayOption.label || dayOption.fullLabel || dayKey;
    }

    if (format === "chip") {
      return dayOption.label || dayOption.shortLabel || dayOption.fullLabel || dayKey;
    }

    return dayOption.fullLabel || dayOption.label || dayOption.shortLabel || dayKey;
  }

  const date = parseDateKey(dayKey);

  if (!date) {
    return dayKey;
  }

  if (format === "short") {
    return date.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
    });
  }

  if (format === "chip") {
    return date
      .toLocaleDateString("es-AR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      })
      .replace(".", "");
  }

  return date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}

export function getTournamentAvailabilitySummaryItems(availability = {}, dayOptions = []) {
  const normalized = normalizeTournamentAvailability(availability, dayOptions);
  const quickSlotLabelByKey = getQuickSlotDefinitions().reduce((accumulator, slot) => {
    accumulator[slot.key] = slot.label;
    return accumulator;
  }, {});

  return Object.keys(normalized).map((dayKey) => {
    const dayValue = normalized[dayKey] || {};
    const quickLabels = uniqueStrings(dayValue.quickSlots || [])
      .map((slotKey) => quickSlotLabelByKey[slotKey])
      .filter(Boolean);
    const customLabels = (dayValue.customSlots || []).map((slot) => `${slot.from} a ${slot.to}`);
    const text = [...quickLabels, ...customLabels].join(" y ");

    return {
      key: dayKey,
      dayLabel: getTournamentDayLabel(dayKey, dayOptions, "full"),
      dayShortLabel: getTournamentDayLabel(dayKey, dayOptions, "short"),
      label: `${getTournamentDayLabel(dayKey, dayOptions, "chip")} · ${text}`,
      text,
    };
  });
}

export function formatTournamentAvailabilitySummary(availability = {}, dayOptions = []) {
  const summaryItems = getTournamentAvailabilitySummaryItems(availability, dayOptions);

  if (!summaryItems.length) {
    return "Sin disponibilidad cargada";
  }

  return summaryItems.map((item) => `${item.dayLabel}: ${item.text}`).join(" · ");
}
