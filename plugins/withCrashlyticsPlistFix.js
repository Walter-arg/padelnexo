const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// TEMPORAL: el script de subida de simbolos de @react-native-firebase/crashlytics
// busca GoogleService-Info.plist en la raiz de ios/ (PROJECT_DIR), pero Expo lo
// coloca junto al resto del target nativo (ios/<AppName>/GoogleService-Info.plist).
// Bug conocido, todavia sin version oficial publicada:
// https://github.com/invertase/react-native-firebase/issues/9304
// Se puede borrar este plugin (y su referencia en app.json) cuando se actualice
// a una version de @react-native-firebase/crashlytics que ya traiga el arreglo.
module.exports = function withCrashlyticsPlistFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const sourcePlist = path.join(config.modRequest.projectRoot, "GoogleService-Info.plist");
      const destPlist = path.join(config.modRequest.platformProjectRoot, "GoogleService-Info.plist");

      if (fs.existsSync(sourcePlist)) {
        fs.copyFileSync(sourcePlist, destPlist);
      }

      return config;
    },
  ]);
};
