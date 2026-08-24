const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withShareExtension } = require('expo-share-extension/metro');

const projectRoot = __dirname;
const config = withShareExtension(getDefaultConfig(projectRoot));
// Paylaşılan parser: supabase/functions/_shared/roster-pdf/ (barrel: pdfRosterImport.ts)
config.watchFolders = [path.resolve(projectRoot, '..')];
// Monorepo parent izlenirken paket çözümleme yanlışlıkla repo root'a kayabiliyor.
// Runtime helper'ları her zaman mobil uygulamanın node_modules'undan çöz.
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
  // Do not set disableHierarchicalLookup: nested deps (e.g. simple-swizzle → is-arrayish)
  // live under package-local node_modules and must still resolve.
};

module.exports = config;
