import { initializeApp } from "./firebaseApp";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "./firebaseAuth";
import { getFirestore, initializeFirestore } from "./firebaseFirestore";
import { getStorage } from "./firebaseStorage";

const firebaseConfig = {
  apiKey: "AIzaSyD4hHUTo91MlrPSjcX2MgrRYMO28SyGLkc",
  authDomain: "padelnexo-7e4d5.firebaseapp.com",
  projectId: "padelnexo-7e4d5",
  storageBucket: "padelnexo-7e4d5.firebasestorage.app",
  messagingSenderId: "553114005250",
  appId: "1:553114005250:web:da65ffb127b781c1b1dc1b",
};

const app = initializeApp(firebaseConfig);

let authInstance;
let db = null;
let storage = null;
let dbInitPromise = null;
let storageInitPromise = null;

try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  authInstance = getAuth(app);
}

function initFirestoreService() {
  try {
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
    return db;
  } catch (error) {
    try {
      db = getFirestore(app);
      return db;
    } catch (fallbackError) {
      console.log(
        "[firebaseConfig] No se pudo inicializar Firestore:",
        fallbackError?.message || fallbackError
      );
      db = null;
      return null;
    }
  }
}

function initStorageService() {
  try {
    storage = getStorage(app);
    return storage;
  } catch (error) {
    console.log(
      "[firebaseConfig] No se pudo inicializar Storage:",
      error?.message || error
    );
    storage = null;
    return null;
  }
}

initFirestoreService();
initStorageService();

export async function ensureDb() {
  if (db) {
    return db;
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    try {
      const firestoreModule = await import("./firebaseFirestore");

      try {
        db =
          firestoreModule.initializeFirestore(app, {
            experimentalForceLongPolling: true,
          }) || db;
      } catch (error) {
        db = firestoreModule.getFirestore(app);
      }
    } catch (error) {
      console.log(
        "[firebaseConfig] No se pudo reintentar Firestore:",
        error?.message || error
      );
      db = null;
    } finally {
      dbInitPromise = null;
    }

    return db;
  })();

  return dbInitPromise;
}

export async function ensureStorage() {
  if (storage) {
    return storage;
  }

  if (storageInitPromise) {
    return storageInitPromise;
  }

  storageInitPromise = (async () => {
    try {
      const storageModule = await import("./firebaseStorage");
      storage = storageModule.getStorage(app);
    } catch (error) {
      console.log(
        "[firebaseConfig] No se pudo reintentar Storage:",
        error?.message || error
      );
      storage = null;
    } finally {
      storageInitPromise = null;
    }

    return storage;
  })();

  return storageInitPromise;
}

export const auth = authInstance;
export { db, storage };

