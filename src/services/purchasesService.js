import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

import devLog from "../utils/devLog";

const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "";
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || "";

let isConfigured = false;

// Debe llamarse una sola vez al arrancar la app, antes de cualquier login.
// El appUserID real (uid de Firebase) se asocia despues via loginPurchasesUser.
export function configurePurchases() {
  if (isConfigured || Platform.OS === "web") {
    return;
  }

  const apiKey = Platform.OS === "ios" ? IOS_API_KEY : ANDROID_API_KEY;
  if (!apiKey) {
    devLog("[purchasesService] Falta la API key de RevenueCat para", Platform.OS);
    return;
  }

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
  }

  Purchases.configure({ apiKey });
  isConfigured = true;
}

// Asocia el usuario anonimo de RevenueCat con el uid de Firebase al hacer login.
export async function loginPurchasesUser(uid) {
  if (!isConfigured || !uid) {
    return;
  }
  try {
    await Purchases.logIn(uid);
  } catch (error) {
    devLog("[purchasesService] Error en logIn:", error?.message || error);
  }
}

export async function logoutPurchasesUser() {
  if (!isConfigured) {
    return;
  }
  try {
    await Purchases.logOut();
  } catch (error) {
    devLog("[purchasesService] Error en logOut:", error?.message || error);
  }
}

// Devuelve el Offering activo con los packages (mensual/anual x plan) ya
// configurados en el dashboard de RevenueCat.
export async function getPlansOffering() {
  if (!isConfigured) {
    return null;
  }
  const offerings = await Purchases.getOfferings();
  return offerings.current || null;
}

export async function purchasePlanPackage(pkg) {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePlanPurchases() {
  const customerInfo = await Purchases.restorePurchases();
  return customerInfo;
}

export function isPurchasesConfigured() {
  return isConfigured;
}
