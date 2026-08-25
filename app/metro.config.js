const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
// Allow imports from the shared package outside the app root.
config.watchFolders = [path.resolve(__dirname, "../shared")];

module.exports = config;
