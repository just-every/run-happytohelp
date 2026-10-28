import test from 'node:test';
import {figuresJourney} from '../reports/figures.mjs';
import {ratingsJourney} from '../reports/ratings.mjs';
import {teamReportsJourney} from '../reports/team-journey.mjs';
test('workspace calendar reports export complete safe cohorts and transcripts under current brand authority',figuresJourney);
test('visible answer provenance and visitor rerating follow resolution cycles through reopening and erasure',ratingsJourney);
test('public multichannel tickets reconcile team reports and one scheduled delivery',teamReportsJourney);
