import test from 'node:test';
import {priorSchemaUpgrade} from '../reports/prior-schema-upgrade.mjs';

test('a native historical installation upgrades once, preserving its owner password, transcripts and files, conservative reports and private attachment access while new human answers establish honest cycles',{timeout:10*60_000},priorSchemaUpgrade);
