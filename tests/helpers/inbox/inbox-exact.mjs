import assert from 'node:assert/strict'
import {assertInboxDerived} from './derived.mjs'

// The inbox's views, totals and counts as every conversation answers them: the definitions the inbox read
// before it kept derived entries and tallies (src/modules/management/README.md, "Inbox reads at scale").
// After any write, each door must answer exactly these. Members here hold no narrowed role.
const visible=`(EXISTS(SELECT 1 FROM messages im WHERE im.conversation_id=c.id) OR EXISTS(SELECT 1 FROM conversation_notes inn WHERE inn.conversation_id=c.id)) AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)`
const ai=`EXISTS(SELECT 1 FROM conversation_ai ca WHERE ca.conversation_id=c.id AND ca.ai_id IS NOT NULL)`
const sleeping=`EXISTS(SELECT 1 FROM workflow_schedules ws WHERE ws.conversation_id=c.id AND ws.kind='snooze' AND ws.state='pending')`
const unread=`EXISTS(SELECT 1 FROM messages msg WHERE msg.conversation_id=c.id AND msg.actor_role='contact' AND NOT EXISTS(SELECT 1 FROM move_in_message_sources ims WHERE ims.message_id=msg.id) AND msg.revision>coalesce((SELECT revision FROM conversation_reads WHERE conversation_id=c.id AND user_id=?1),0))`
const views=user=>({
 open:[`c.resolved_at IS NULL AND NOT ${ai}`],
 mine:[`c.resolved_at IS NULL AND NOT ${ai} AND c.assigned_to=?1`],
 unassigned:[`c.resolved_at IS NULL AND NOT ${ai} AND c.assigned_to IS NULL`],
 closed:[`c.resolved_at IS NOT NULL AND NOT ${ai}`],
 ai:[ai],
 all:[],
 unread:[`c.resolved_at IS NULL AND NOT ${ai} AND ${unread}`],
})
const counts=project=>`SELECT
 COALESCE(SUM(COALESCE(c.resolved_at,0)=0 AND c.assigned_to=?1 AND NOT ${ai}),0) mine,
 COALESCE(SUM(COALESCE(c.resolved_at,0)=0 AND NOT ${ai}),0) open,
 COALESCE(SUM(COALESCE(c.resolved_at,0)=0 AND COALESCE(c.assigned_to,'')='' AND NOT ${ai}),0) unassigned,
 COALESCE(SUM(EXISTS(SELECT 1 FROM conversation_ai ca JOIN ai_profiles a ON a.id=ca.ai_id WHERE ca.conversation_id=c.id)),0) ai,
 COALESCE(SUM(COALESCE(c.resolved_at,0)<>0 AND NOT ${ai}),0) closed,
 COALESCE(SUM(COALESCE(c.resolved_at,0)=0 AND ${unread}),0) unread,
 COALESCE(SUM(COALESCE(c.resolved_at,0)=0 AND NOT ${ai} AND ${sleeping}),0) snoozed
 FROM conversations c WHERE EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=c.project_id AND m.user_id=?1) AND ${visible} ${project?'AND c.project_id=?2':''}`

const literal=value=>`'${value.replaceAll("'","''")}'`
const tagged=values=>`EXISTS(SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id=c.id AND ct.project_id=c.project_id AND ct.tag_id IN (${values.map(literal).join(',')}))`
const tagsOf=`(SELECT json_group_array(tag_id) FROM (SELECT ct.tag_id FROM conversation_tags ct WHERE ct.project_id=c.project_id AND ct.conversation_id=c.id ORDER BY ct.tag_id))`
const unsolved=`c.status_category IN ('new','open','pending')`,unsolvedFilter={field:'status_category',operator:'in',value:['new','open','pending']}
const contains=term=>`instr(lower(coalesce(c.subject,'')),lower(${literal(term)}))>0`
const valueOf=field=>`(SELECT json_extract(v.value_json,'$') FROM ticket_field_values v WHERE v.project_id=c.project_id AND v.conversation_id=c.id AND v.field_id=${literal(field)})`
const priority="CASE c.priority WHEN 'low' THEN 0 WHEN 'normal' THEN 1 WHEN 'high' THEN 2 WHEN 'urgent' THEN 3 END"
// The shapes migration 319 bounds: subject terms (and a short one), a custom field equal, set and not equal, any, all
// and none of two tags, and created or updated before and after a moment, with statuses, an assignee (or both) and sorts.
const shaped=({tag,pair,field,moment})=>[
 [{filters:[{field:'subject',operator:'contains',value:'to-48200'}]},[contains('to-48200')]],
 [{filters:[{field:'subject',operator:'contains',value:'Order'},unsolvedFilter],sort:[{field:'updated_at',direction:'desc'}]},[contains('Order'),unsolved],'CAST(c.updated_at AS REAL) DESC,c.id DESC'],
 [{filters:[{field:'subject',operator:'contains',value:'TO'}]},[contains('TO')]],
 [{filters:[{field:`custom:${field}`,operator:'eq',value:'RMA-456'}]},[`${valueOf(field)}='RMA-456'`],undefined,true],
 [{filters:[{field:`custom:${field}`,operator:'is_not_empty'},{field:'assigned_to',operator:'eq',value:null}],sort:[{field:'created_at',direction:'asc'}]},[`NOT (${valueOf(field)} IS NULL OR ${valueOf(field)}='')`,'c.assigned_to IS NULL'],'CAST(c.created_at AS REAL) ASC,c.id DESC',true],
 [{filters:[{field:`custom:${field}`,operator:'ne',value:'RMA-456'},unsolvedFilter]},[`${valueOf(field)}!='RMA-456'`,unsolved],undefined,true],
 [{filters:[{field:'tags',operator:'in',value:[tag,pair]}],sort:[{field:'priority',direction:'desc'}]},[tagged([tag,pair])],`${priority} DESC,c.id DESC`],
 [{filters:[{field:'tags',operator:'in',value:[tag,pair]},{field:'status_category',operator:'eq',value:'open'},{field:'assigned_to',operator:'eq',value:null}],sort:[{field:'updated_at',direction:'desc'}]},[tagged([tag,pair]),"c.status_category='open'",'c.assigned_to IS NULL'],'CAST(c.updated_at AS REAL) DESC,c.id DESC'],
 [{filters:[{field:`custom:${field}`,operator:'ne',value:null},{field:'status_category',operator:'eq',value:'closed'}],sort:[{field:'priority',direction:'desc'}]},[`${valueOf(field)} IS NOT NULL`,"c.status_category='closed'"],`${priority} DESC,c.id DESC`,true],
 [{filters:[{field:'tags',operator:'eq',value:tag},unsolvedFilter,{field:'assigned_to',operator:'eq',value:null}],sort:[{field:'created_at',direction:'asc'}]},[tagged([tag]),unsolved,'c.assigned_to IS NULL'],'CAST(c.created_at AS REAL) ASC,c.id DESC'],
 [{filters:[{field:'tags',operator:'eq',value:tag},{field:'tags',operator:'eq',value:pair}]},[tagged([tag]),tagged([pair])]],
 [{filters:[{field:'tags',operator:'not_in',value:[tag,pair]},unsolvedFilter]},[`NOT ${tagged([tag,pair])}`,unsolved]],
 [{filters:[{field:'created_at',operator:'lt',value:moment}]},[`CAST(c.created_at AS REAL)<${moment}`]],
 [{filters:[{field:'created_at',operator:'gte',value:moment},{field:'status_id',operator:'ne',value:'solved'}],sort:[{field:'updated_at',direction:'desc'}]},[`CAST(c.created_at AS REAL)>=${moment}`,`c.status_id!='solved'`],'CAST(c.updated_at AS REAL) DESC,c.id DESC'],
 [{filters:[{field:'updated_at',operator:'gt',value:moment}],sort:[{field:'created_at',direction:'desc'}]},[`CAST(c.updated_at AS REAL)>${moment}`],'CAST(c.created_at AS REAL) DESC,c.id DESC'],
 // Sorts an imported view carries: by status, priority and conversation id, with a time bound, a status, a tag, a field.
 [{filters:[{field:'created_at',operator:'lt',value:moment},unsolvedFilter],sort:[{field:'status_id',direction:'asc'}]},[`CAST(c.created_at AS REAL)<${moment}`,unsolved],'c.status_id ASC,c.id DESC'],
 [{filters:[{field:'created_at',operator:'gte',value:moment}],sort:[{field:'id',direction:'desc'}]},[`CAST(c.created_at AS REAL)>=${moment}`],'c.id DESC'],
 [{filters:[{field:'updated_at',operator:'lt',value:moment},{field:'status_category',operator:'eq',value:'open'}],sort:[{field:'priority',direction:'asc'}]},[`CAST(c.updated_at AS REAL)<${moment}`,"c.status_category='open'"],`${priority} ASC,c.id DESC`],
 [{filters:[{field:'tags',operator:'eq',value:tag},{field:'status_category',operator:'eq',value:'closed'}],sort:[{field:'id',direction:'asc'}]},[tagged([tag]),"c.status_category='closed'"],'c.id ASC'],
 [{filters:[{field:`custom:${field}`,operator:'is_not_empty'},unsolvedFilter],sort:[{field:'status_id',direction:'asc'}]},[`NOT (${valueOf(field)} IS NULL OR ${valueOf(field)}='')`,unsolved],'c.status_id ASC,c.id DESC',true],
]
// Structured filters (as a saved or imported view writes them) read the same rows in the same order: ticket
// columns with a custom sort, a status, a tag (alone, among others, or excluded) and a sort led by tags.
const structured=({tag,...more})=>[
 [{filters:[{field:'priority',operator:'in',value:['normal','high','urgent']}],sort:[{field:'updated_at',direction:'desc'}]},[`c.priority IN ('normal','high','urgent')`],'CAST(c.updated_at AS REAL) DESC,c.id DESC'],
 [{filters:[{field:'status_id',operator:'ne',value:'solved'}]},[`c.status_id!='solved'`]],
 [{filters:[{field:'tags',operator:'eq',value:tag}]},[tagged([tag])]],
 [{filters:[{field:'tags',operator:'in',value:[tag,'tag-not-in-use']},{field:'status_id',operator:'ne',value:'solved'}]},[tagged([tag,'tag-not-in-use']),`c.status_id!='solved'`]],
 [{filters:[{field:'tags',operator:'not_in',value:[tag]}],sort:[{field:'tags',direction:'desc'}]},[`NOT ${tagged([tag])}`],`${tagsOf} DESC,c.id DESC`],
 ...shaped({tag,...more}),
].map(([query,conditions,order,workspace])=>({query:{filters:JSON.stringify(query.filters),...(query.sort?{sort:JSON.stringify(query.sort)}:{})},conditions,order,workspace}))

export function inboxExactness(app,w,{tag,company,pair,field,moment}){
 const filtered=structured({tag:tag.id,pair:pair.id,field,moment})
 const queries=[{view:'open'},{view:'mine'},{view:'unassigned'},{view:'closed'},{view:'ai'},{view:'all'},{view:'unread'},{snoozed:'only'},{view:'open',snoozed:'include'},{view:'open',assigned_to:w.users.operator},{view:'open',tag:tag.id},{view:'all',company},...filtered.map(entry=>entry.query)]
 const expected=async(query,user,project)=>{
  const filter=filtered.find(entry=>entry.query===query)
  const named=filter?filter.conditions:views(user)[query.view||'open'],conditions=[...named]
  if(query.assigned_to)conditions[0]=`c.resolved_at IS NULL AND NOT ${ai} AND c.assigned_to='${query.assigned_to.replaceAll("'","''")}'`
  if(query.snoozed==='only')conditions.push(sleeping);else if(query.snoozed!=='include')conditions.push(`NOT ${sleeping}`)
  if(query.tag)conditions.push(`EXISTS(SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id=c.id AND ct.project_id=c.project_id AND ct.tag_id='${query.tag.replaceAll("'","''")}')`)
  if(query.company)conditions.push(`EXISTS(SELECT 1 FROM contact_companies member JOIN companies account ON account.id=member.company_id AND account.project_id=member.project_id WHERE member.project_id=c.project_id AND member.contact_id=c.contact_id AND member.company_id=${literal(query.company)} AND account.merged_into IS NULL)`)
  const where=[`EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=c.project_id AND m.user_id=?1)`,visible,`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`,...(project?['c.project_id=?2']:[]),...conditions].join(' AND ')
  return (await app.sql(`SELECT c.id FROM conversations c WHERE ${where} ORDER BY ${filter?.order??'coalesce((SELECT created_at FROM messages WHERE id=c.last_message_id),c.updated_at) DESC,c.id DESC'}`,user,...(project?[project]:[]))).map(row=>row.id)
 }
 // Every view and filter, its order and total, and the counts, on both doors for the owner and a teammate.
 return async function exact(label){
  await assertInboxDerived(sql=>app.sql(sql),label)
  for(const role of ['owner','operator'])for(const project of [w.projectId,undefined]){
   const base=(project?`/api/dashboard/projects/${project}`:'/api/dashboard')+'/conversations',token=w.tokens[role],user=w.users[role]
   for(const query of queries){
    // The tag control and custom fields name a workspace's own tag or field.
    if((query.tag||filtered.find(entry=>entry.query===query)?.workspace)&&!project)continue
    const want=await expected(query,user,project),page=await app.ok(base+'?'+new URLSearchParams(query),{token})
    assert.deepEqual(page.data.map(row=>row.id),want.slice(0,30),`${label}: ${role} ${project?'workspace':'all'} ${JSON.stringify(query)} lists the same conversations in order`)
    assert.equal(page.meta.pagination.total,want.length,`${label}: ${role} ${JSON.stringify(query)} total`)
   }
   const got=(await app.ok(base+'/counts',{token})).data,want=(await app.sql(counts(project),user,...(project?[project]:[])))[0]
   for(const key of Object.keys(want))assert.equal(got[key],want[key],`${label}: ${role} ${project?'workspace':'all'} ${key} count`)
  }
 }
}
