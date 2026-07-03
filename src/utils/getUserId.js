export function getUserId(userData) {
  return String(userData?.uid || userData?.id || "").trim();
}
