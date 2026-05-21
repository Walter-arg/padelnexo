import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  query,
  where,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { ORGANIZER_ROLE, ORGANIZER_STATUS } from "./roleService";

const DEFAULT_SLOTS_BY_DAY = {
  0: ["18:00", "19:30", "21:00"],
  1: ["18:00", "19:30", "21:00"],
  2: ["18:00", "19:30", "21:00"],
  3: ["18:00", "19:30", "21:00"],
  4: ["18:00", "19:30", "21:00"],
  5: ["10:00", "11:30", "17:00", "18:30"],
  6: ["10:00", "11:30", "17:00", "18:30"],
};

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeKey(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function normalizeCount(value = 0) {
  const parsedValue = Number.parseInt(String(value || "0"), 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
}

function normalizeMoney(value = 0) {
  const parsedValue = Number.parseFloat(String(value || "0").replace(",", "."));

  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.round(parsedValue) : 0;
}

function getMillisFromTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (Number.isFinite(value.seconds)) {
    return value.seconds * 1000;
  }

  return Number(value) || 0;
}

function parseTimeToMinutes(time = "") {
  const [hours, minutes] = String(time || "")
    .split(":")
    .map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatMinutesToTime(totalMinutes = 0) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildReservedSlotBlocks(time = "", durationMinutes = 60) {
  const startMinutes = parseTimeToMinutes(time);
  const duration = Number(durationMinutes || 60);
  const blockCount = Math.max(1, Math.ceil(duration / 30));

  if (startMinutes === null) {
    return [];
  }

  return Array.from({ length: blockCount }, (_, index) =>
    formatMinutesToTime(startMinutes + index * 30)
  );
}

function buildCourtFeatureLabel(type = "") {
  if (type === "blindex") {
    return "BLINDEX";
  }

  if (type === "cesped") {
    return "CEMENTO\nSINTETICO";
  }

  if (type === "cemento") {
    return "CEMENTO";
  }

  return "CANCHA";
}

function buildCourtFeaturesFromCourt(court = {}) {
  const structureLabel = court.estructura === "cemento" ? "CEMENTO" : "BLINDEX";
  const floorLabel = court.piso === "cemento" ? "PISO CEMENTO" : "SINTETICO";

  return [structureLabel, floorLabel];
}

function getComplexEnvironment(complex = {}) {
  if (complex.canchaAmbiente === "cubierta") {
    return "cubierta";
  }

  if (complex.canchaAmbiente === "descubierta") {
    return "descubierta";
  }

  return "";
}

function buildCourtsFromComplex(complex = {}) {
  if (Array.isArray(complex.canchas) && complex.canchas.length) {
    return complex.canchas.map((court, index) => ({
      id: court.id || `court-${index + 1}`,
      name: court.nombre?.trim() || `Cancha ${index + 1}`,
      displayName: court.nombre?.trim() || "",
      enabled: false,
      environment: court.ambiente || getComplexEnvironment(complex),
      features: buildCourtFeaturesFromCourt(court),
      floor: court.piso || "",
      price60: 0,
      price90: 0,
      slotsByDate: {},
      slotsByDay: DEFAULT_SLOTS_BY_DAY,
      structure: court.estructura || "",
      type: court.estructura || "",
    }));
  }

  const definitions = [
    { count: normalizeCount(complex.blindex), type: "blindex" },
    { count: normalizeCount(complex.cesped), type: "cesped" },
    { count: normalizeCount(complex.cemento), type: "cemento" },
  ];
  const environment = getComplexEnvironment(complex);
  let courtNumber = 0;

  return definitions.flatMap((definition) =>
    Array.from({ length: definition.count }, () => {
      courtNumber += 1;

      return {
        id: `court-${courtNumber}`,
        name: `Cancha ${courtNumber}`,
        enabled: false,
        environment,
        features: [buildCourtFeatureLabel(definition.type)],
        price60: 0,
        price90: 0,
        slotsByDate: {},
        slotsByDay: DEFAULT_SLOTS_BY_DAY,
        type: definition.type,
      };
    })
  );
}

function normalizeCourtConfig(court = {}, fallback = {}) {
  return {
    id: court.id || fallback.id || "",
    name: court.name || fallback.name || "Cancha",
    displayName: court.displayName || fallback.displayName || "",
    enabled: court.enabled === true,
    environment: court.environment || fallback.environment || "",
    features: Array.isArray(court.features) && court.features.length
      ? court.features.map(normalizeText).filter(Boolean)
      : fallback.features || [],
    floor: court.floor || fallback.floor || "",
    price60: normalizeMoney(court.price60 || fallback.price60),
    price90: normalizeMoney(court.price90 || fallback.price90),
    selectedDateIds: Array.isArray(court.selectedDateIds)
      ? court.selectedDateIds
      : Array.isArray(fallback.selectedDateIds)
        ? fallback.selectedDateIds
        : [],
    slotsByDate: court.slotsByDate || fallback.slotsByDate || {},
    slotsByDay: court.slotsByDay || fallback.slotsByDay || DEFAULT_SLOTS_BY_DAY,
    structure: court.structure || fallback.structure || "",
    type: court.type || fallback.type || "",
  };
}

function normalizeComplexConfig(complex = {}, storedComplex = {}) {
  const complexKey =
    storedComplex.complexKey ||
    `${normalizeKey(complex.nombre)}-${normalizeKey(complex.direccion)}`;
  const baseCourts = buildCourtsFromComplex(complex);
  const storedCourts = Array.isArray(storedComplex.courts) ? storedComplex.courts : [];
  const storedById = new Map(storedCourts.map((court) => [court.id, court]));

  return {
    complexKey,
    name: complex.nombre || storedComplex.name || "Complejo",
    address: complex.direccion || storedComplex.address || "",
    canchaAmbiente: complex.canchaAmbiente || storedComplex.canchaAmbiente || "",
    city: complex.localidad || complex.ciudad || complex.city || storedComplex.city || "",
    province: complex.provincia || complex.province || storedComplex.province || "",
    courts: baseCourts.map((court) => normalizeCourtConfig(storedById.get(court.id), court)),
  };
}

function mapUserDocToOrganizer(docSnapshot, storedConfig = null) {
  const data = docSnapshot.data() || {};
  const complexes = Array.isArray(data.complejos) ? data.complejos : [];
  const storedComplexes = Array.isArray(storedConfig?.complexes) ? storedConfig.complexes : [];
  const storedByKey = new Map(storedComplexes.map((complex) => [complex.complexKey, complex]));

  return {
    organizerId: docSnapshot.id,
    organizerName: data.nombre || data.name || "Organizador",
    organizerLogoUrl: data.organizerLogoURL || "",
    organizerCity: data.localidad?.nombre || data.location?.ciudad || data.city || "",
    organizerProvince: data.localidad?.provincia || data.location?.provincia || data.province || "",
    complexes: complexes.map((complex) => {
      const complexKey = `${normalizeKey(complex.nombre)}-${normalizeKey(complex.direccion)}`;
      return normalizeComplexConfig(complex, storedByKey.get(complexKey) || { complexKey });
    }),
  };
}

export async function getOrganizerTurnosConfig(organizerId = "", userData = {}) {
  const configSnapshot = await getDoc(doc(db, "turnosConfigs", organizerId));
  const storedConfig = configSnapshot.exists() ? configSnapshot.data() : null;

  return {
    organizerId,
    requiresOrganizerApproval: storedConfig?.requiresOrganizerApproval !== false,
    complexes: (Array.isArray(userData?.complejos) ? userData.complejos : []).map((complex) => {
      const complexKey = `${normalizeKey(complex.nombre)}-${normalizeKey(complex.direccion)}`;
      const storedComplex = (storedConfig?.complexes || []).find(
        (item) => item.complexKey === complexKey
      );

      return normalizeComplexConfig(complex, storedComplex || { complexKey });
    }),
  };
}

export async function saveOrganizerTurnosConfig(organizerId = "", config = {}) {
  if (!organizerId) {
    throw new Error("No encontramos el organizador.");
  }

  await setDoc(
    doc(db, "turnosConfigs", organizerId),
    {
      organizerId,
      requiresOrganizerApproval: config.requiresOrganizerApproval !== false,
      complexes: config.complexes || [],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return config;
}

export async function listBookableComplexes() {
  const usersSnapshot = await getDocs(collection(db, "users"));
  const configsSnapshot = await getDocs(collection(db, "turnosConfigs"));
  const reservationsSnapshot = await getDocs(collection(db, "turnoReservations"));
  const configsByOrganizer = new Map(
    configsSnapshot.docs.map((configDoc) => [configDoc.id, configDoc.data()])
  );
  const reservedSlots = new Map();

  reservationsSnapshot.docs.forEach((reservationDoc) => {
    const reservation = reservationDoc.data() || {};
    const status = String(reservation.status || "");

    if (["cancelled", "rejected"].includes(status)) {
      return;
    }

    const key = [
      reservation.organizerId,
      reservation.complexKey,
      reservation.courtId,
      reservation.dateMillis,
    ].join("|");
    const currentSlots = reservedSlots.get(key) || new Set();

    buildReservedSlotBlocks(reservation.time, reservation.durationMinutes).forEach((slot) =>
      currentSlots.add(slot)
    );

    reservedSlots.set(key, currentSlots);
  });

  return usersSnapshot.docs
    .filter((docSnapshot) => {
      const data = docSnapshot.data() || {};
      return (
        data.role === ORGANIZER_ROLE &&
        data.organizerStatus === ORGANIZER_STATUS.APPROVED &&
        Array.isArray(data.complejos) &&
        data.complejos.length > 0
      );
    })
    .flatMap((docSnapshot) => {
      const organizer = mapUserDocToOrganizer(docSnapshot, configsByOrganizer.get(docSnapshot.id));

      return organizer.complexes.map((complex) => {
        const availableCourts = complex.courts.filter((court) => court.enabled).map((court) => ({
          ...court,
          reservedSlotsByDate: Object.fromEntries(
            [...reservedSlots.entries()]
              .filter(([key]) =>
                key.startsWith(`${organizer.organizerId}|${complex.complexKey}|${court.id}|`)
              )
              .map(([key, slots]) => [key.split("|").pop(), [...slots]])
          ),
        }));

        return {
          ...complex,
          organizerId: organizer.organizerId,
      organizerName: organizer.organizerName,
      organizerLogoUrl: organizer.organizerLogoUrl,
      requiresOrganizerApproval: configsByOrganizer.get(organizer.organizerId)?.requiresOrganizerApproval !== false,
      organizerCity: organizer.organizerCity,
          organizerProvince: organizer.organizerProvince,
          availableCourts,
        };
      });
    })
    .filter((complex) => complex.availableCourts.length > 0);
}

export async function createTurnoReservation(payload = {}) {
  const requiresOrganizerApproval = payload.requiresOrganizerApproval !== false;
  const reservationRef = await addDoc(collection(db, "turnoReservations"), {
    ...payload,
    requiresOrganizerApproval,
    status: requiresOrganizerApproval ? "pending_organizer_confirmation" : "confirmed",
    confirmedAt: requiresOrganizerApproval ? null : serverTimestamp(),
    paymentStatus: payload.paymentMethod === "transferencia" ? "in_review" : "pending_cash",
    createdAt: serverTimestamp(),
  });

  return {
    id: reservationRef.id,
    ...payload,
  };
}

function mapTurnoReservationDoc(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    ...data,
    createdAtMillis: getMillisFromTimestamp(data.createdAt),
    updatedAtMillis: getMillisFromTimestamp(data.updatedAt),
  };
}

export async function listOrganizerTurnoReservations(organizerId = "") {
  if (!organizerId) {
    return [];
  }

  const snapshot = await getDocs(
    query(collection(db, "turnoReservations"), where("organizerId", "==", organizerId))
  );

  return snapshot.docs
    .map(mapTurnoReservationDoc)
    .sort((first, second) => {
      const firstMillis = first.createdAtMillis || Number(first.dateMillis || 0);
      const secondMillis = second.createdAtMillis || Number(second.dateMillis || 0);

      return secondMillis - firstMillis;
    });
}

export async function updateTurnoReservationStatus(reservationId = "", status = "") {
  if (!reservationId || !status) {
    throw new Error("No encontramos la reserva.");
  }

  await updateDoc(doc(db, "turnoReservations", reservationId), {
    status,
    updatedAt: serverTimestamp(),
    ...(status === "confirmed" ? { confirmedAt: serverTimestamp() } : {}),
    ...(status === "rejected" ? { rejectedAt: serverTimestamp() } : {}),
    ...(status === "cancelled" ? { cancelledAt: serverTimestamp() } : {}),
  });

  return { id: reservationId, status };
}
