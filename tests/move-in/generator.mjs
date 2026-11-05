import {createHash} from 'node:crypto'
import {generateHelpScout} from './helpscout-fixtures.mjs';
// Synthetic, deterministic source documents. This generator does not import product readers.
export function generate(vendor,count=1000,seed=271828){
 if(vendor==='helpscout')return generateHelpScout(count,seed);
 let state=seed>>>0;const random=()=>{state=(1664525*state+1013904223)>>>0;return state},stamp=1704067200,records=[];
 const iso=seconds=>new Date(seconds*1000).toISOString(),customers=Math.min(count,100);
 if(vendor==='zendesk'){
  records.push({user:{id:900001,role:'agent',name:'Historical teammate',email:'staff@example.test',created_at:iso(stamp)}});
  for(let i=1;i<=customers;i++)records.push({user:{id:i,role:'end-user',name:i===1?'مرحبا "Ada" <script>unsafe</script>':`Customer ${i}`,email:`person${i}@example.test`,created_at:iso(stamp),tags:['Customer']}});
  for(let i=1;i<=count;i++){const customer=(i-1)%customers+1,created=stamp+i*60;records.push({ticket:{id:10000+i,requester_id:customer,subject:i===1?'Long "subject" <img onerror=alert(1)> '+ 'history '.repeat(80):`Question ${random()%99999}`,status:i%2?'open':'closed',created_at:iso(created),updated_at:iso(created+120),tags:['Billing',i%2?'Priority':'Customer'],via:{channel:'email'},comments:[{id:i*10+1,author_id:customer,public:true,body:'Please help "quoted" مرحبا <script>alert(1)</script>',created_at:iso(created)},{id:i*10+2,author_id:900001,public:false,body:`Private note ${i}`,created_at:iso(created+30)},{id:i*10+3,author_id:900001,public:true,body:`Historical reply ${i}`,created_at:iso(created+120)}]}})}
  records.push({macro:{id:50001,title:'Greeting',restriction:null,created_at:iso(stamp),updated_at:iso(stamp+30),actions:[{field:'comment_value',value:'Hello, how can we help?'}]}},{article:{id:60001,title:'Published guide',body:'Public help "quoted"',draft:false,user_segment_id:null,created_at:iso(stamp),updated_at:iso(stamp+30)}},{article:{id:60002,title:'Draft guide',body:'Draft only',draft:true,user_segment_id:null,created_at:iso(stamp),updated_at:iso(stamp+30)}});
 }else{
  for(let i=1;i<=customers;i++)records.push({type:'contact',id:`ct-${i}`,name:i===1?'مرحبا "Ada" <script>unsafe</script>':`Customer ${i}`,email:`person${i}@example.test`,created_at:stamp,tags:{type:'list',data:[{id:'tag-customer',name:'Customer'}]}});
  for(let i=1;i<=count;i++){const customer=(i-1)%customers+1,created=stamp+i*60;records.push({type:'conversation',id:`cv-${i}`,title:i===1?'Long "subject" <img onerror=alert(1)> '+'history '.repeat(80):`Question ${random()%99999}`,state:i%2?'open':'closed',channel:{initial:'messenger'},created_at:created,updated_at:created+120,contacts:{type:'contact.list',contacts:[{type:'contact',id:`ct-${customer}`}]},source:{id:`source-${i}`,type:'messenger',body:'Please help "quoted" مرحبا <script>alert(1)</script>',author:{type:'contact',id:`ct-${customer}`,name:'Customer'}},conversation_parts:{type:'conversation_part.list',conversation_parts:[{type:'conversation_part',id:`note-${i}`,part_type:'note',body:`Private note ${i}`,created_at:created+30,author:{type:'admin',id:'staff-1',name:'Historical teammate'}},{type:'conversation_part',id:`reply-${i}`,part_type:'comment',body:`Historical reply ${i}`,created_at:created+120,author:{type:'admin',id:'staff-1',name:'Historical teammate'}}]},tags:{type:'tag.list',tags:[{type:'tag',id:'tag-billing',name:'Billing'},{type:'tag',id:i%2?'tag-priority':'tag-customer',name:i%2?'Priority':'Customer'}]}})}
  records.push({type:'macro',id:'macro-1',name:'Greeting',body:'Hello, how can we help?',visible_to:'everyone',available_on:['inbox'],created_at:iso(stamp),updated_at:iso(stamp+30)},{type:'article',id:'article-1',title:'Published guide',body:'Public help "quoted"',state:'published',created_at:stamp,updated_at:stamp+30},{type:'article',id:'article-2',title:'Draft guide',body:'Draft only',state:'draft',created_at:stamp,updated_at:stamp+30});
 }
 return records.map(record=>JSON.stringify(record)).join('\n')+'\n';
}

// Negative corpus variants retain deterministic source line positions.
export function generateDiagnostics(vendor,count=2,seed=271828){
 const lines=generate(vendor,count,seed).trimEnd().split('\n'),index=lines.findIndex(line=>vendor==='zendesk'?JSON.parse(line).ticket:JSON.parse(line).type==='conversation'),duplicate=JSON.parse(lines[index]);
 if(vendor==='zendesk')duplicate.ticket.subject='Conflicting duplicate';else duplicate.title='Conflicting duplicate';
 return {body:lines.join('\n')+'\n'+lines[index]+'\n'+JSON.stringify(duplicate)+'\n{malformed\n',duplicateLine:lines.length+2,malformedLine:lines.length+3};
}

// The existing capacity journey uses mixed lifecycle categories and inert
// source events. Ordinary browser fixtures retain their approved queue shape.
export function generateCapacity(vendor,count){
 const source=generate(vendor,count);if(vendor!=='zendesk')return source
 return source.trimEnd().split('\n').map(line=>{
  const record=JSON.parse(line);if(record.ticket){const t=record.ticket,i=t.id-10001;t.status=['new','open','pending','hold','solved','closed'][i%6];t._offline={format:'happytohelp-zendesk-offline-v1',history:{metrics:'supplied',audits:'missing'},metric_events:[{id:t.id,ticket_id:t.id,instance_id:1,type:i%2?'fulfill':'pause',metric:'reply_time',time:t.updated_at,status:{calendar:2,business:2}}],audits:[],attachments:[]}}
  return JSON.stringify(record)
 }).join('\n')+'\n'
}

/** One complete synthetic offline snapshot, deliberately inside the unchanged
 * byte/record limits. Closed/old tickets have no special archive marker. */
export function generateDoorZendesk(count=312){
 const exportedAt='2026-11-01T00:00:00Z',stamp='2024-01-01T00:00:00Z',records=[],customers=12
 for(let id=1;id<=3;id++)records.push({organization:{id:7000+id,name:`synthetic-hh-${7000+id}`,created_at:stamp,updated_at:stamp,domain_names:[]}})
 records.push({user:{id:900001,role:'agent',name:'synthetic-hh-900001',email:'synthetic-hh-900001@example.test',created_at:stamp}})
 for(let id=1;id<=customers;id++)records.push({user:{id,role:'end-user',name:`synthetic-hh-${id}`,email:`synthetic-hh-${id}@example.test`,organization_id:7001+(id-1)%3,created_at:stamp}})
 for(let index=0;index<count;index++){
  const id=10001+index,requester=index%customers+1,created=new Date(Date.parse(stamp)+index*180000).toISOString(),updated=new Date(Date.parse(created)+120000).toISOString()
  const ticket={id,requester_id:requester,organization_id:7001+(requester-1)%3,subject:`synthetic-hh-${id}`,status:['new','open','pending','hold','solved','closed'][index%6],created_at:created,updated_at:updated,via:{channel:'email'},tags:['synthetic-hh-import'],comment_count:3,comments:[{id:id*10+1,author_id:requester,public:true,body:`synthetic-hh-${requester} customer`,created_at:created},{id:id*10+2,author_id:900001,public:true,body:'synthetic-hh-900001 historical reply',created_at:new Date(Date.parse(created)+60000).toISOString()},{id:id*10+3,author_id:900001,public:false,body:'synthetic-hh-900001 private note',created_at:updated}],_offline:{format:'happytohelp-zendesk-offline-v1',comments_complete:true,history:{metrics:'missing',audits:'missing'},metric_events:[],audits:[],attachments:[]}}
  if(index===1){
   ticket.subject+=' [A123-B123]';ticket.comments[1].headers={'Message-ID':'<synthetic-hh-old@example.test>','In-Reply-To':'<synthetic-hh-parent@example.test>',References:'<synthetic-hh-first@example.test> <synthetic-hh-parent@example.test>'}
   for(const [part,aid] of [[ticket.comments[0],501],[ticket.comments[2],502]]){const bytes=Buffer.from(`synthetic-hh-${aid} attachment`);part.attachments=[{id:aid,file_name:`synthetic-hh-${aid}.txt`,content_type:'text/plain',size:bytes.length,content_url:`https://files.example.test/${aid}`}];ticket._offline.attachments.push({attachment_id:aid,comment_id:part.id,path:`attachments/synthetic-hh-${aid}.txt`,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')})}
  }
  records.push({ticket})
 }
 for(const [id,extra] of [[60001,{draft:false,user_segment_id:null}],[60002,{draft:true,user_segment_id:null}],[60003,{draft:false,user_segment_id:9}],[60004,{draft:false,user_segment_ids:[9]}]])records.push({article:{id,title:`synthetic-hh-${id}`,body:`<p>synthetic-hh-${id} body</p>`,created_at:stamp,updated_at:stamp,...extra}})
 const byKind={ticket:count,user:customers+1,organization:3,article:4,'tag-name':1},body=records.map(JSON.stringify).join('\n')+'\n'
 return {records,body,byKind,exportedAt,archived:records.filter(r=>r.ticket?.status==='closed'&&Date.parse(exportedAt)-Date.parse(r.ticket.updated_at)>=120*86400000).map(r=>String(r.ticket.id))}
}
