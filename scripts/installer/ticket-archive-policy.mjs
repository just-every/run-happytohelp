import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {ticketArchivePolicy} from './ticket-archive-upgrade.mjs';
import {r4Tables} from './r4-tables.mjs';

// Pre-ticket archives have no ticket definition/value/history/view tables. Keep
// their exact table inventory while upgrading the new conversation columns.
// The installer selects this seed-owned module only for recognized old schemas;
// current archives use the complete ordinary policy and carry all ticket stores.
const ticketTables=['ticket_statuses','ticket_groups','ticket_group_members','ticket_fields','ticket_field_values','ticket_history','ticket_views'];
export default await ticketArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),{
 ...archivePolicy,excludeTables:[...archivePolicy.excludeTables,...ticketTables,...r4Tables],
});
