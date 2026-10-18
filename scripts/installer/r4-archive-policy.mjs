import {fileURLToPath} from 'node:url';
import {archivePolicy} from './portability-policy.mjs';
import {ticketArchivePolicy} from './ticket-archive-upgrade.mjs';
import {emailArchiveTables} from './email-archive-tables.mjs';
import {r4Tables} from './r4-tables.mjs';
/** Recognize only the native pre-R4 migration history, with R3's ticket cells intact. */
export default await ticketArchivePolicy(fileURLToPath(new URL('../../',import.meta.url)),{
 ...archivePolicy,excludeTables:[...new Set([...archivePolicy.excludeTables,...r4Tables,...emailArchiveTables])],
},name=>/^1[46][0-9]_/.test(name));
