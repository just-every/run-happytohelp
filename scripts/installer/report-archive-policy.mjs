import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {beforeReportPolicy} from './report-archive.mjs';
export default await beforeReportPolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy);
