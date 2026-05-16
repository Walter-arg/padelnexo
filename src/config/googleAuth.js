export const googleAuthConfig = {
  androidClientId: "553114005250-khcbjn19g7l892kaan1v5amv8mv5pns9.apps.googleusercontent.com",
  iosClientId: "",
  webClientId: "553114005250-khcbjn19g7l892kaan1v5amv8mv5pns9.apps.googleusercontent.com",
};

export function hasGoogleAuthConfig(platform = "android") {
  if (platform === "ios") {
    return Boolean(googleAuthConfig.iosClientId);
  }

  if (platform === "web") {
    return Boolean(googleAuthConfig.webClientId);
  }

  return Boolean(googleAuthConfig.androidClientId);
}
