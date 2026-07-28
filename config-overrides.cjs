module.exports = function override(config, _env) {
  // Suppress broken source-map warnings from third-party packages by disabling
  // source-map-loader for everything inside node_modules. CRA places the
  // source-map-loader as a top-level rule before the oneOf block.
  config.module.rules.forEach((rule) => {
    if (
      rule &&
      typeof rule.loader === "string" &&
      rule.loader.includes("source-map-loader")
    ) {
      rule.exclude = [/node_modules/];
    }
  });
  return config;
};
