import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {workflowArchivePolicy} from './workflow-archive-upgrade.mjs';

// Keep main's pre-R4/R6 inventory fence and R5's workflow-aware upgrade.
export default await workflowArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),archivePolicy,{beforeR4:true,beforeEmail:true});
