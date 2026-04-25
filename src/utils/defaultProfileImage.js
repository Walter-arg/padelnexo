export function hasProfileImage(uri) {
  return typeof uri === "string" && uri.trim().length > 0;
}

export function getProfileImageUri(uri) {
  return hasProfileImage(uri) ? uri : "";
}

