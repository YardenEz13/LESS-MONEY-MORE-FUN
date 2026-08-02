module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // The app lives outside the npm workspace, so @sbr/core and the data
      // catalogs are reached by path rather than through node_modules.
      [
        'module-resolver',
        {
          alias: {
            '@sbr/core': '../../packages/core/src',
            '@sbr/data': '../../data',
          },
        },
      ],
    ],
  };
};
