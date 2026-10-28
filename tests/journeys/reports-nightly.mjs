import test from 'node:test';
import {reportScaleJourney} from '../reports/figures.mjs';
test('reports and transcript exports retain every row above ten thousand conversations',reportScaleJourney);
