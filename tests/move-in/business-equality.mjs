import {assertEqualityPolicy} from './outcomes-policy.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isSearchShadow} from '../helpers/search-index.mjs';
// Owner decision 2026-10-09. Only named platform accounting, audit and import
// journal tables are excluded. Every other business table (including move_in_* business
// notes, source links, origins and identity/erasure state) participates.
// SQLite-proven FTS shadow pages are retained raw and content-validated; the
// virtual index projection and every authoritative message row still compare.
const excluded=new Set([
 '_cf_METADATA','sqlite_sequence','abuse_counters','management_audit','native_integration_audit','audit_events',
 'ik_jobs','ik_original_sets','ik_originals','ik_sources','ik_provenance','ik_stages','ik_batches','ik_targets',
 'ik_d1_plan_chunks','ik_d1_original_chunks','ik_d1_history','ik_d1_entries','ik_d1_assertions',
 'ik_d1_creation_plans','ik_d1_reversal_reports',
 'ik_d1_streams','ik_d1_stream_pages','ik_d1_indexed_jobs','ik_d1_plan_index','ik_d1_stream_origins','ik_d1_stream_revisions','ik_d1_publication_fences','ik_d1_staging','ik_d1_staging_pages','ik_d1_staging_chunks','ik_d1_staging_index','ik_d1_staging_originals','ik_d1_custody_revisions','ik_d1_native_staging','ik_d1_native_staging_index','ik_d1_native_staging_values','ik_d1_custody_states','ik_d1_preparation_receipts','ik_d1_staging_headers',
 // rer 0.2.42 import-kit custody: reversal fences, cross-request preparation steps, person-erasure retirement and its journal.
 'ik_d1_reversal_fences','ik_d1_preparation_steps','ik_d1_stream_sources','ik_d1_retirements','ik_d1_erasure_journal','ik_d1_erasure_tally','ik_d1_erasure_progress',
 'move_in_runs','move_in_records','move_in_batches','move_in_identity_links',
]);
export function businessSnapshot(snapshot){
 const result=Object.fromEntries(Object.entries(snapshot).filter(([name,rows])=>!excluded.has(name)&&!isSearchShadow(rows)));
 // Admission's lazy digest memoization is derived platform state, not contact
 // content. Keep every project/contact link and validate any populated digest
 // independently against the exact native email. Never omit the whole table.
 if(result.move_in_contact_keys)result.move_in_contact_keys=result.move_in_contact_keys.map(({email_digest,...link})=>{
  const contact=snapshot.contacts.find(row=>row.id===link.contact_id&&row.project_id===link.project_id);
  assert.ok(contact&&typeof contact.email==='string','contact-key link resolves inside its workspace');
  const expected=createHash('sha256').update(JSON.stringify(['move-in-erasure',link.project_id,'email',contact.email.trim().toLowerCase()])).digest('hex');
  assert.ok(email_digest===null||email_digest===expected,'populated admission digest matches native email');
  return link;
 });
 assertEqualityPolicy(snapshot,result,excluded);
 return result;
}
export function assertBusinessEquality(before,after){
 const first=businessSnapshot(before),last=businessSnapshot(after);
 assert.deepEqual(Object.keys(last),Object.keys(first),'same business table inventory');
 for(const name of Object.keys(first)){if(JSON.stringify(last[name])!==JSON.stringify(first[name]))console.log(JSON.stringify({proof:'business-difference',table:name,beforeRows:first[name].length,afterRows:last[name].length}));assert.equal(JSON.stringify(last[name]),JSON.stringify(first[name]),'business equality: '+name);}
}
export function journalAccounting(before,after){return Object.keys(after).filter(name=>excluded.has(name)).map(table=>({table,beforeRows:before[table]?.length??0,afterRows:after[table].length,identical:JSON.stringify(before[table])===JSON.stringify(after[table])}))}
