import assert from 'node:assert/strict'
import {isSearchShadow} from '../helpers/search-index.mjs'

// RL-2's closed table allowlist. This is independent of businessSnapshot's filter:
// a new journal/counter requires an explicit policy decision; a business table
// can never disappear merely because its name starts with move_in_ or ik_.
const accounting=new Set([

 '_cf_METADATA','sqlite_sequence','abuse_counters','management_audit','native_integration_audit','audit_events',
 'ik_jobs','ik_original_sets','ik_originals','ik_sources','ik_provenance','ik_stages','ik_batches','ik_targets',
 'ik_d1_plan_chunks','ik_d1_original_chunks','ik_d1_history','ik_d1_entries','ik_d1_assertions',
 'ik_d1_creation_plans','ik_d1_reversal_reports',
 'ik_d1_streams','ik_d1_stream_pages','ik_d1_indexed_jobs','ik_d1_plan_index','ik_d1_stream_origins','ik_d1_stream_revisions','ik_d1_publication_fences','ik_d1_staging','ik_d1_staging_pages','ik_d1_staging_chunks','ik_d1_staging_index','ik_d1_staging_originals','ik_d1_custody_revisions','ik_d1_native_staging','ik_d1_native_staging_index','ik_d1_native_staging_values','ik_d1_custody_states','ik_d1_preparation_receipts','ik_d1_staging_headers',
 // rer 0.2.42 import-kit custody: reversal fences, cross-request preparation steps, person-erasure retirement and its journal.
 'ik_d1_reversal_fences','ik_d1_preparation_steps','ik_d1_stream_sources','ik_d1_retirements','ik_d1_erasure_journal','ik_d1_erasure_tally','ik_d1_erasure_progress',
 'move_in_runs','move_in_records','move_in_batches','move_in_identity_links',

])
export function assertEqualityPolicy(raw,business,excluded){
 assert.deepEqual([...excluded].sort(),[...accounting].sort(),'only platform counters/sequences, audit history and import journals are excluded')
 const expected=Object.keys(raw).filter(name=>!accounting.has(name)&&!isSearchShadow(raw[name]))
 assert.deepEqual(Object.keys(business),expected,'every other business table participates')
 for(const name of expected){
  if(name==='move_in_contact_keys'){
   assert.deepEqual(business[name],raw[name].map(({email_digest,...link})=>link),'only independently validated digest memoization is normalized; no contact link is omitted')
  }else assert.deepEqual(business[name],raw[name],`all columns and rows participate: ${name}`)
 }
 // Physical SQLite FTS segment pages are validated against authoritative content
 // by snapshotDatabase; the virtual index and source messages remain in equality.
 for(const [name,rows] of Object.entries(raw))if(isSearchShadow(rows)){
  assert.match(name,/^inbox_message_search_(data|idx|content|docsize|config)$/)
  assert.ok(Object.hasOwn(business,'inbox_message_search'))
  assert.ok(Object.hasOwn(business,'messages'))
 }
}

// The existing built-browser journey calls this once, at its desktop width.
// No new test registration or configuration-import scenario is introduced.
export async function reviewExplanations(page,origin,base,shot){
 const filename='outcome-explanations.jsonl',stamp='2024-01-01T00:00:00Z'
 const records=[
  {user:{id:87001,role:'end-user',name:'Review person',email:'review-outcome@example.test',created_at:stamp,user_fields:{legacy:'keep in source'}}},
  {macro:{id:87002,title:'Restricted reply',restriction:{type:'Group',id:1},created_at:stamp,updated_at:stamp,actions:[{field:'comment_value',value:'Private terms'}]}},
  {user:{id:87003,role:'end-user',name:'First identity',email:'first-review@example.test',created_at:stamp}},
  {user:{id:87003,role:'end-user',name:'Changed identity',email:'changed-review@example.test',created_at:stamp}},
 ]
 await page.setViewportSize({width:1440,height:1000})
 await page.goto(origin+base+'/move-in')
 await page.getByLabel('Export format',{exact:true}).selectOption('zendesk')
 await page.getByLabel('Export file',{exact:true}).setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(records.map(JSON.stringify).join('\n'))})
 await page.getByRole('button',{name:'Upload and review',exact:true}).click()
 await page.getByRole('heading',{name:`Ready for review: ${filename}`,exact:true}).waitFor({timeout:120000})
 for(const summary of await page.locator('.move-in-page details summary').all())if(!await summary.locator('..').getAttribute('open').then(value=>value!==null))await summary.click()
 for(const [record,line,reason] of [
  ['Zendesk user 87001',1,'Custom fields stay in your original file.'],
  ['Zendesk macro 87002',2,'This saved reply has a restricted audience that cannot be preserved.'],
  ['Zendesk user 87003',4,'The export contains conflicting records for this ID.'],
 ]){
  const row=page.locator('.move-in-details li').filter({hasText:record}).filter({hasText:reason}).first()
  await row.waitFor();const text=await row.innerText()
  assert.ok(text.includes(reason),`${record}: plain review reason`)
  assert.ok(text.includes(`${filename}, line ${line}`),`${record}: each plain reason shows its source location`)
 }
 assert.doesNotMatch(await page.locator('.move-in-page').innerText(),/restricted_macro_not_imported|conflicting_duplicate_id|custom_fields_retained_in_original_only/,'review shows plain reasons, never engine codes')
 // Assertions run once at 1440; show the changed review at both proof widths.
 await page.screenshot({path:shot('outcome-explanations-1440.png'),fullPage:true})
 await page.setViewportSize({width:390,height:1000})
 await page.screenshot({path:shot('outcome-explanations-390.png'),fullPage:true})
 await page.setViewportSize({width:1440,height:1000})
}
