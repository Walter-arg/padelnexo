import {
  GoogleSignin,
  isNoSavedCredentialFoundResponse,
  isCancelledResponse,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";

import { googleAuthConfig } from "../config/googleAuth";

let configured = false;

export function configureGoogleSignIn() {
  if (configured) {
    return;
  }

  GoogleSignin.configure({
    iosClientId: googleAuthConfig.iosClientId || undefined,
    profileImageSize: 240,
    scopes: ["email", "profile"],
    webClientId: googleAuthConfig.webClientId,
  });
  configured = true;
}

export async function requestGoogleIdToken({ forceAccountSelection = false } = {}) {
  configureGoogleSignIn();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  if (forceAccountSelection) {
    await GoogleSignin.signOut().catch(() => {});
  }

  const response = await GoogleSignin.signIn();

  if (isCancelledResponse(response)) {
    return null;
  }

  if (!isSuccessResponse(response)) {
    throw new Error("No se pudo completar el ingreso con Google.");
  }

  let idToken = response.data?.idToken;

  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = tokens?.idToken;
  }

  if (!idToken) {
    throw new Error("Google no devolvio el token de acceso.");
  }

  return idToken;
}

export async function requestGoogleIdTokenSilently() {
  configureGoogleSignIn();

  const response = await GoogleSignin.signInSilently();

  if (isNoSavedCredentialFoundResponse(response)) {
    return null;
  }

  if (!isSuccessResponse(response)) {
    return null;
  }

  let idToken = response.data?.idToken;

  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = tokens?.idToken;
  }

  return idToken || null;
}

export async function clearGoogleSignInSession() {
  configureGoogleSignIn();
  await GoogleSignin.signOut().catch(() => {});
}
