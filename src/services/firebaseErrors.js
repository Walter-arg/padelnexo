const FIREBASE_ERROR_MESSAGES = {
  "auth/email-already-in-use": "Ya existe una cuenta registrada con ese email.",
  "auth/invalid-email": "El email ingresado no es valido.",
  "auth/wrong-password": "La contraseña es incorrecta.",
  "auth/invalid-credential": "El email o la contraseña no son correctos.",
  "auth/user-not-found": "No encontramos una cuenta con ese email.",
  "auth/missing-password": "Ingresa una contraseña para continuar.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Intenta nuevamente en unos minutos.",
  "auth/network-request-failed": "No se pudo conectar con Firebase. Revisa tu conexion.",
  "storage/unauthorized": "No tienes permisos para subir esta imagen.",
  "storage/canceled": "La subida de la imagen fue cancelada.",
};

export function getFirebaseErrorMessage(error, fallbackMessage) {
  if (!error?.code) {
    return fallbackMessage;
  }

  return FIREBASE_ERROR_MESSAGES[error.code] || fallbackMessage;
}
