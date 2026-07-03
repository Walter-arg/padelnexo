const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const escapePathForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const projectRootPattern = escapePathForRegex(__dirname.replace(/\\/g, "/"));
const rootOnly = (folderName) =>
  new RegExp(`${projectRootPattern}[\\\\/]${folderName}[\\\\/].*`);

config.resolver.blockList = [
  /node_modules[\\/]\.bin([\\/].*)?$/,
  rootOnly(".git"),
  rootOnly(".expo"),
  rootOnly("dist"),
  rootOnly("temp-export"),
];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const firebaseAliases = {
    "@firebase/app": path.resolve(__dirname, "node_modules/@firebase/app"),
    "@firebase/component": path.resolve(__dirname, "node_modules/@firebase/component"),
    "@firebase/logger": path.resolve(__dirname, "node_modules/@firebase/logger"),
    "@firebase/util": path.resolve(__dirname, "node_modules/@firebase/util"),
  };

  if (firebaseAliases[moduleName]) {
    return context.resolveRequest(context, firebaseAliases[moduleName], platform);
  }

  if (moduleName === "memoize-one") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "src/vendor/memoizeOne.js"),
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.cacheVersion = "usb-v3";

module.exports = config;
