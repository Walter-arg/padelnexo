import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "../../services/firebaseAuth";

import { auth } from "../../services/firebaseConfig";
import { getFirebaseErrorMessage } from "./firebaseErrors";

export async function registerUser(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos crear tu cuenta en este momento.")
    );
  }
}

export async function loginUser(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw new Error(
      getFirebaseErrorMessage(error, "No pudimos iniciar sesion en este momento.")
    );
  }
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

export async function deleteCurrentUserAccount() {
  try {
    if (!auth.currentUser) {
      throw new Error("No hay una sesion activa.");
    }

    await deleteUser(auth.currentUser);
  } catch (error) {
    throw new Error(
      getFirebaseErrorMessage(
        error,
        "No pudimos eliminar tu cuenta en este momento."
      )
    );
  }
}

export const authService = {
  login: loginUser,
  register: registerUser,
  requestPasswordReset: resetPassword,
  resetPassword,
  logout: logoutUser,
  deleteCurrentUserAccount,
};

