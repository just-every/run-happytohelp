import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'

// Extends scopedAuthorityJourney, through the native GET. No extra registration.
export async function nativeSettingsAuthority(app){
 const w=await app.seedWorkspace('native-settings'),P=`/api/management/projects/${w.projectId}`,door=P+'/settings'
 const supported={website:'https://native-settings.example.test',timezone:'America/New_York',help_center_domain:'https://help.example.test',primary_color:'#2468aa',display_mode:'light',sidebar_artwork_id:'synthetic-artwork',sidebar_artwork_enabled:false,brand_image_url:'/synthetic-brand.webp',logo_url:'/synthetic-logo.webp',brand_name:'Synthetic care',avatar_url:'/synthetic-avatar.webp',welcome_message:'Welcome to synthetic care',is_contact_tracking_enabled:true,proactive_help_enabled:false,is_available:false,unavailable_message:'Synthetic closed message',is_availability_schedule_enabled:true,is_presence_away_enabled:false,presence_idle_minutes:10,presence_away_message:'Synthetic nobody online',availability_schedule:{days:[1,3,5],time_from:'08:30',time_to:'17:45',message:'Synthetic outside hours'},default_visitor_ai_id:'synthetic-visitor-ai',default_verified_user_ai_id:'synthetic-verified-ai',is_human_response_enabled:false}
 const expected={id:w.projectId,name:w.name,widget_key:w.widgetKey,allowed_origin:w.allowedOrigin,...supported}
 const sentinels=Array.from({length:4},()=>randomBytes(24).toString('hex'))
 const stored={...supported,private_credential:sentinels[0],unknown_future:{value:sentinels[1]},connection:{credential:sentinels[2]},availability_schedule:{...supported.availability_schedule,credential:sentinels[3],connection:{value:sentinels[2]}}}
 await app.db.prepare('INSERT INTO project_settings VALUES(?,?,?)').bind(w.projectId,JSON.stringify(stored),Date.now()).run()
 const read=async(id,token,path=door,status=403)=>{
  const response=await app.request(path,{token}),bytes=Buffer.from(await response.arrayBuffer())
  assert.equal(response.status,status,id)
  assert.equal(sentinels.filter(value=>bytes.includes(Buffer.from(value))).length,0,`${id}: no secret sentinel in response bytes`)
  console.log(`PROBE ${id} ACCESS-001: GET native Settings -> ${response.status}; sentinel-hits=0`)
  return JSON.parse(bytes.toString())
 }
 for(const role of ['owner','admin']){
  assert.deepEqual((await read(role,w.tokens[role],door,200)).data,expected)
  // The unchanged save routes retain every supported field and do not erase
  // unrelated stored configuration. Only GET responses are under this slice.
  assert.equal((await app.call(door,{token:w.tokens[role],method:'PUT',body:{...supported,name:w.name}})).status,200)
  assert.equal((await app.call(P+'/availability',{token:w.tokens[role],method:'PUT',body:supported})).status,200)
  assert.deepEqual((await read(role+'-after-save',w.tokens[role],door,200)).data,expected)
 }
 await read('operator',w.tokens.operator)
 await app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',?)").bind(w.projectId,w.users.operator,Date.now()).run()
 await read('collaborator',w.tokens.operator)
 const role=(await app.call(P+'/roles',{token:w.tokens.owner,body:{name:'Synthetic narrow admin',base:'admin',permissions:['reports.view']},status:201})).data.data
 await app.db.prepare('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,?)').bind(w.projectId,w.users.admin,role.id,Date.now()).run()
 await read('custom-admin-no-settings',w.tokens.admin)
 await app.call(P+'/roles/'+role.id,{token:w.tokens.owner,method:'PUT',body:{name:role.name,base:'admin',permissions:['settings.manage']},status:200})
 assert.deepEqual((await read('custom-admin-restored',w.tokens.admin,door,200)).data,expected)
 await app.call(P+'/roles/'+role.id,{token:w.tokens.owner,method:'PUT',body:{name:role.name,base:'admin',permissions:[]},status:200})
 await read('custom-admin-revoked-permission',w.tokens.admin)
 const foreign=await app.seedWorkspace('native-settings-foreign')
 await read('foreign-workspace',foreign.tokens.owner)
 // A stale session is insufficient after its membership is removed.
 await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(w.projectId,w.users.admin).run()
 await read('revoked-membership',w.tokens.admin,door,401)
 await app.call('/api/identity/session',{token:w.tokens.operator,method:'DELETE',status:200})
 await read('revoked-session',w.tokens.operator,door,401)
 await app.call(P,{token:w.tokens.owner,method:'DELETE',status:200})
 await read('deleted-project',w.tokens.owner,door,401)
}
