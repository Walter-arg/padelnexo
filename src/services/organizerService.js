import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../services/firebaseConfig";
import { ORGANIZER_ROLE, ORGANIZER_STATUS, USER_ROLE } from "./roleService";

export function createEmptyComplex() {
  return {
    nombre: "",
    blindex: 0,
    cesped: 0,
    cemento: 0,
    totalCanchas: 0,
    direccion: "",
  };
}

function normalizeCount(value) {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return parsedValue;
}

export function normalizeComplex(complex = {}) {
  const blindex = normalizeCount(complex.blindex);
  const cesped = normalizeCount(complex.cesped);
  const cemento = normalizeCount(complex.cemento);

  return {
    nombre: complex.nombre?.trim() || "",
    blindex,
    cesped,
    cemento,
    totalCanchas: blindex + cesped + cemento,
    direccion: complex.direccion?.trim() || "",
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

  return {
    userId,
    nombre: payload.nombre.trim(),
    dni: payload.dni.trim(),
    telefono: payload.telefono.trim(),
    countryCode: payload.countryCode || "+54",
    phoneCountry: payload.phoneCountry || "Argentina",
    complejos,
    status: ORGANIZER_STATUS.PENDING,
  };
}

export async function updateOrganizerComplexes(userId, complejos) {
  const userRef = doc(db, "users", userId);
  const normalizedComplexes = complejos.map(normalizeComplex);

  await updateDoc(userRef, {
    complejos: normalizedComplexes,
  });

  return normalizedComplexes;
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
