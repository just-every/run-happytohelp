import test from 'node:test';
import {portableRestoreJourney} from '../helpers/recovery/portable-journey.mjs';

test('public rer export and confirmed import preserve a destroyed native installation: original password, business history, private files and erasure fences survive while sessions and machine grants retire',{timeout:10*60_000},portableRestoreJourney);
