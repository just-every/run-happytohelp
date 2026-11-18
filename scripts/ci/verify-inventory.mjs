import assert from 'node:assert/strict';
import {parse} from '../edition-authoring/vendor/yaml/index.mjs';

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

export function checkPushInventory(workflow, scripts) {
  const shards = parse(workflow).jobs.checks.strategy.matrix.include;
  assert.deepEqual(shards.map(({name}) => name).sort(), [...pushNames].sort(), 'Verify shard names must match the required checks');

  const journeyPaths = commands => commands.split(/\s+/).filter(arg => /^tests\/journeys\/[\w-]+\.mjs$/.test(arg));
  const browserJourneys = journeyPaths(scripts['test:browsers']);
  const expected = [...journeyPaths(scripts['test:routes']), ...browserJourneys];
  const actual = [];
  for (const {name, browser, commands} of shards) {
    const journeys = journeyPaths(commands);
    assert.ok(journeys.length, `Verify shard ${name} must run at least one journey`);
    assert.ok(browser === true || journeys.every(file => !browserJourneys.includes(file)), `Verify shard ${name} needs Chromium`);
    actual.push(...journeys);
  }
  assert.deepEqual(actual.sort(), expected.sort(), 'Verify must run each route and browser journey exactly once');
  return actual;
}
