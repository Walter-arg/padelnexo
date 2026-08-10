import { auth } from "../../services/firebaseConfig";
import devLog from "../utils/devLog";

const ADMIN_FUNCTIONS_BASE_URL =
  "https://southamerica-east1-padelnexo-7e4d5.cloudfunctions.net";

// Cliente para las Cloud Functions administrativas: el propio servidor
// verifica con el ID token de Firebase Auth que quien llama es admin, ya que
// las reglas de Firestore no permiten que un usuario escriba el documento de
// otro usuario ni se autoasigne rol/plan/estado admin.
export async function callAdminAction(functionName, body = {}) {
  if (!auth.currentUser) {
    throw new Error("No hay una sesion activa.");
  }

  const idToken = await auth.currentUser.getIdToken();

  let response;

  try {
    response = await fetch(`${ADMIN_FUNCTIONS_BASE_URL}/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    devLog(`[adminActionsClient] ${functionName} network error:`, error?.message || error);
    throw new Error("No pudimos conectar con el servidor. Revisa tu conexion.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    devLog(`[adminActionsClient] ${functionName} error:`, data?.error);
    throw new Error("No pudimos completar la accion administrativa.");
  }

  return response.json().catch(() => ({}));
}
