import test from 'node:test';
import {importLifecycle} from '../move-in/lifecycle.mjs';
test('review, publish, resume, replay and exactly undo four vendor histories without sending or exposing private notes',importLifecycle);
