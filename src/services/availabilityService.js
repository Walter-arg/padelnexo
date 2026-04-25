const DAY_DEFINITIONS = [
  { key: "monday", label: "Lunes", shortLabel: "Lun" },
  { key: "tuesday", label: "Martes", shortLabel: "Mar" },
  { key: "wednesday", label: "Miércoles", shortLabel: "Mié" },
  { key: "thursday", label: "Jueves", shortLabel: "Jue" },
  { key: "friday", label: "Viernes", shortLabel: "Vie" },
  { key: "saturday", label: "Sábado", shortLabel: "Sáb" },
  { key: "sunday", label: "Domingo", shortLabel: "Dom" },
];

export const QUICK_SLOT_DEFINITIONS = [
  { key: "morning", label: "Mañana", from: "08:00", to: "12:00" },
  { key: "afternoon", label: "Tarde", from: "12:00", to: "18:00" },
  { key: "night", label: "Noche", from: "18:00", to: "23:00" },
  { key: "late_night", label: "Madrugada", from: "23:00", to: "02:00" },
];

function normalizeDayLabel(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const DAY_KEY_BY_LABEL = DAY_DEFINITIONS.reduce((accumulator, day) => {
  accumulator[normalizeDayLabel(day.label)] = day.key;
  return accumulator;
}, {});

const SLOT_BY_KEY = QUICK_SLOT_DEFINITIONS.reduce((accumulator, slot) => {
  accumulator[slot.key] = slot;
  return accumulator;
}, {});

const DAY_LABEL_OVERRIDES = {
  wednesday: "Mi\u00e9rcoles",
  saturday: "S\u00e1bado",
};

const DAY_SHORT_LABEL_OVERRIDES = {
  wednesday: "Mi\u00e9",
  saturday: "S\u00e1b",
};

const QUICK_SLOT_LABEL_OVERRIDES = {
  morning: "Ma\u00f1ana",
};

export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const totalMinutes = index * 30;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

function createEmptyDayAvailability() {
  return {
    quickSlots: [],
    customSlots: [],
  };
}

export function createEmptyAvailability() {
  return DAY_DEFINITIONS.reduce((accumulator, day) => {
    accumulator[day.key] = createEmptyDayAvailability();
    return accumulator;
  }, {});
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseTimeToMinutes(value = "") {
  const [hour = "0", minute = "0"] = String(value).split(":");
  return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
}

function normalizeCustomSlot(slot = {}) {
  const from = String(slot.from || "").trim();
  const to = String(slot.to || "").trim();

  if (!TIME_OPTIONS.includes(from) || !TIME_OPTIONS.includes(to)) {
    return null;
  }

  // Permitimos cruces de medianoche guardando el rango tal como lo eligio el usuario.
  if (from === to) {
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

export function normalizeAvailability(rawAvailability = {}) {
  const base = createEmptyAvailability();

  DAY_DEFINITIONS.forEach((day) => {
    const dayValue = rawAvailability?.[day.key] || {};
    base[day.key] = {
      quickSlots: uniqueStrings(dayValue.quickSlots || []).filter((slotKey) => SLOT_BY_KEY[slotKey]),
      customSlots: dedupeCustomSlots(dayValue.customSlots),
    };
  });

  return base;
}

export function buildAvailabilityFromLegacy(days = [], schedule = []) {
  const base = createEmptyAvailability();

  days.forEach((dayLabel) => {
    const key = DAY_KEY_BY_LABEL[normalizeDayLabel(dayLabel)];

    if (key) {
      base[key].quickSlots = [];
    }
  });

  schedule.forEach((item) => {
    const key = DAY_KEY_BY_LABEL[normalizeDayLabel(item?.day)];

    if (!key) {
      return;
    }

    const normalizedSlot = normalizeCustomSlot(item);

    if (normalizedSlot) {
      base[key].customSlots.push(normalizedSlot);
    }
  });

  return normalizeAvailability(base);
}

export function availabilityToFirestore(value) {
  return normalizeAvailability(value);
}

export function getDayDefinitions() {
  return DAY_DEFINITIONS.map((day) => ({
    ...day,
    label: DAY_LABEL_OVERRIDES[day.key] || day.label,
    shortLabel: DAY_SHORT_LABEL_OVERRIDES[day.key] || day.shortLabel,
  }));
}

export function getQuickSlotDefinitions() {
  return QUICK_SLOT_DEFINITIONS.map((slot) => ({
    ...slot,
    label: QUICK_SLOT_LABEL_OVERRIDES[slot.key] || slot.label,
  }));
}

export function getDayLabel(dayKey) {
  const day = DAY_DEFINITIONS.find((item) => item.key === dayKey);
  return DAY_LABEL_OVERRIDES[dayKey] || day?.label || "";
}

export function getDayShortLabel(dayKey) {
  const day = DAY_DEFINITIONS.find((item) => item.key === dayKey);
  return DAY_SHORT_LABEL_OVERRIDES[dayKey] || day?.shortLabel || "";
}

export function getQuickSlotLabel(slotKey) {
  return QUICK_SLOT_LABEL_OVERRIDES[slotKey] || SLOT_BY_KEY[slotKey]?.label || "";
}

export function dayHasAvailability(dayValue = {}) {
  return (dayValue.quickSlots || []).length > 0 || (dayValue.customSlots || []).length > 0;
}

export function getDayAvailabilitySummary(dayKey, dayValue = {}) {
  const quickLabels = uniqueStrings(dayValue.quickSlots || []).map(getQuickSlotLabel).filter(Boolean);
  const customLabels = (dayValue.customSlots || []).map((slot) => `${slot.from} a ${slot.to}`);

  return {
    dayLabel: getDayLabel(dayKey),
    dayShortLabel: getDayShortLabel(dayKey),
    quickLabels,
    customLabels,
    text: [...quickLabels, ...customLabels].join(" y "),
  };
}

export function getAvailabilitySummaryItems(availability = {}) {
  const normalized = normalizeAvailability(availability);

  return DAY_DEFINITIONS.map((day) => {
    const daySummary = getDayAvailabilitySummary(day.key, normalized[day.key]);

    if (!daySummary.text) {
      return null;
    }

    return {
      key: day.key,
      dayLabel: daySummary.dayLabel,
      dayShortLabel: daySummary.dayShortLabel,
      text: daySummary.text,
      label: `${daySummary.dayShortLabel} · ${daySummary.text}`,
    };
  }).filter(Boolean);
}

export function getAvailabilityHeadline(availability = {}) {
  const summaryItems = getAvailabilitySummaryItems(availability);

  if (summaryItems.length === 0) {
    return "Coordinar por chat";
  }

  return summaryItems
    .slice(0, 2)
    .map((item) => `${item.dayShortLabel} - ${item.text}`)
    .join(" | ");
}

export function isAvailableToday(availability = {}) {
  const todayIndex = new Date().getDay();
  const dayKey = DAY_DEFINITIONS[todayIndex === 0 ? 6 : todayIndex - 1]?.key;

  if (!dayKey) {
    return false;
  }

  return dayHasAvailability(normalizeAvailability(availability)[dayKey]);
}

export function toggleQuickSlot(availability, dayKey, slotKey) {
  const nextAvailability = normalizeAvailability(availability);
  const currentSlots = nextAvailability[dayKey]?.quickSlots || [];

  nextAvailability[dayKey].quickSlots = currentSlots.includes(slotKey)
    ? currentSlots.filter((currentSlot) => currentSlot !== slotKey)
    : [...currentSlots, slotKey];

  return normalizeAvailability(nextAvailability);
}

export function addCustomSlot(availability, dayKey, slot) {
  const nextAvailability = normalizeAvailability(availability);
  nextAvailability[dayKey].customSlots = dedupeCustomSlots([
    ...nextAvailability[dayKey].customSlots,
    slot,
  ]);
  return nextAvailability;
}

export function removeCustomSlot(availability, dayKey, targetIndex) {
  const nextAvailability = normalizeAvailability(availability);
  nextAvailability[dayKey].customSlots = nextAvailability[dayKey].customSlots.filter(
    (_, index) => index !== targetIndex
  );
  return nextAvailability;
}

export function clearDayAvailability(availability, dayKey) {
  const nextAvailability = normalizeAvailability(availability);
  nextAvailability[dayKey] = createEmptyDayAvailability();
  return nextAvailability;
}

export function validateCustomSlot(from, to) {
  const normalizedSlot = normalizeCustomSlot({ from, to });

  if (!normalizedSlot) {
    return {
      valid: false,
      message: "El horario personalizado no es valido.",
    };
  }

  return {
    valid: true,
    slot: normalizedSlot,
  };
}

