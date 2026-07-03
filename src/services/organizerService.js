import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { sendOrganizerRequestNotificationToAdmins } from "./chatService";
import devLog from "../utils/devLog";
import { ORGANIZER_ROLE, ORGANIZER_STATUS, USER_ROLE } from "./roleService";

export function createEmptyComplex() {
  return {
    nombre: "",
    canchaAmbiente: "",
    canchas: [],
    blindex: 0,
    cesped: 0,
    cemento: 0,
    totalCanchas: 0,
    direccion: "",
  };
}

function normalizeCourt(court = {}, index = 0) {
  const estructura = court.estructura === "cemento" ? "cemento" : "blindex";
  const piso = court.piso === "cemento" ? "cemento" : "sintetico";
  const ambiente = court.ambiente === "cubierta" ? "cubierta" : "aire_libre";

  return {
    id: court.id || `court-${index + 1}`,
    nombre: String(court.nombre || "").trim(),
    estructura,
    piso,
    ambiente,
  };
}

function buildCourtsFromLegacyCounts(complex = {}) {
  const courts = [];
  const addCourts = (count, template) => {
    Array.from({ length: count }).forEach(() => {
      courts.push(normalizeCourt({ ...template, id: `court-${courts.length + 1}` }, courts.length));
    });
  };
  const legacyAmbiente =
    complex.canchaAmbiente === "cubierta" ? "cubierta" : "aire_libre";

  addCourts(normalizeCount(complex.blindex), {
    estructura: "blindex",
    piso: "sintetico",
    ambiente: legacyAmbiente,
  });
  addCourts(normalizeCount(complex.cesped), {
    estructura: "cemento",
    piso: "sintetico",
    ambiente: legacyAmbiente,
  });
  addCourts(normalizeCount(complex.cemento), {
    estructura: "cemento",
    piso: "cemento",
    ambiente: legacyAmbiente,
  });

  return courts;
}

function countCourtsByType(canchas = []) {
  return canchas.reduce(
    (counts, court) => {
      if (court.estructura === "blindex") {
        counts.blindex += 1;
      } else if (court.piso === "sintetico") {
        counts.cesped += 1;
      } else {
        counts.cemento += 1;
      }

      return counts;
    },
    { blindex: 0, cemento: 0, cesped: 0 }
  );
}

function normalizeCount(value) {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return parsedValue;
}

function normalizeCoordinate(value) {
  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function getComplexCoordinates(complex = {}) {
  const coordinates = complex.coordinates || complex.coords || complex.location || {};
  const latitude = normalizeCoordinate(
    complex.latitude ?? complex.lat ?? complex.latitud ?? coordinates.latitude ?? coordinates.lat
  );
  const longitude = normalizeCoordinate(
    complex.longitude ??
      complex.lng ??
      complex.lon ??
      complex.longitud ??
      coordinates.longitude ??
      coordinates.lng ??
      coordinates.lon
  );

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

export function normalizeComplex(complex = {}) {
  const canchas = Array.isArray(complex.canchas) && complex.canchas.length
    ? complex.canchas.map(normalizeCourt)
    : buildCourtsFromLegacyCounts(complex);
  const counts = countCourtsByType(canchas);

  return {
    nombre: complex.nombre?.trim() || "",
    canchaAmbiente: complex.canchaAmbiente === "cubierta" ? "cubierta" : "descubierta",
    canchas,
    blindex: counts.blindex,
    cesped: counts.cesped,
    cemento: counts.cemento,
    totalCanchas: canchas.length,
    direccion: complex.direccion?.trim() || "",
    coordinates: getComplexCoordinates(complex),
  };
}

export async function getOrganizerRequest(userId) {
  const requestRef = doc(db, "organizerRequests", userId);
  const snapshot = await getDoc(requestRef);

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();

  return {
    userId,
    ...data,
    complejos: Array.isArray(data.complejos)
      ? data.complejos.map(normalizeComplex)
      : [],
  };
}

export async function submitOrganizerRequest(userId, payload) {
  const requestRef = doc(db, "organizerRequests", userId);
  const userRef = doc(db, "users", userId);
  const complejos = (payload.complejos || []).map(normalizeComplex);

  await setDoc(requestRef, {
    userId,
    nombre: payload.nombre.trim(),
    dni: payload.dni.trim(),
    telefono: payload.telefono.trim(),
    countryCode: payload.countryCode || "+54",
    phoneCountry: payload.phoneCountry || "Argentina",
    complejos,
    status: ORGANIZER_STATUS.PENDING,
    createdAt: serverTimestamp(),
  });

  await updateDoc(userRef, {
    role: ORGANIZER_ROLE,
    organizerStatus: ORGANIZER_STATUS.PENDING,
  });

  const submittedRequest = {
    userId,
    nombre: payload.nombre.trim(),
    dni: payload.dni.trim(),
    telefono: payload.telefono.trim(),
    countryCode: payload.countryCode || "+54",
    phoneCountry: payload.phoneCountry || "Argentina",
    complejos,
    status: ORGANIZER_STATUS.PENDING,
  };

  sendOrganizerRequestNotificationToAdmins(submittedRequest).catch((error) => {
    devLog("[organizerService] No pudimos notificar a administradores", error);
  });

  return submittedRequest;
}

export async function updateOrganizerComplexes(userId, complejos) {
  const userRef = doc(db, "users", userId);
  const normalizedComplexes = complejos.map(normalizeComplex);

  await updateDoc(userRef, {
    complejos: normalizedComplexes,
  });

  return normalizedComplexes;
}

export async function submitComplexRequest(userId, payload) {
  const normalizedComplexes = (payload.complejos || []).map(normalizeComplex).filter((complex) =>
    Boolean(complex.nombre)
  );

  if (normalizedComplexes.length === 0) {
    throw new Error("Agrega al menos un complejo para enviar la solicitud.");
  }

  const requestRef = await addDoc(collection(db, "complexRequests"), {
    userId,
    organizerName: payload.organizerName?.trim() || "",
    organizerEmail: payload.organizerEmail?.trim().toLowerCase() || "",
    complejos: normalizedComplexes,
    status: ORGANIZER_STATUS.PENDING,
    createdAt: serverTimestamp(),
  });

  return {
    id: requestRef.id,
    userId,
    organizerName: payload.organizerName?.trim() || "",
    organizerEmail: payload.organizerEmail?.trim().toLowerCase() || "",
    complejos: normalizedComplexes,
    status: ORGANIZER_STATUS.PENDING,
  };
}

export async function listOrganizerRequests() {
  const requestsRef = collection(db, "organizerRequests");
  const requestsQuery = query(requestsRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(requestsQuery);

  return snapshot.docs.map((requestDoc) => {
    const data = requestDoc.data();

    return {
      id: requestDoc.id,
      ...data,
      complejos: Array.isArray(data.complejos)
        ? data.complejos.map(normalizeComplex)
        : [],
    };
  });
}

export async function listComplexRequests() {
  const requestsRef = collection(db, "complexRequests");
  const requestsQuery = query(requestsRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(requestsQuery);

  return snapshot.docs.map((requestDoc) => {
    const data = requestDoc.data();

    return {
      id: requestDoc.id,
      ...data,
      complejos: Array.isArray(data.complejos)
        ? data.complejos.map(normalizeComplex)
        : [],
    };
  });
}

export async function approveOrganizerRequest(userId) {
  const requestRef = doc(db, "organizerRequests", userId);
  const userRef = doc(db, "users", userId);
  const requestSnapshot = await getDoc(requestRef);

  if (!requestSnapshot.exists()) {
    throw new Error("No encontramos la solicitud seleccionada.");
  }

  const requestData = requestSnapshot.data();
  const complejos = Array.isArray(requestData.complejos)
    ? requestData.complejos.map(normalizeComplex)
    : [];
  const batch = writeBatch(db);

  batch.update(userRef, {
    organizerStatus: ORGANIZER_STATUS.APPROVED,
    role: ORGANIZER_ROLE,
    complejos,
  });

  batch.update(requestRef, {
    status: ORGANIZER_STATUS.APPROVED,
  });

  await batch.commit();
}

export async function rejectOrganizerRequest(userId) {
  const requestRef = doc(db, "organizerRequests", userId);
  const userRef = doc(db, "users", userId);
  const batch = writeBatch(db);

  batch.update(requestRef, {
    status: ORGANIZER_STATUS.REJECTED,
  });

  batch.update(userRef, {
    role: USER_ROLE,
    organizerStatus: ORGANIZER_STATUS.REJECTED,
    complejos: [],
  });

  await batch.commit();
}

export async function deleteOrganizerRequest(userId) {
  if (!userId) {
    throw new Error("No encontramos la solicitud seleccionada.");
  }

  const requestRef = doc(db, "organizerRequests", userId);
  const userRef = doc(db, "users", userId);
  const batch = writeBatch(db);

  batch.delete(requestRef);
  batch.update(userRef, {
    role: USER_ROLE,
    organizerStatus: ORGANIZER_STATUS.NONE,
    complejos: [],
  });

  await batch.commit();
}

export async function deleteComplexRequest(requestId) {
  if (!requestId) {
    throw new Error("No encontramos la solicitud seleccionada.");
  }

  await deleteDoc(doc(db, "complexRequests", requestId));
}

export async function approveComplexRequest(requestId) {
  const requestRef = doc(db, "complexRequests", requestId);
  const requestSnapshot = await getDoc(requestRef);

  if (!requestSnapshot.exists()) {
    throw new Error("No encontramos la solicitud de complejo.");
  }

  const requestData = requestSnapshot.data();
  const userId = String(requestData.userId || "").trim();

  if (!userId) {
    throw new Error("La solicitud no tiene un organizador asociado.");
  }

  const userRef = doc(db, "users", userId);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error("No encontramos el perfil del organizador.");
  }

  const currentComplexes = Array.isArray(userSnapshot.data()?.complejos)
    ? userSnapshot.data().complejos.map(normalizeComplex)
    : [];
  const requestedComplexes = Array.isArray(requestData.complejos)
    ? requestData.complejos.map(normalizeComplex)
    : [];

  const mergedComplexes = [...currentComplexes];

  requestedComplexes.forEach((complex) => {
    const alreadyExists = mergedComplexes.some(
      (item) =>
        item.nombre.trim().toLowerCase() === complex.nombre.trim().toLowerCase() &&
        item.direccion.trim().toLowerCase() === complex.direccion.trim().toLowerCase()
    );

    if (!alreadyExists) {
      mergedComplexes.push(complex);
    }
  });

  const batch = writeBatch(db);

  batch.update(userRef, {
    complejos: mergedComplexes,
  });

  batch.update(requestRef, {
    status: ORGANIZER_STATUS.APPROVED,
    approvedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function rejectComplexRequest(requestId) {
  const requestRef = doc(db, "complexRequests", requestId);

  await updateDoc(requestRef, {
    status: ORGANIZER_STATUS.REJECTED,
    reviewedAt: serverTimestamp(),
  });
}

