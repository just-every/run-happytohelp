import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {workflowArchivePolicy} from './workflow-archive-upgrade.mjs';
export default await workflowArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy,{beforeTickets:true});
