import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {workflowArchivePolicy} from './workflow-archive-upgrade.mjs';

// Published pre-R4 archives retain R3's ticket cells and precede R5/R6.
export default await workflowArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy,{beforeR4:true,beforeEmail:true});
