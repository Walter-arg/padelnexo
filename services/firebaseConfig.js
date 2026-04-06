import { initializeApp } from "firebase/app";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD4hHUTo91MlrPSjcX2MgrRYMO28SyGLkc",
  authDomain: "padelnexo-7e4d5.firebaseapp.com",
  projectId: "padelnexo-7e4d5",
  storageBucket: "padelnexo-7e4d5.firebasestorage.app",
  messagingSenderId: "553114005250",
  appId: "1:553114005250:web:da65ffb127b781c1b1dc1b"
};

const app = initializeApp(firebaseConfig);

let authInstance;

try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = getFirestore(app);
export const storage = getStorage(app);
