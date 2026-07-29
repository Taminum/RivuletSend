const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Monorepo setup: watch the repo root so Metro sees @p2p/shared's TS source, and
// let it resolve modules from both this package and the hoisted root store.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = {
  projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // pnpm symlinks packages; Metro must follow them to the real files.
    unstable_enableSymlinks: true,
    // @p2p/shared is TS authored in ESM style ("./roomCode.js" importing
    // roomCode.ts). TS/Vite/node map .js->.ts, but Metro doesn't — so on a failed
    // relative .js import, retry without the extension to hit the .ts source.
    resolveRequest: (context, moduleName, platform) => {
      try {
        return context.resolveRequest(context, moduleName, platform);
      } catch (err) {
        if (/^\.\.?\//.test(moduleName) && moduleName.endsWith('.js')) {
          return context.resolveRequest(context, moduleName.slice(0, -3), platform);
        }
        throw err;
      }
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
