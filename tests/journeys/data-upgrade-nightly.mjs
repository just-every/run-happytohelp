import test from 'node:test';
import {moveInMigrationJourney} from '../move-in/migration.mjs';
import {legacyCustodyJourney} from '../move-in/empty-upgrade.mjs';
import {integrationMigrationJourney} from '../connections/migration.mjs';
test('native import upgrades retain populated business history',moveInMigrationJourney);
test('legacy unaudited source custody stays fenced through erasure',legacyCustodyJourney);
test('integration upgrade preserves native history and an existing bearer grant without replay',integrationMigrationJourney);
