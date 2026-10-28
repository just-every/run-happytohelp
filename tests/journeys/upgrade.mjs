import test from 'node:test'
import {priorSchemaUpgrade} from '../reports/prior-schema-upgrade.mjs'

test('a packaged install populated before the outcome, integration, mail and import stages upgrades in place: prior rows, schema outside listed additions, stored files and search survive, and the upgraded Worker reads them back',{timeout:10*60_000},priorSchemaUpgrade)
