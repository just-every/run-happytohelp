import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {packZendesk} from '../../scripts/pack-zendesk-offline.mjs'
export const publicBytes=Buffer.from('synthetic-hh-1 receipt\n'),privateBytes=Buffer.from('synthetic-hh-2 internal triage\n')
export async function zendeskCorpus(){
 const dir=await mkdtemp(join(tmpdir(),'synthetic-hh-'))
 try{
  const at='2024-01-01T00:00:00Z',updated='2024-01-02T00:00:00Z'
  const users=[{id:1,role:'end-user',name:'synthetic-hh-1',email:'synthetic-hh-1@example.test',organization_id:7,created_at:at},{id:2,role:'agent',name:'synthetic-hh-2',email:'synthetic-hh-2@example.test',created_at:at}]
  const attachment=(id,bytes)=>({id,file_name:'receipt.txt',content_type:'text/plain',size:bytes.length,content_url:`https://files.example.test/attachments/token/synthetic-hh-${id}/?name=receipt.txt`})
  const comments=[{id:101,author_id:1,body:'synthetic-hh-1 public request',public:true,created_at:at,attachments:[attachment(501,publicBytes)]},{id:102,author_id:2,body:'synthetic-hh-2 private note',public:false,created_at:updated,attachments:[attachment(502,privateBytes)]},{id:103,author_id:2,body:'synthetic-hh-3 public answer',public:true,created_at:updated,attachments:[{id:503,file_name:'url-only.txt',content_type:'text/plain',size:10,content_url:'https://files.example.test/503'}]}]
  const tickets=Array.from({length:6},(_,i)=>({id:1001+i,requester_id:1,subject:`synthetic-hh-${i+1} ${['open','new','pending','hold','solved','closed'][i]}`,status:['open','new','pending','hold','solved','closed'][i],created_at:at,updated_at:updated,via:{channel:'email'},comment_count:i===0?3:1,comments:i===0?[]:[{id:200+i,author_id:1,body:`synthetic-hh-${i+1} history`,public:true,created_at:at}],tags:['synthetic-hh-90'],custom_fields:[{id:70,value:true}]}))
  tickets[0].synthetic_hh_unknown='synthetic-hh-998'
  tickets.push({...tickets[1],id:2001,subject:'synthetic-hh-7 incomplete',comments_truncated:true,comment_count:25})
  tickets.push({...tickets[1],id:2002,subject:'synthetic-hh-8 missing page',comments:[],comment_count:2})
  const files={
   'tickets.json':{tickets:[...tickets,tickets[0]]},
   'users.json':{users},
   'organizations.json':{organizations:[{id:7,name:'synthetic-hh-7 workshop',domain_names:['synthetic-hh.example'],created_at:at,updated_at:updated,shared_tickets:false,shared_comments:false}]},
   'comments.json':{comments,next_page:null},
   'missing-page.json':{comments:[{id:301,author_id:1,public:true,body:'synthetic-hh-8 page one',created_at:at}],next_page:'https://example.test/comments?page=2'},
   'metrics.json':{ticket_metric_events:[{id:601,ticket_id:1001,instance_id:1,type:'activate',metric:'reply_time',time:at},{id:602,ticket_id:1001,instance_id:1,type:'fulfill',metric:'reply_time',time:updated,status:{calendar:1440,business:480}},{id:603,ticket_id:1001,instance_id:1,type:'synthetic-hh-999',metric:'reply_time',time:updated}]},
   'audits.json':{audits:[{id:701,ticket_id:1001,author_id:2,created_at:updated,events:[{id:702,type:'Change',field_name:'status',previous_value:'new',value:'open'},{id:703,type:'SlaTargetChange',sla:{target:60,unit:'minutes',business_hours:true}}]}]},
  }
  await mkdir(join(dir,'bytes'))
  for(const [path,data] of Object.entries(files))await writeFile(join(dir,path),JSON.stringify(data))
  await writeFile(join(dir,'bytes/public.txt'),publicBytes);await writeFile(join(dir,'bytes/private.txt'),privateBytes)
  const bindings=[[501,101,'bytes/public.txt',publicBytes],[502,102,'bytes/private.txt',privateBytes]].map(([attachment_id,comment_id,path,bytes])=>({ticket_id:1001,attachment_id,comment_id,path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))
  const manifest={format:'happytohelp-zendesk-offline-v1',files:[{kind:'ticket',path:'tickets.json'},{kind:'metrics',path:'metrics.json'},{kind:'audits',path:'audits.json'},{kind:'comments',path:'comments.json',ticket_id:1001,complete:true},{kind:'comments',path:'missing-page.json',ticket_id:2002,complete:false,page:1,pages:2},{kind:'user',path:'users.json'},{kind:'organization',path:'organizations.json'}],attachments:bindings}
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest))
  const body=await packZendesk(join(dir,'manifest.json'))
  const records=body.trim().split('\n').map(JSON.parse)
  records.push({ticket_field:{id:70,type:'checkbox',title:'synthetic-hh-70 approved',active:true,required:false,visible_in_portal:true,editable_in_portal:true,required_in_portal:false,agent_can_edit:true,created_at:at,updated_at:updated}})
  records.find(r=>r.ticket?.id===1001).ticket.synthetic_hh_unknown='synthetic-hh-998'
  return records
 }finally{await rm(dir,{recursive:true,force:true})}
}
