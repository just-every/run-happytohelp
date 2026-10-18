import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {workflowArchivePolicy} from './workflow-archive-upgrade.mjs';

// Published pre-ticket archives also precede R4, R5 and mailbox storage.
export default await workflowArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy,{beforeTickets:true,beforeR4:true,beforeEmail:true});
