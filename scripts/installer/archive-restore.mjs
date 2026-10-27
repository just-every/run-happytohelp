import {asyncWorkRestoreSql} from './async-work-archive.mjs';
import {triageRestoreSql} from './triage-archive.mjs';
import {ticketRestoreSql} from './ticket-archive-upgrade.mjs';
import {r4RestoreSql} from './r4-tables.mjs';
import {reportRestoreSql} from './report-archive.mjs';
import {trainingRestoreSql} from './training-archive.mjs';
import {workflowRestoreSql} from './workflow-archive-safety.mjs';
import {workflowLegacyRestoreSql} from './workflow-archive-defaults.mjs';

// Finish the seed restore before admitting application reads or writes. Base
// restores authoritative rows while business triggers are suspended.
export async function finishArchiveRestore(execute,{upgradeWorkflows=false}={}) {
  if(upgradeWorkflows)await execute('Preparing restored workflow defaults',workflowLegacyRestoreSql);
  await execute('Preparing restored ticket statuses',ticketRestoreSql);
  await execute('Preparing restored saved replies',r4RestoreSql);
  // Ticket normalization can journal a restored conversation through live
  // triggers. Fence that work as well as the archived commands before completion.
  await execute('Fencing archived triage work',triageRestoreSql);
  await execute('Fencing archived workflow actions',workflowRestoreSql);
  await execute('Fencing restored report schedules and bulk replies',reportRestoreSql);
  await execute('Fencing restored evaluations',trainingRestoreSql);
  await execute('Fencing restored background work',asyncWorkRestoreSql);
  await execute('Rebuilding conversation search',"INSERT INTO inbox_message_search(inbox_message_search) VALUES('rebuild')");
}
