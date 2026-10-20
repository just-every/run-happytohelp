import previous from './report-archive-policy.mjs';
import {triageTables} from './triage-archive.mjs';
// Pre-report archives also predate triage; preserve their supported inventory.
export default {...previous,excludeTables:[...previous.excludeTables,...triageTables]};
