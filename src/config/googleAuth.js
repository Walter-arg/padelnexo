export const googleAuthConfig = {
  androidClientId: "553114005250-9mi9h1f9v9r2ogpn38sidiencn5fal3a.apps.googleusercontent.com",
  iosClientId: "",
  redirectUri: "com.padelnexo.app:/oauthredirect",
  webClientId: "553114005250-khcbjn19g7l892kaan1v5amv8mv5pns9.apps.googleusercontent.com",
};

export function hasGoogleAuthConfig(platform = "android") {
  if (platform === "ios") {
    return Boolean(googleAuthConfig.iosClientId);
  }

  if (platform === "web") {
    return Boolean(googleAuthConfig.webClientId);
  }

  return Boolean(googleAuthConfig.webClientId);
}
