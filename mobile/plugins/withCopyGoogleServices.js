const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

// In root android/build.gradle, projectDir = android/ → write to app/google-services.json
const ROOT_GRADLE_INJECTION = `
// FlyFam: write google-services.json from EAS Secret (runs first when Gradle starts)
def googleservicesJson = System.getenv("GOOGLE_SERVICES_JSON")
if (googleservicesJson != null && !googleservicesJson.isEmpty()) {
    def f = new File(projectDir, "app/google-services.json")
    f.getParentFile().mkdirs()
    f.text = googleservicesJson.trim()
}
`;

/**
 * Copies google-services.json from project root to android/app/ during prebuild
 * and injects Gradle code so EAS can write it from GOOGLE_SERVICES_JSON at build time.
 *
 * EAS Build: Set EAS Secret GOOGLE_SERVICES_JSON to the full JSON content.
 */
function withCopyGoogleServices(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      // EAS may use repo root as projectRoot; file can be at projectRoot or projectRoot/mobile
      const possibleSrcPaths = [
        path.join(projectRoot, 'google-services.json'),
        path.join(projectRoot, 'mobile', 'google-services.json'),
      ];
      let src = possibleSrcPaths.find((p) => fs.existsSync(p)) || possibleSrcPaths[0];
      const androidRoot = config.modRequest.platformProjectRoot || path.join(projectRoot, 'android');
      const appDir = path.join(androidRoot, 'app');
      const rootBuildGradlePath = path.join(androidRoot, 'build.gradle');
      const appBuildGradlePath = path.join(appDir, 'build.gradle');

      const jsonFromEnv = process.env.GOOGLE_SERVICES_JSON;
      if (jsonFromEnv) {
        const content = jsonFromEnv.trim();
        const dirs = [
          appDir,
          path.join(appDir, 'src'),
          path.join(appDir, 'src', 'release'),
        ];
        for (const dir of dirs) {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'google-services.json'), content, 'utf8');
        }
        fs.writeFileSync(path.join(projectRoot, 'google-services.json'), content, 'utf8');
      } else if (fs.existsSync(src)) {
        const content = fs.readFileSync(src, 'utf8');
        const destDirs = [
          appDir,
          path.join(appDir, 'src'),
          path.join(appDir, 'src', 'release'),
        ];
        for (const dir of destDirs) {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'google-services.json'), content, 'utf8');
        }
      } else {
        throw new Error(
          `[withCopyGoogleServices] google-services.json not found at ${possibleSrcPaths.join(' or ')} and EAS Secret GOOGLE_SERVICES_JSON is not set. ` +
            `Commit mobile/google-services.json or add GOOGLE_SERVICES_JSON in Expo Secrets.`
        );
      }

      // Root build.gradle runs first in Gradle → file exists before :app:processReleaseGoogleServices
      if (fs.existsSync(rootBuildGradlePath)) {
        let content = fs.readFileSync(rootBuildGradlePath, 'utf8');
        if (!content.includes('GOOGLE_SERVICES_JSON')) {
          content = ROOT_GRADLE_INJECTION + content;
          fs.writeFileSync(rootBuildGradlePath, content, 'utf8');
        }
      }
      // Fallback: app/build.gradle (in case root order differs on EAS)
      if (fs.existsSync(appBuildGradlePath)) {
        const appInjection = `
// FlyFam: write google-services.json from EAS Secret
def googleservicesJson = System.getenv("GOOGLE_SERVICES_JSON")
if (googleservicesJson != null && !googleservicesJson.isEmpty()) {
    new File(projectDir, "google-services.json").text = googleservicesJson.trim()
}
`;
        let content = fs.readFileSync(appBuildGradlePath, 'utf8');
        if (!content.includes('GOOGLE_SERVICES_JSON')) {
          content = appInjection + content;
          fs.writeFileSync(appBuildGradlePath, content, 'utf8');
        }
      }

      return config;
    },
  ]);
}

module.exports = withCopyGoogleServices;
