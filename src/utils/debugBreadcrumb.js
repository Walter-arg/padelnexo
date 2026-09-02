import { addDoc, collection, serverTimestamp } from "../../services/firebaseFirestore";
import { auth, db } from "../../services/firebaseConfig";

// TEMPORAL: registra un rastro en Firestore para diagnosticar el bug del
// formulario en blanco de "Solicitud de organizador". Nunca debe romper el
// flujo normal de la app si falla. Borrar junto con la coleccion
// debugBreadcrumbs y la regla de Firestore que la habilita una vez resuelto.
export function logBreadcrumb(event, details = {}) {
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
