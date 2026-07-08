import {
  createUserWithEmailAndPassword,
  deleteUser,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithCredential,
  signOut,
} from "../../services/firebaseAuth";

import { auth } from "../../services/firebaseConfig";
import { getFirebaseErrorMessage } from "./firebaseErrors";
import devLog from "../utils/devLog";

export async function registerUser(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    devLog("[authService] registerUser error:", error?.code, error?.message);
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos crear tu cuenta en este momento.")
    );
  }
}

export async function loginUser(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    devLog("[authService] loginUser error:", error?.code, error?.message);
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos iniciar sesion en este momento.")
    );
  }
}

export async function loginWithGoogleIdToken(idToken) {
  if (!idToken) {
    throw new Error("No pudimos obtener la autorizacion de Google.");
  }

  try {
    const credential = GoogleAuthProvider.credential(idToken);
    return await signInWithCredential(auth, credential);
  } catch (error) {
    devLog("[authService] loginWithGoogleIdToken error:", error?.code, error?.message);
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos ingresar con Google en este momento.")
    );
  }
}

async function reauthenticateWithGoogleIdToken(idToken) {
  if (!auth.currentUser) {
    throw new Error("No hay una sesion activa.");
  }

  if (!idToken) {
    throw new Error("No pudimos obtener la autorizacion de Google.");
  }

  const credential = GoogleAuthProvider.credential(idToken);
  await reauthenticateWithCredential(auth.currentUser, credential);
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos cerrar sesion. Intenta nuevamente.")
    );
  }
}

const RESET_PASSWORD_FUNCTION_URL =
  "https://southamerica-east1-padelnexo-7e4d5.cloudfunctions.net/sendPasswordReset";

export async function resetPassword(email) {
  try {
    const response = await fetch(RESET_PASSWORD_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data?.error === "email_service_not_configured") {
        throw new Error("El servicio de email no está configurado. Contactá al administrador.");
      }
      throw new Error("No pudimos enviar el correo de recuperacion en este momento.");
    }
  } catch (error) {
    if (error?.message?.includes("configurado") || error?.message?.includes("recuperacion")) {
      throw error;
    }
    throw new Error("No pudimos enviar el correo de recuperacion. Verificá tu conexión e intentá de nuevo.");
  }
}

export async function deleteCurrentUserAccount(reauthenticate) {
  try {
    if (!auth.currentUser) {
      throw new Error("No hay una sesion activa.");
    }

    try {
      await deleteUser(auth.currentUser);
    } catch (error) {
      if (error?.code !== "auth/requires-recent-login" || !reauthenticate) {
        throw error;
      }

      const idToken = await reauthenticate();
      await reauthenticateWithGoogleIdToken(idToken);
      await deleteUser(auth.currentUser);
    }
  } catch (error) {
    devLog("[authService] deleteCurrentUserAccount error:", error?.code, error?.message);
    throw new Error(
      getFirebaseErrorMessage(
        error,
        error?.code === "auth/requires-recent-login"
          ? "Para eliminar tu cuenta necesitamos que vuelvas a iniciar sesion."
          : "No pudimos eliminar tu cuenta en este momento."
      )
    );
  }
}

export async function resendVerificationEmail() {
  if (!auth.currentUser) {
    throw new Error("No hay una sesion activa.");
  }

  try {
    await sendEmailVerification(auth.currentUser);
  } catch (error) {
    devLog("[authService] resendVerificationEmail error:", error?.code, error?.message);

    if (error?.code === "auth/too-many-requests") {
      throw new Error("Espera unos minutos antes de volver a solicitarlo.");
    }

    throw new Error("No pudimos reenviar el email. Intentalo en unos instantes.");
  }
}

export const authService = {
  login: loginUser,
  loginWithGoogleIdToken,
  register: registerUser,
  requestPasswordReset: resetPassword,
  resetPassword,
  logout: logoutUser,
  deleteCurrentUserAccount,
};

