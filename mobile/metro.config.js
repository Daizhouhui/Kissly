const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Temporary local-debug tweak: let Metro use watchman on Windows instead of the
// per-directory fallback watcher (19031 dirs -> 4min startup timeout).
config.resolver.useWatchman = true;

config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== 'html'
);
config.resolver.assetExts.push('html');

module.exports = config;
