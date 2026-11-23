import test from 'node:test'
import {releaseUpgrades} from '../helpers/release-upgrade.mjs'

// Build the declared predecessor and the pinned historical baselines from their own sources.
// Push CI selects the predecessor through H2H_UPGRADE_RELEASES, a comma-separated list of versions.
test('every published release, populated through its own API, upgrades in place to this source with exactly the missing migrations in order and every prior row and file kept',{timeout:90*60_000},()=>releaseUpgrades(process.env.H2H_UPGRADE_RELEASES?.split(',')))
