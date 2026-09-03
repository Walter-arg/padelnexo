import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDoc, collection, serverTimestamp } from "../../services/firebaseFirestore";
import { auth, db } from "../../services/firebaseConfig";

// TEMPORAL: registra un rastro para diagnosticar el bug del formulario en
// blanco de "Solicitud de organizador". Nunca debe romper el flujo normal de
// la app si falla. Borrar junto con debugBreadcrumbs (Firestore + Cloud
// Function) y este archivo una vez resuelto.
const LOCAL_LOG_KEY = "__debug_breadcrumbs_local__";
const MAX_LOCAL_ENTRIES = 60;

export function logBreadcrumb(event, details = {}) {
  // Copia local en el propio telefono, no depende de la red: sobrevive a
  // que la app se suspenda o el proceso se reinicie durante el bug (la
  // version que mandaba solo a Firestore perdia justo los eventos del
  // momento en que el permiso de ubicacion pone la app en segundo plano).
  logBreadcrumbLocal(event, details);

  try {
    const uid = auth?.currentUser?.uid;

    if (!uid) {
      return;
    }

    addDoc(collection(db, "debugBreadcrumbs"), {
      uid,
      event,
      details,
      clientTimeMs: Date.now(),
      createdAt: serverTimestamp(),
    }).catch(() => null);
  } catch (error) {
    // Nunca debe afectar el flujo real de la app.
  }
}

function logBreadcrumbLocal(event, details) {
  AsyncStorage.getItem(LOCAL_LOG_KEY)
    .then((raw) => {
      const current = raw ? JSON.parse(raw) : [];
      const next = [...current, { event, details, t: Date.now() }].slice(-MAX_LOCAL_ENTRIES);
      return AsyncStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(next));
    })
    .catch(() => null);
}

export async function getLocalBreadcrumbs() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

export async function clearLocalBreadcrumbs() {
  try {
    await AsyncStorage.removeItem(LOCAL_LOG_KEY);
  } catch (error) {
    // no-op
  }
}
