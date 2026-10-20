import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {beforeTriagePolicy} from './triage-archive.mjs';
export default await beforeTriagePolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy);
