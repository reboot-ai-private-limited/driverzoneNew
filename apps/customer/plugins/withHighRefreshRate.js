const { withMainActivity } = require('@expo/config-plugins');

/**
 * Asks Android for the display's highest refresh rate (90/120 Hz) instead of letting the OS
 * fall back to 60 Hz for an app that never asked. iOS gets the same via
 * `CADisableMinimumFrameDurationOnPhone` in app.json.
 */
const MARK = 'dz-high-refresh-rate';

module.exports = function withHighRefreshRate(config) {
  return withMainActivity(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    cfg.modResults.contents = src.replace(
      'super.onCreate(null)',
      `super.onCreate(null)
    // ${MARK}
    window.attributes = window.attributes.apply { preferredRefreshRate = 120f }`,
    );
    return cfg;
  });
};
