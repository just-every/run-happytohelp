import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {packZendesk} from '../../scripts/pack-zendesk-offline.mjs'
import {zip} from './zip.mjs'

// Invented people and text only. Shapes follow the Zendesk pages linked in
// docs/moving-in.md. No downloaded data, credentials or provider is involved.
export const at='2024-03-10T06:55:00Z',later='2024-03-10T08:05:00Z'
export const fieldTypes=['text','textarea','integer','decimal','date','checkbox','tagger','multiselect','regexp','partialcreditcard','lookup','multi_lookup']
export const supportedTypes=fieldTypes.slice(0,9)
export function fidelityObjects(){
 const times={created_at:at,updated_at:later}
 const organization=Array.from({length:10},(_,i)=>({id:100+i,name:`synthetic-hh-${100+i} Copper Workshop`,domain_names:[`synthetic-hh-${100+i}.example.test`],details:`synthetic-hh-${100+i} invented postal address`,notes:'synthetic-hh-900 invoicing by appointment',external_id:`synthetic-hh-${100+i}`,group_id:500+i%3,organization_fields:{service_plan:'synthetic-hh-900',renewal:'2025-03-10'},tags:['synthetic-hh-901'],shared_tickets:false,shared_comments:false,ticket_restriction:'restricted',url:`https://synthetic-hh.example.test/api/v2/organizations/${100+i}`,...times}))
 const user=Array.from({length:202},(_,i)=>({id:i+1,name:`synthetic-hh-${i+1} ${['Mira Copper','Tavi Reed','Neri Vale','Lio Ash'][i%4]}`,email:`synthetic-hh-${i+1}@example.test`,role:i<200?'end-user':i===200?'agent':'admin',organization_id:i<200?100+i%10:null,phone:`+1202555${String(100+i%100).padStart(4,'0')}`,time_zone:['America/New_York','Europe/Paris','Asia/Tokyo'][i%3],iana_time_zone:['America/New_York','Europe/Paris','Asia/Tokyo'][i%3],locale:i%2?'en-US':'fr',locale_id:i%2?1:16,notes:`synthetic-hh-${i+1} prefers written instructions`,details:'synthetic-hh-902 made-up contact detail',user_fields:{plan:'synthetic-hh-903',seats:3,renewal_date:'2025-03-10',eligible:true},external_id:`synthetic-hh-${i+1}`,tags:['synthetic-hh-904'],suspended:i===198,active:i!==199,verified:true,shared_phone_number:false,url:`https://synthetic-hh.example.test/api/v2/users/${i+1}`,...times}))
 const identity=user.slice(0,200).flatMap(u=>[0,1].map(n=>({id:1000+u.id*2+n,user_id:u.id,type:'email',value:n?`synthetic-hh-${u.id}-alt@example.test`:u.email,primary:!n,verified:true,verification_method:'full',deliverable_state:'deliverable',...times})))
 const organization_membership=user.slice(0,200).map(u=>({id:2000+u.id,user_id:u.id,organization_id:u.organization_id,organization_name:organization.find(o=>o.id===u.organization_id).name,default:true,view_tickets:false,...times}))
 organization_membership.push({id:2999,user_id:1,organization_id:101,organization_name:organization[1].name,default:null,view_tickets:false,...times})
 const group=Array.from({length:3},(_,i)=>({id:500+i,name:`synthetic-hh-${500+i} ${['Triage','Accounts','Technical'][i]}`,description:'synthetic-hh-905 rotation',deleted:false,default:i===0,is_public:true,...times}))
 const group_membership=[{id:901,user_id:201,group_id:500,default:true,...times}]
 const ticket_field=fieldTypes.map((type,i)=>({id:700+i,type,title:`synthetic-hh-${700+i} ${type}`,title_in_portal:`synthetic-hh-${700+i}`,description:'synthetic-hh-906 import exercise',active:true,required:false,visible_in_portal:true,editable_in_portal:true,required_in_portal:false,agent_can_edit:true,position:i,default_value:null,...(['tagger','multiselect'].includes(type)?{custom_field_options:[{id:800+i,name:'synthetic-hh-907 Copper',raw_name:'synthetic-hh-907 Copper',value:`synthetic-hh-${800+i}`,default:false}]}:{}),...(type==='regexp'?{regexp_for_validation:'^SYN-[0-9]{4}$'}:{}),...(['lookup','multi_lookup'].includes(type)?{relationship_target_type:'zen:organization'}:{}),...times}))
 const values=i=>[`synthetic-hh-${i+1}`,`synthetic-hh-${i+1} café\nSecond line 日本語`,'42','12.75','2024-03-10',true,'synthetic-hh-806',['synthetic-hh-807'],'SYN-1234','4242','100',['100','101']]
 const attachment=(id)=>({id,file_name:'synthetic-hh-908-receipt.txt',content_type:'text/plain',size:Buffer.byteLength(`synthetic-hh-${id} file\n`),content_url:`https://synthetic-hh.example.test/files/${id}`,inline:false,deleted:false,thumbnails:[]})
 const ticket=Array.from({length:300},(_,i)=>{const id=10000+i,requester=i%200+1,status=['new','open','pending','hold','solved','closed'][i%6],base={id,subject:`synthetic-hh-${id} ${status} café 日本語`,description:`synthetic-hh-${id} first request`,status,priority:['low','normal','high','urgent'][i%4],requester_id:requester,submitter_id:requester,assignee_id:201,group_id:500+i%3,organization_id:100+(requester-1)%10,type:'question',custom_status_id:400+i%6,external_id:`synthetic-hh-${id}`,recipient:'synthetic-hh-support@example.test',collaborator_ids:[requester%200+1],email_cc_ids:[requester%200+1],follower_ids:[202],followup_ids:[],problem_id:null,ticket_form_id:900,brand_id:1,via:{channel:['email','web','chat','voice'][i%4],source:{from:{address:`synthetic-hh-${requester}@example.test`},to:{address:'synthetic-hh-support@example.test'},rel:null}},tags:['synthetic-hh-910',`synthetic-hh-${911+i%3}`],custom_fields:values(i).map((value,j)=>({id:700+j,value})),satisfaction_rating:['solved','closed'].includes(status)?{id:30000+i,score:i%2?'good':'bad',comment:`synthetic-hh-${id} invented feedback`}:{score:'unoffered'},...times};
 base.comments=Array.from({length:4},(_,j)=>({id:100000+i*10+j,author_id:j===0?requester:j===3?-1:201,type:j===2?'VoiceComment':'Comment',public:j!==1,body:`synthetic-hh-${id} ${['first request café 日本語','private investigation','voice transcript: invented call','chat transcript: invented chat'][j]}`,plain_body:`synthetic-hh-${id} ${['first request café 日本語','private investigation','voice transcript: invented call','chat transcript: invented chat'][j]}`,html_body:`<p>synthetic-hh-${id} source formatting</p>`,created_at:j?later:at,attachments:i<3&&j<2?[attachment(40000+i*10+j)]:[],metadata:{system:{ip_address:'192.0.2.1'},custom:{}},via:{channel:j===2?'voice':j===3?'chat':'email'}}));return base})
 // A documented merge leaves a closed source and explicit private comments on
 // source and target. Never invent an undocumented merged_into property.
 ticket[5].comments[1].body=ticket[5].comments[1].plain_body='synthetic-hh-10005 Closed in favor of #10001'
 ticket[1].comments[1].body=ticket[1].comments[1].plain_body='synthetic-hh-10001 Combining with #10005'
 const ticket_form=[{id:900,name:'synthetic-hh-900 request',display_name:'synthetic-hh-900 request',active:true,default:true,end_user_visible:true,in_all_brands:true,restricted_brand_ids:[],ticket_field_ids:ticket_field.slice(0,9).map(f=>f.id),agent_conditions:[],end_user_conditions:[],...times}]
 const macro=[{id:600,title:'synthetic-hh-600 public reply',active:true,restriction:null,actions:[{field:'comment_value',value:'synthetic-hh-600 Thank you for the details.'},{field:'comment_mode_is_public',value:'true'},{field:'priority',value:'high'}],...times},{id:601,title:'synthetic-hh-601 note',active:true,restriction:null,actions:[{field:'comment_value',value:'synthetic-hh-601 private checklist'},{field:'comment_mode_is_public',value:'false'}],...times}]
 const conditions={all:[{field:'status',operator:'is',value:'open'}],any:[]}
 const view=Array.from({length:3},(_,i)=>({id:610+i,title:`synthetic-hh-${610+i} view`,active:true,restriction:null,conditions,execution:{sort_by:'updated_at',sort_order:'desc',columns:[{id:'subject',title:'Subject'}],group_by:null,group_order:null},...times}))
 const trigger=[{id:620,title:'synthetic-hh-620 triage',active:true,position:1,conditions,actions:[{field:'priority',value:'high'}],...times}]
 const automation=[{id:630,title:'synthetic-hh-630 waiting',active:true,position:2,conditions:{all:[{field:'status',operator:'is',value:'pending'},{field:'hours_since_updated',operator:'greater_than',value:'24'}],any:[]},actions:[{field:'status',value:'open'}],...times}]
 const sla_policy=[{id:640,title:'synthetic-hh-640 response',description:'synthetic-hh-640 business commitment',position:1,filter:{all:[{field:'priority',operator:'is',value:'high'}],any:[]},policy_metrics:[{priority:'high',metric:'first_reply_time',target:60,business_hours:true}],...times}]
 const section=[{id:650,name:'synthetic-hh-650 Getting started',category_id:651,locale:'en-us',source_locale:'en-us',description:'synthetic-hh-650 setup',position:0,parent_section_id:null,...times}]
 const article=Array.from({length:3},(_,i)=>({id:660+i,title:`synthetic-hh-${660+i} guide`,body:`<p>synthetic-hh-${660+i} invented instructions café</p>`,draft:i===1,user_segment_id:i===2?10:null,user_segment_ids:i===2?[10]:[],section_id:650,author_id:201,locale:'en-us',source_locale:'en-us',position:i,label_names:['synthetic-hh-915'],promoted:false,comments_disabled:false,...times}))
 const satisfaction_rating=ticket.filter(t=>t.satisfaction_rating.id).map(t=>({...t.satisfaction_rating,ticket_id:t.id,requester_id:t.requester_id,assignee_id:t.assignee_id,group_id:t.group_id,...times}))
 const audit=ticket.slice(0,3).map((t,i)=>({id:50000+i,ticket_id:t.id,author_id:201,created_at:later,events:[{id:51000+i,type:'Change',field_name:'status',previous_value:'new',value:t.status}],metadata:{system:{ip_address:'192.0.2.1'},custom:{}},via:{channel:'web'}}))
 return {user,ticket,organization,identity,organization_membership,group,group_membership,ticket_field,ticket_form,macro,view,trigger,automation,sla_policy,article,section,satisfaction_rating,audit}
}
export async function fidelityCorpus(){
 const objects=fidelityObjects(),directory=await mkdtemp(join(tmpdir(),'synthetic-hh-fidelity-'))
 try{
  await mkdir(join(directory,'bytes'))
  const bindings=[]
  for(const t of objects.ticket)for(const c of t.comments)for(const a of c.attachments){const bytes=Buffer.from(`synthetic-hh-${a.id} file\n`),path=`bytes/${a.id}.txt`;await writeFile(join(directory,path),bytes);bindings.push({ticket_id:t.id,comment_id:c.id,attachment_id:a.id,path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}
  const files=[]
  for(const kind of ['ticket','user','organization','ticket_field']){const path=kind+'.ndjson';await writeFile(join(directory,path),objects[kind].map(v=>JSON.stringify({[kind]:v})).join('\n'));files.push({kind,path})}
  await writeFile(join(directory,'audits.json'),JSON.stringify({audits:objects.audit,next_page:null}));files.push({kind:'audits',path:'audits.json'})
  await writeFile(join(directory,'manifest.json'),JSON.stringify({format:'happytohelp-zendesk-offline-v1',files,attachments:bindings}))
  const packed=(await packZendesk(join(directory,'manifest.json'))).trim().split('\n').map(JSON.parse)
  const extra=Object.entries(objects).filter(([kind])=>!['ticket','user','organization','ticket_field','audit'].includes(kind)).flatMap(([kind,rows])=>rows.map(v=>({[kind]:v})))
  const records=[...packed,...extra]
  const wrapped=records.map(JSON.stringify).join('\n')
  // Zendesk's help page explicitly documents wrapping its singular records in
  // a tickets array; API pages contain unwrapped objects under plural keys.
  const entries=[{name:'export_2026_11_17_synthetic_hh_1.json',body:JSON.stringify({tickets:records.filter(r=>r.ticket)},null,1)}]
  for(const [kind,rows] of Object.entries(objects).filter(([kind])=>!['ticket','audit'].includes(kind))){const key=kind==='identity'?'identities':kind==='sla_policy'?'sla_policies':kind+'s',data=records.filter(r=>r[kind]).map(r=>r[kind]);entries.push({name:`${kind}.json`,body:JSON.stringify({[key]:data,count:rows.length,next_page:null,previous_page:null},null,1)})}
  // Untouched Admin Center NDJSON and separate API collection responses: no
  // HappyToHelp packing annotations or bytes. This is reviewed independently.
  const rawEntries=Object.entries(objects).filter(([kind])=>kind!=='audit').map(([kind,rows])=>({name:`raw-${kind}.json`,body:['ticket','user','organization'].includes(kind)?rows.map(value=>JSON.stringify({[kind]:value})).join('\n'):JSON.stringify({[kind==='identity'?'identities':kind==='sla_policy'?'sla_policies':kind+'s']:rows,next_page:null})}))
  return {objects,records,wrapped,archive:zip(entries),rawArchive:zip(rawEntries),entries}
 }finally{await rm(directory,{recursive:true,force:true})}
}
