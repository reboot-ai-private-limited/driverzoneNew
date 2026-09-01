/**
 * `babel-preset-expo` already includes the expo-router and react-native-reanimated plugins when
 * those packages are installed (SDK 51+). Listing either one here as well makes Babel apply it
 * twice, which for reanimated's worklet transform is not harmless — so this file stays empty
 * of plugins on purpose.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
