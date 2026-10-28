/** Legacy view links remain useful shortcuts; explicit status and assignment compose. */
export function inboxFilters(query:(name:string)=>string|undefined,search:string,userId:string){
 const view=query('view')||query('filter')||'open'
 const defaults:Record<string,[string,string]>={open:['unresolved','anyone'],mine:['unresolved','myself'],unassigned:['unresolved','none'],closed:['resolved','anyone'],ai:['ai','anyone'],all:['all','anyone'],unread:['unresolved','anyone']}
 const [defaultStatus,defaultAssignment]=Object.hasOwn(defaults,view)?defaults[view]:defaults.open
 const status=query('status')||defaultStatus,assignment=query('assigned_to')||defaultAssignment
 const conditions:string[]=[],params:any[]=[]
 // Search explicitly defaults to all history, independent of the previous queue.
 if(search&&query('search_scope')!=='view')return {conditions,params}
 const ai='EXISTS(SELECT 1 FROM conversation_ai ca WHERE ca.conversation_id=c.id AND ca.ai_id IS NOT NULL)'
 if(status==='ai')conditions.push(ai)
 if(['new','open','pending','on_hold','solved','closed'].includes(status)){conditions.push('c.status_category=?');params.push(status)}
 for(const field of ['priority','status_id','channel','brand_id','group_id','requester_id','submitter_id','submitter_type','subject']){
  const value=query(field);if(value!==undefined){conditions.push(`c.${field}=?`);params.push(value)}
 }
 if(status==='unresolved'||status==='resolved')conditions.push(status==='resolved'?'c.resolved_at IS NOT NULL':'c.resolved_at IS NULL',`NOT ${ai}`)
 if(assignment==='myself'){conditions.push('c.assigned_to=?');params.push(userId)}
 if(assignment==='none')conditions.push('c.assigned_to IS NULL')
 if(!['myself','none','anyone'].includes(assignment)){conditions.push('c.assigned_to=?');params.push(assignment)}
 if(view==='unread'){
  conditions.push("EXISTS(SELECT 1 FROM messages msg WHERE msg.conversation_id=c.id AND msg.actor_role='contact' AND NOT EXISTS(SELECT 1 FROM move_in_message_sources ims WHERE ims.message_id=msg.id) AND msg.revision>coalesce((SELECT revision FROM conversation_reads WHERE conversation_id=c.id AND user_id=?),0))")
  params.push(userId)
 }
 return {conditions,params}
}
