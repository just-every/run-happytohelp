import {any,either,journeys} from '../journeys/kit/scenarios.mjs';

// Every Move in scenario module, imported once so each journey sees the whole registry.
for(const module of ['door-readers','door-mapping','admission','empty-native','envelope-native','nested-native','record-native','parse-accounting','shape-syntax','limits','formats','security','partitions','publication-correction','publication-resume','native-corrections','custody-regressions','identity-correction','shape-custody','helpscout-security','empty-upgrade','envelope-upgrade','nested-upgrade','record-upgrade','shape-upgrade','migration'])await import(`./${module}.mjs`);


// The nine Move in journeys and the scenarios each one owns. Selection is by
// claim; a scenario owned by no journey, or by two, fails every journey file.
export const claims={
 refusals:['refused uploads are located at their exact source place before any custody, queue, native write or outbound call',either(
  any('door-readers',/^size, depth/,/^empty-looking/,/^ZIP members/),any('admission',/^unindexable/,/^bounded identity/,/^multipart/),any('empty-native',/refuse all empty uploads/),
  any('envelope-native',/^every invalid directory/),any('nested-native',/^all nested wrapper/),any('record-native',/^ambiguous documents/),any('parse-accounting',/^malformed positions/),
  any('shape-syntax'),any('security',/^real upload route/,/^source record limits/))],
 review:['an accepted export is reviewed with each record\'s kind, ID, payload, exact location, duplicates, conflicts and reasons before anything is approved',either(
  any('door-readers',/^every supported envelope/,/^untyped nested/,/^record discrimination/,/^Zendesk singular/),any('empty-native',/blank auxiliary members/),any('parse-accounting',/^repeated source/),
  any('security',/generated diagnostics/,/seeded 1,000/,/^malformed line and conflicting/),any('limits',/^derived unique tag/,/3,000-ticket/,/400-comment/),any('native-corrections',/^native macro HTML/))],
 landing:['an approved import lands each vendor\'s history, people, replies, notes, tags and knowledge exactly, keeps notes private, and repeats or repackages as a no-op',either(
  any('door-mapping',/^Zendesk history/,/^Zendesk macros/,/^Intercom lists/,/^Freshdesk/,/^one Intercom source/),any('formats',/private ZIP upload/),any('record-native',/^separate typed/),any('envelope-native',/^unknown parent records map/),
  any('security',/^an admin can review/,/^a differently packaged/,/^imported private notes/),any('partitions',/^a matching prior native tag/),any('limits',/200-comment/))],
 publication:['publication meets later native changes safely: conflicts stop it before any write, a stopped publication resumes or undoes exactly, and guards stay bounded',either(
  any('publication-correction'),any('publication-resume'),any('native-corrections',/^planning reads/,/^email collision index/,/^oversized relevant native/),any('partitions',/^one immutable review/))],
 recovery:['interrupted work resumes from durable state after a killed Worker, a broken checkpoint or tampered originals, without duplicating history',either(
  any('envelope-native',/^directory-heavy/),any('nested-native',/^known record payloads/),any('security',/^a killed/,/^one D1 budget/),any('partitions',/^process restart/,/^group original tampering/),
  any('native-corrections',/^reserved original uploads/),any('custody-regressions',/^conditional custody/))],
 authority:['only a current owner or admin with a live session advances an import, and undo stops rather than overwrite later native work',either(
  any('security',/^tenant\/role/,/^native same-revision/,/^authority lost inside/,/^native dependents/,/references stop undo/),any('partitions',/^queued batches reject/),
  any('native-corrections',/^erasure and raw-upload admission/))],
 erasure:['erasing a contact removes every import custody that holds them and refuses any later upload carrying their aliases, while other people\'s data stays',either(
  any('admission',/^presentation truncation/),any('envelope-native',/^unknown parents retain/),any('record-native',/root JSON retains/),any('shape-custody'),any('identity-correction'),
  any('native-corrections',/native contact erasure fences/,/^incomplete raw input/,/^missing source IDs/),any('custody-regressions',/^erasure retains/,/^unrecognized identity-bearing/),
  any('partitions',/^erasure /),any('security',/^contact erasure removes/,/^erasure reconciles/,/cross-conversation source-author/))],
 upgrade:['imports recorded before the identity audit upgrade conservatively: prior rows stay byte-equal, old originals are reindexed or fenced, and erasure still holds',either(
  any('empty-upgrade'),any('envelope-upgrade'),any('nested-upgrade'),any('record-upgrade'),any('shape-upgrade'),any('migration'))],
 helpscout:['Help Scout conversations and Docs publish only complete public content, recheck category privacy, and keep undo and erasure safe',either(
  any('helpscout-security'),any('door-mapping',/^Help Scout/),any('formats',/^Help Scout/))],
};

export const journey=journeys(claims);
