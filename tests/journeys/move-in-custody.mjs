import test from 'node:test';
import {custodyLifecycle} from '../move-in/custody-lifecycle.mjs';
test('stopped publication preserves native work through resume and undo, then customer erasure removes source custody and fences replay while peers survive',custodyLifecycle);
