import {createHash} from 'node:crypto'

export const reportDates={start:'2026-09-20',end:'2026-10-20',timezone:'America/New_York'}
export const reportStart=Date.parse('2026-09-20T04:00:00Z')
export const reportEnd=Date.parse('2026-10-20T04:00:00Z')
const names=['Avery Chen','Jordan Rivera','Morgan Patel','Sam Wilson','Casey Brooks','Taylor Nguyen']
const teams=['Customer care','Billing','Technical support']
const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'"
export const insert=(table,row)=>`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`

/** Historical support activity is test data. All reads and operator effects use the product's routes. */
export function reportFixture(projectId,{withTimers=true,withSla=true,count=426}={}){
 const statements=[],tickets=[],timerRows=[],slaRows=[]
 statements.push(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(${quote(projectId)},'{"timezone":"America/New_York"}',1) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.timezone','America/New_York');`)
 for(let i=0;i<3;i++)statements.push(insert('ticket_groups',{project_id:projectId,id:`${projectId}-team-${i}`,name:teams[i],updated_at:1}))
 for(let i=0;i<6;i++){
  const id=`${projectId}-agent-${i}`,token=`report-agent-token-${projectId}-${i}`
  statements.push(insert('users',{id,email:`agent${i}@reports.example.test`,name:names[i],created_at:reportStart}),insert('memberships',{project_id:projectId,user_id:id,role:'operator'}),insert('ticket_group_members',{project_id:projectId,group_id:`${projectId}-team-${i%3}`,user_id:id}),insert('sessions',{token_hash:createHash('sha256').update(token).digest('hex'),actor_id:id,project_id:projectId,role:'operator',expires_at:Date.now()+3600000}),insert('session_factors',{token_hash:createHash('sha256').update(token).digest('hex'),user_id:id,method:'password',verified_at:Date.now()}))
 }
 for(const [id,name] of [['billing','Billing'],['delivery','Delivery'],['login','Login']])statements.push(insert('workspace_tags',{project_id:projectId,id:`${projectId}-tag-${id}`,name,normalized_name:id}))
 const calendar={id:`${projectId}-calendar`,project_id:projectId,name:'US support',timezone:'America/New_York',hours:{1:[[540,1020]],2:[[540,1020]],3:[[540,1020]],4:[[540,1020]],5:[[540,1020]]},holidays:['2026-10-12'],active:true,updated_at:1}
 const policy={id:`${projectId}-policy`,project_id:projectId,name:'Standard support',calendar_id:calendar.id,first_response_minutes:60,next_response_minutes:120,resolution_minutes:480,pause_on_hold:true}
 for(let i=0;i<count;i++){
  const id=`${projectId}-ticket-${String(i).padStart(3,'0')}`,contact=`${projectId}-contact-${i}`,created=reportStart+(i%30)*86400000+3600000+(i%13)*60000,solved=i%4===0,reopened=i%10===1,status=solved?'solved':i%5===0?'pending':'open'
  const row={id,project_id:projectId,contact_id:contact,revision:1,last_message_id:null,assigned_to:`${projectId}-agent-${i%6}`,resolved_at:solved?created+7200000:null,created_at:created,updated_at:created+7200000,status_id:status,status_category:status,subject:i===0?'Checkout outage affecting US customers':`Order ${48200+i}: ${['delivery update','invoice question','login help'][i%3]}`,priority:i%11===0?'urgent':'normal',channel:i%2===0?'email':'widget',brand_id:i%2===0?projectId:'ridgeline-us',group_id:`${projectId}-team-${i%3}`,requester_id:contact,submitter_id:contact}
  statements.push(insert('contacts',{id:contact,project_id:projectId,email:`customer${i}@customer.example.test`,name:`${['Dana','Alex','Riley','Cameron'][i%4]} ${['Whitfield','Cole','Davis','Reed'][i%4]}`,is_verified:1,metadata_json:'{}',created_at:created}),insert('conversations',row),`UPDATE conversations SET brand_id=${quote(row.brand_id)} WHERE id=${quote(id)};`,insert('messages',{id:`${id}-message`,project_id:projectId,conversation_id:id,local_id:`fixture-${i}`,actor_id:contact,actor_role:'contact',content:`I need help with order ${48200+i}.`,revision:1,created_at:created}),`UPDATE conversations SET last_message_id=(SELECT id FROM messages WHERE conversation_id=${quote(id)} LIMIT 1) WHERE id=${quote(id)};`,insert('conversation_tags',{project_id:projectId,conversation_id:id,tag_id:`${projectId}-tag-${['billing','delivery','login'][i%3]}`}))
  if(solved||reopened)statements.push(insert('ticket_history',{id:`${id}-solved`,project_id:projectId,conversation_id:id,actor_id:row.assigned_to,actor_type:'user',source:'dashboard',at:created+7200000,changes_json:JSON.stringify({status_category:{from:'open',to:'solved'}})}))
  if(reopened)statements.push(insert('ticket_history',{id:`${id}-reopened`,project_id:projectId,conversation_id:id,actor_id:contact,actor_type:'contact',source:'email',at:created+10800000,changes_json:JSON.stringify({status_category:{from:'solved',to:'open'}})}))
  const clocks=['first_response','next_response','resolution'].filter((_,j)=>j!==1||reopened).map((metric,j)=>({metric,cycle:1,started_at:created,due_at:created+(j+1)*3600000,completed_at:created+(j+1)*3000000,breached:(i+j)%7===0,spent_ms:(j+1)*3000000,target_ms:(j+1)*3600000,remaining_minutes:0,breached_at:(i+j)%7===0?created+(j+1)*3600000:null}))
  if(withSla){const sla={project_id:projectId,conversation_id:id,policy_id:policy.id,policy_json:JSON.stringify(policy),calendar_json:JSON.stringify(calendar),last_event_id:0,state_json:JSON.stringify({status,pause_reason:status==='pending'?'pending':null,clocks,cursor_at:created+7200000,response_count:reopened?2:1,resolution_count:1,waiting:false,customer_started:true}),next_check_at:null,updated_at:created+7200000};slaRows.push(sla);statements.push(insert('ticket_sla_state',sla))}
  if(withTimers&&i%3!==2){const timer={id:`${id}-timer`,project_id:projectId,conversation_id:id,user_id:row.assigned_to,started_at:created+3600000,ended_at:created+3600000+(5+i%25)*60000};timerRows.push(timer);statements.push(insert('ticket_handle_sessions',timer))}
  tickets.push({...row,reopened,wasResolved:solved||reopened})
 }
 return {statements,tickets,timerRows,slaRows}
}

export async function seedReportFixture(db,projectId,options){
 const fixture=reportFixture(projectId,options)
 for(let i=0;i<fixture.statements.length;i+=80)await db.batch(fixture.statements.slice(i,i+80).map(sql=>db.prepare(sql)))
 return fixture
}
