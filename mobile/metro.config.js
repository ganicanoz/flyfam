const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withShareExtension } = require('expo-share-extension/metro');

const projectRoot = __dirname;
const config = withShareExtension(getDefaultConfig(projectRoot));
// Paylaşılan parser: supabase/functions/_shared/roster-pdf/ (barrel: pdfRosterImport.ts)
config.watchFolders = [path.resolve(projectRoot, '..')];

const previousResolveRequest = config.resolver?.resolveRequest;

// Bare `metro start` (start-metro-direct.js) Expo CLI tsconfigPaths wrapper'ını kullanmaz.
// tsconfig `@/*` → `./*` alias'ını burada çöz.
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
  // Do not set disableHierarchicalLookup: nested deps (e.g. simple-swizzle → is-arrayish)
  // live under package-local node_modules and must still resolve.
  resolveRequest(context, moduleName, platform) {
    if (typeof moduleName === 'string' && moduleName.startsWith('@/')) {
      const rewritten = path.resolve(projectRoot, moduleName.slice(2));
      return context.resolveRequest(context, rewritten, platform);
    }
    if (typeof previousResolveRequest === 'function') {
      return previousResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
