// Seed-owned proof names; commands remain in the two workflow matrices.
export const pushNames = [
  "identity-and-desk",
  "assistant-and-knowledge",
  "connections-and-computers",
  "import-and-reports",
  "support-workflow-browser",
  "support-and-recovery",
  "identity-and-repair-browser",
  "public-and-import-browser"
];
export const nightlyNames = [
  "native-command-and-portability",
  "readme-clone-and-restore",
  "reproducible-build",
  "delegation-fresh-clone-browser",
  "offline-deployment-preflight",
  "portable-installation-compatibility",
  "import-and-report-scale",
  "configured-live-provider",
  "release-upgrades"
];
export const pushProof = ['plan', 'build', 'full-push-proof', 'verify', ...pushNames.map(name => `Verify / ${name}`)];
export const nightlyProof = ['plan', 'nightly-proof', 'verify', 'legacy-export', ...nightlyNames.map(name => `Installer / ${name}`)];
export const verificationPlan = { push: pushNames.map(name => ({name})), nightly: nightlyNames.map(name => ({name})) };
