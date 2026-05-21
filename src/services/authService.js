import {
  createUserWithEmailAndPassword,
  deleteUser,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithCredential,
  signOut,
} from "../../services/firebaseAuth";

import { auth } from "../../services/firebaseConfig";
import { getFirebaseErrorMessage } from "./firebaseErrors";

export async function registerUser(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.log("[authService] registerUser error:", error?.code, error?.message);
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos crear tu cuenta en este momento.")
    );
  }
}

export async function loginUser(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.log("[authService] loginUser error:", error?.code, error?.message);
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
    console.log("[authService] loginWithGoogleIdToken error:", error?.code, error?.message);
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

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw new Error(
      getFirebaseErrorMessage(
        error,
        "No pudimos enviar el correo de recuperacion en este momento."
      )
    );
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
    console.log("[authService] deleteCurrentUserAccount error:", error?.code, error?.message);
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

export const authService = {
  login: loginUser,
  loginWithGoogleIdToken,
  register: registerUser,
  requestPasswordReset: resetPassword,
  resetPassword,
  logout: logoutUser,
  deleteCurrentUserAccount,
};

