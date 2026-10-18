import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {workflowArchivePolicy} from './workflow-archive-upgrade.mjs';

// Published pre-R6 archives can also predate R5's workflow stores. Keep
// their exact native inventory while restoring the declared mailbox default.
export default await workflowArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy,{beforeEmail:true});
