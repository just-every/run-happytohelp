import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
// A synthetic Zendesk account at the network edge: OAuth (public PKCE client),
// incremental cursor exports, cursor-paged comments, show_many and Help Center.
// No real account, customer or name; every value here is invented.
export const SUBDOMAIN='synthetic-hh',CLIENT_ID='synthetic-hh-public-client',ORIGIN=`https://${SUBDOMAIN}.zendesk.com`
export const PATH_TOKEN='synthetic-hh-path-token-9f8e7d',QUERY_TOKEN='synthetic-hh-query-token-1a2b3c'
// The account's own attachment host, where its downloads redirect, and a host it does not own.
export const FILES_ORIGIN=`https://${SUBDOMAIN}.zdusercontent.com`,FOREIGN_ORIGIN='https://synthetic-elsewhere.example'
const attachmentToken=id=>`synthetic-hh-attachment-token-${id}`,signedToken=id=>`synthetic-hh-signed-${id}`
/** Invented bytes: a 60 KiB zip-typed file (over the old 48 KiB cap, outside the old six types) and a small CSV. */
export const ATTACHMENT_BYTES={81001:Buffer.from(Array.from({length:60*1024},(_,i)=>(i*131+7)%256)),81002:Buffer.from('synthetic-hh,internal\n1,2\n'),70501:Buffer.from(Array.from({length:68},(_,i)=>(i*17)%256)),81006:Buffer.from('%PDF-synthetic-hh later reply\n'),81007:Buffer.from('synthetic-hh later internal note file\n'),
 // Once the account changes again: a file served without Content-Length, two plain files, one whose body runs past its size and one over Zendesk's 50 MB maximum by its size.
 81008:Buffer.from(Array.from({length:20*1024},(_,i)=>(i*29+3)%256)),81013:Buffer.from(Array.from({length:12*1024},(_,i)=>(i*7+1)%256)),81014:Buffer.from('synthetic-hh third new ticket file\n'),81009:Buffer.from('synthetic-hh body that runs past its size\n'),81010:Buffer.from('synthetic-hh says it is too large\n')}
// Served without Content-Length, so their known length is Zendesk's size; 81009's size is shorter than its body.
const UNSIZED=new Set([81008,81009,81010]),SIZES={81009:10,81010:60*1024*1024}
const file=(id,name,type,size,extra={})=>({id,file_name:name,content_type:type,size,inline:false,deleted:false,malware_scan_result:'malware_not_found',malware_access_override:false,content_url:`${ORIGIN}/attachments/token/${attachmentToken(id)}/?name=${name}`,mapped_content_url:`${ORIGIN}/attachments/token/${attachmentToken(id)}/?name=${name}`,url:`${ORIGIN}/api/v2/attachments/${id}.json`,thumbnails:[],...extra})
const at=day=>`2024-01-${String(day).padStart(2,'0')}T00:00:00Z`,stamp=(day,second)=>`2024-01-${String(day).padStart(2,'0')}T${String(Math.floor(second/3600)%24).padStart(2,'0')}:${String(Math.floor(second/60)%60).padStart(2,'0')}:${String(second%60).padStart(2,'0')}Z`
const inline=id=>({id,file_name:'inline.png',content_type:'image/png',size:68,inline:true,content_url:`${ORIGIN}/attachments/token/${PATH_TOKEN}/?name=inline.png`,mapped_content_url:`${ORIGIN}/attachments/token/${PATH_TOKEN}/?name=inline.png`,url:`${ORIGIN}/api/v2/attachments/${id}.json`,thumbnails:[]})
const comment=(id,author,day,text,visible=true,extra={})=>({id,type:'Comment',author_id:author,body:text,html_body:`<div class="zd-comment"><p>${text}</p></div>`,plain_body:text,public:visible,attachments:[],audit_id:id+50000,via:{channel:'email',source:{from:{},to:{},rel:null}},created_at:typeof day==='string'?day:at(day),metadata:{system:{client:'synthetic-hh-client'},custom:{}},...extra})
const ticket=(id,requester,status,subject,extra={})=>({url:`${ORIGIN}/api/v2/tickets/${id}.json`,id,external_id:null,via:{channel:'email',source:{from:{},to:{},rel:null}},created_at:at(2),updated_at:at(3),generated_timestamp:1704250000+id,type:null,subject,raw_subject:subject,description:subject,priority:null,status,recipient:null,requester_id:requester,submitter_id:requester,assignee_id:2,organization_id:null,group_id:null,collaborator_ids:[],follower_ids:[],email_cc_ids:[],forum_topic_id:null,problem_id:null,has_incidents:false,is_public:true,due_at:null,tags:['synthetic-hh-tag'],custom_fields:[{id:70,value:null},{id:72,value:null}],satisfaction_rating:null,sharing_agreement_ids:[],custom_status_id:null,fields:[],followup_ids:[],ticket_form_id:null,brand_id:1,allow_channelback:false,allow_attachments:true,from_messaging_channel:false,...extra})
const user=(id,role,extra={})=>({id,url:`${ORIGIN}/api/v2/users/${id}.json`,name:`synthetic-hh person ${id}`,email:`synthetic-hh-${id}@example.test`,created_at:at(1),updated_at:at(4),last_login_at:at(5),time_zone:'UTC',locale:'en-US',role,verified:true,active:true,organization_id:null,phone:null,photo:{id:id+900,content_url:`${ORIGIN}/system/photos/${id}/avatar.png?token=${QUERY_TOKEN}`,thumbnails:[]},tags:[],user_fields:{},...extra})
/** At least 400 KiB of sanitized JSON in 300 comments, public and private mixed. */
export function largeComments(){return Array.from({length:300},(_,i)=>comment(40000+i,i%2?2:4,stamp(6,i*60),`synthetic-hh long history ${i} `+'lorem ipsum dolor sit amet '.repeat(16),i%3!==2))}
/** With edgeCases, the account also holds what real accounts hold at their edges. From the
 * start: person 8, a chat visitor with no email, requests ticket 109, whose description only
 * starts like a link and whose chat transcript Zendesk itself wrote (author -1); ticket 110's
 * requester, person 9, is no longer in Zendesk. Once it has changed: person 6, whose email is
 * malformed, requests ticket 108, and agent 2 raises ticket 111 for themselves. */
/** With attachments, comments on tickets 101 and 102 carry files: a public zip and a private
 * note's CSV whose downloads redirect to the account's own attachment host (the zip's first
 * download is throttled with Retry-After), a file on a host the account does not own, one
 * whose download redirects to such a host, and a deleted one; once it has changed, 101's new
 * reply and private note each carry a file too. Tickets in state.gone are no longer returned.
 * With attachments and state.again, the account changes further: from 1, new tickets 113-115
 * each carry files (113's is served without Content-Length); from 2, ticket 102 gains a reply
 * whose file's body runs past its size and a private note whose file is over 50 MB by its size.
 * holdDownload(id,host) holds that file's next download on that host open, its body half
 * sent, until release(). Without these, the account is exactly as before. */
export function fakeZendesk({edgeCases=false,credentialTicket=false,attachments=false}={}){
 const state={authorizations:new Map(),grants:new Map(),access:new Set(),refresh:new Set(),tokenRequests:[],requests:[],throttled:false,issued:0,repeat:false,downloads:[],downloadThrottled:false,gone:new Set(),again:0,hold:null}
 const users=[user(1,'end-user',{organization_id:7}),user(2,'agent'),user(3,'end-user'),user(4,'end-user'),user(5,'end-user'),...(edgeCases?[user(8,'end-user',{email:null})]:[])]
 const tickets={
  101:{record:ticket(101,1,'open','synthetic-hh open order question',{custom_fields:[{id:70,value:true},{id:72,value:null}]}),comments:[comment(10101,1,2,'synthetic-hh where is my order',true,attachments?{attachments:[file(81001,'synthetic-hh-report.zip','application/zip',ATTACHMENT_BYTES[81001].length),{...file(81003,'synthetic-hh-elsewhere.pdf','application/pdf',10),content_url:`${FOREIGN_ORIGIN}/attachments/token/${attachmentToken(81003)}/?name=elsewhere.pdf`}]}:{}),comment(10102,2,3,'synthetic-hh internal check',false,attachments?{attachments:[file(81002,'synthetic-hh-internal.csv','text/csv',ATTACHMENT_BYTES[81002].length)]}:{})]},
  // Archived: closed long ago. Listing Tickets omits these; the incremental export returns them.
  102:{record:ticket(102,3,'closed','synthetic-hh archived refund'),comments:[comment(10201,3,2,'synthetic-hh refund please',true,attachments?{attachments:[file(81004,'synthetic-hh-moved.png','image/png',10),file(81005,'synthetic-hh-deleted.png','image/png',10,{deleted:true})]}:{}),comment(10202,2,3,'synthetic-hh refunded on page two')]},
  103:{record:ticket(103,3,'deleted','synthetic-hh deleted spam'),comments:[]},
  104:{record:ticket(104,4,'solved','synthetic-hh very long thread'),comments:largeComments()},
  105:{record:ticket(105,5,'pending','synthetic-hh screenshot attached'),comments:[comment(10501,5,2,`synthetic-hh see screenshot ${ORIGIN}/attachments/token/${PATH_TOKEN}/?name=inline.png`,true,{attachments:[inline(70501)]})]},
  106:{record:ticket(106,1,'new','synthetic-hh follow-up after the move'),comments:[comment(10601,1,8,'synthetic-hh one more question'),comment(10602,2,8,'synthetic-hh answered',true)]},
  107:{record:ticket(107,3,'new','synthetic-hh question from a renamed person'),comments:[comment(10701,3,8,'synthetic-hh hello again')]},
  ...(credentialTicket?{112:{record:ticket(112,1,'open','synthetic-hh credential in ticket text',{description:'?api_key=synthetic-hh-refused-secret'}),comments:[comment(11201,1,2,'synthetic-hh credential in ticket text')]}}:{}),
  ...(edgeCases?{
   109:{record:ticket(109,8,'open','synthetic-hh chat without an address',{description:'http:// see below',via:{channel:'chat',source:{from:{},to:{},rel:null}}}),comments:[comment(10901,8,2,'synthetic-hh no address on file'),comment(10902,-1,3,'synthetic-hh chat transcript',true,{via:{channel:'chat_transcript',source:{from:{},to:{},rel:null}}})]},
   110:{record:ticket(110,9,'open','synthetic-hh question from a person since removed'),comments:[comment(11001,9,2,'synthetic-hh hello from a removed person')]},
   108:{record:ticket(108,6,'new','synthetic-hh question from a new person with a malformed address'),comments:[comment(10801,6,8,'synthetic-hh hello from a new person')]},
   111:{record:ticket(111,2,'open','synthetic-hh agent raised this themselves'),comments:[comment(11101,2,8,'synthetic-hh follow up with the courier'),comment(11102,2,8,'synthetic-hh internal reminder',false)]},
  }:{}),
 }
 // After the first pull: ticket 101 gets a new public reply and a private note, ticket 102 changes status,
 // person 3 is renamed, the organization changes, and tickets 106 and 107 are new.
 const changed={101:{record:{...tickets[101].record,updated_at:at(9)},comments:[...tickets[101].comments,comment(10103,1,9,'synthetic-hh a reply after the move',true,attachments?{attachments:[file(81006,'synthetic-hh-later.pdf','application/pdf',ATTACHMENT_BYTES[81006].length)]}:{}),comment(10104,2,9,'synthetic-hh internal follow-up',false,attachments?{attachments:[file(81007,'synthetic-hh-later-internal.txt','text/plain',ATTACHMENT_BYTES[81007].length)]}:{})]},102:{record:{...tickets[102].record,status:'solved',updated_at:at(9)},comments:tickets[102].comments}}
 const renamed={...users[2],name:'synthetic-hh person 3 renamed',updated_at:at(9)},arrived=edgeCases?[user(6,'end-user',{email:'not-an-email',created_at:at(8),updated_at:at(8)})]:[]
 // Once it changes again: new tickets with files, then a reply and a private note on 102 whose files are refused.
 const arriving=attachments?{113:{record:ticket(113,1,'open','synthetic-hh new ticket with an unsized file',{created_at:at(10),updated_at:at(10)}),comments:[comment(11301,1,10,'synthetic-hh first new file',true,{attachments:[file(81008,'synthetic-hh-unsized.bin','application/octet-stream',ATTACHMENT_BYTES[81008].length)]})]},114:{record:ticket(114,4,'open','synthetic-hh new ticket with a held file',{created_at:at(10),updated_at:at(10)}),comments:[comment(11401,4,10,'synthetic-hh second new file',true,{attachments:[file(81013,'synthetic-hh-held.bin','application/octet-stream',ATTACHMENT_BYTES[81013].length)]})]},115:{record:ticket(115,5,'open','synthetic-hh new ticket with a text file',{created_at:at(10),updated_at:at(10)}),comments:[comment(11501,5,10,'synthetic-hh third new file',true,{attachments:[file(81014,'synthetic-hh-third.txt','text/plain',ATTACHMENT_BYTES[81014].length)]})]}}:{}
 const again=attachments?{102:{record:{...changed[102].record,updated_at:at(10)},comments:[...tickets[102].comments,comment(10203,3,10,'synthetic-hh a reply with an overlong file',true,{attachments:[file(81009,'synthetic-hh-overlong.pdf','application/pdf',SIZES[81009])]}),comment(10204,2,10,'synthetic-hh a note with an oversized file',false,{attachments:[file(81010,'synthetic-hh-oversized.zip','application/zip',SIZES[81010])]})]}}:{}
 const arrived1=()=>state.again>=1?Object.keys(arriving).map(Number):[]
 const current=id=>state.again>=2&&again[id]?again[id]:state.again>=1&&arriving[id]?arriving[id]:state.repeat&&changed[id]?changed[id]:tickets[id],people=()=>state.repeat?[...users.map(u=>u.id===3?renamed:u),...arrived]:users
 const field=(id,type,title,extra={})=>({url:`${ORIGIN}/api/v2/ticket_fields/${id}.json`,id,type,title,raw_title:title,description:'',raw_description:'',position:id,active:true,required:false,collapsed_for_agents:false,regexp_for_validation:null,title_in_portal:title,raw_title_in_portal:title,visible_in_portal:true,editable_in_portal:true,required_in_portal:false,tag:null,created_at:at(1),updated_at:at(1),removable:true,key:null,agent_description:null,agent_can_edit:true,...extra})
 const fields=[field(70,'checkbox','Synthetic flag'),field(71,'subject','Subject',{removable:false}),field(72,'text','Synthetic agent note',{visible_in_portal:false,editable_in_portal:false})]
 const article=(id,title,draft,segment)=>({id,url:`${ORIGIN}/api/v2/help_center/en-us/articles/${id}.json`,html_url:`https://${SUBDOMAIN}.zendesk.com/hc/en-us/articles/${id}`,author_id:2,comments_disabled:false,draft,promoted:false,position:0,vote_sum:0,vote_count:0,section_id:900,created_at:at(1),updated_at:at(2),name:title,title,source_locale:'en-us',locale:'en-us',outdated:false,outdated_locales:[],edited_at:at(2),user_segment_id:segment,user_segment_ids:segment===null?[]:[segment],permission_group_id:1,content_tag_ids:[],label_names:[],body:`<p>${title} body</p>`})
 const articles=[article(801,'Synthetic public guide',false,null),article(802,'Synthetic draft guide',true,null),article(803,'Synthetic agents-only guide',false,5)]
 const organization={id:7,url:`${ORIGIN}/api/v2/organizations/7.json`,name:'synthetic-hh workshop',shared_tickets:false,shared_comments:false,external_id:null,created_at:at(1),updated_at:at(1),domain_names:['synthetic-hh.example'],details:'',notes:'',group_id:null,tags:[],organization_fields:{}}
 const companies=()=>[state.repeat?{...organization,name:'synthetic-hh workshop renamed',updated_at:at(9)}:organization]
 const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}})
 const bearer=request=>{const value=request.headers.get('Authorization')?.replace(/^Bearer /,'');assert.ok(value&&state.access.has(value),'Zendesk read with a live rotated access token');return value}
 const cursorPage=(rows,request,key,size=100)=>{const url=new URL(request.url),after=url.searchParams.get('page[after]'),start=after?Number(after):0,page=rows.slice(start,start+size),more=start+size<rows.length;return json({[key]:page,meta:{has_more:more,after_cursor:more?String(start+size):null,before_cursor:null},links:{next:more?`${ORIGIN}/elsewhere`:null}})}
 const grant=(lifetime)=>{const access=`synthetic-access-${++state.issued}`,refresh=`synthetic-refresh-${state.issued}`;state.access.add(access);state.refresh.add(refresh);return {access_token:access,refresh_token:refresh,token_type:'bearer',scope:'read hc:read',expires_in:lifetime,refresh_token_expires_in:7776000}}
 // A download held open: its headers and half its body arrive, the rest never does.
 function held(id,host){
  state.downloads.push({host,id,held:true});state.hold.arrived()
  const bytes=ATTACHMENT_BYTES[id]??Buffer.alloc(10)
  return new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,bytes.length>>1))}}),{status:200,headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)}})
 }
 function holdDownload(id,host){return new Promise(arrived=>{state.hold={id,host,arrived}})}
 const release=()=>{state.hold=null}
 async function handler(request){
  const url=new URL(request.url)
  if(attachments&&url.origin===FILES_ORIGIN){
   // The account's attachment host: a signed, temporary link, never the API token.
   assert.equal(request.headers.get('Authorization'),null,'the attachment host never receives the token')
   const found=url.pathname.match(/^\/attachment\/(\d+)\//),id=found&&Number(found[1])
   if(state.hold?.id===id&&state.hold.host==='files')return held(id,'files')
   state.downloads.push({host:'files',id})
   assert.equal(url.searchParams.get('token'),signedToken(id))
   if(UNSIZED.has(id))return new Response(new ReadableStream({start(c){const bytes=ATTACHMENT_BYTES[id];c.enqueue(bytes.subarray(0,bytes.length>>1));c.enqueue(bytes.subarray(bytes.length>>1));c.close()}}),{status:200,headers:{'Content-Type':'application/octet-stream'}})
   return new Response(ATTACHMENT_BYTES[id],{status:200,headers:{'Content-Type':'application/octet-stream','Content-Length':String(ATTACHMENT_BYTES[id].length)}})
  }
  assert.equal(url.origin,ORIGIN,'every request goes to the connected subdomain')
  state.requests.push({method:request.method,path:url.pathname,search:url.search})
  if(url.pathname==='/oauth/tokens'){
   assert.equal(request.method,'POST')
   const body=await request.json();state.tokenRequests.push(body)
   assert.equal(body.client_secret,undefined,'a public client sends no secret');assert.equal(body.client_id,CLIENT_ID)
   assert.equal(body.expires_in,172800);assert.equal(body.refresh_token_expires_in,7776000)
   if(body.grant_type==='authorization_code'){
    const issued=state.grants.get(body.code);assert.ok(issued,'known authorization code');state.grants.delete(body.code)
    assert.equal(body.redirect_uri,issued.redirect_uri)
    assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),issued.challenge,'verifier matches the S256 challenge')
    // A short first lifetime makes the pull refresh before it reads.
    return json(grant(60),201)
   }
   assert.equal(body.grant_type,'refresh_token');assert.ok(state.refresh.delete(body.refresh_token),'refresh token is single use')
   state.access.clear();return json(grant(172800),201)
  }
  assert.ok(request.method==='GET'||request.method==='DELETE'&&url.pathname==='/api/v2/oauth/tokens/current.json',`${request.method} ${url.pathname}`)
  const token=bearer(request)
  if(request.method==='DELETE'){state.access.delete(token);return new Response(null,{status:204})}
  if(url.pathname==='/api/v2/ticket_fields.json')return cursorPage(fields,request,'ticket_fields')
  if(url.pathname==='/api/v2/help_center/articles.json')return cursorPage(articles,request,'articles')
  // Each export from the start returns the account as it is now; after a cursor, only what changed.
  if(url.pathname==='/api/v2/incremental/organizations.json'){const start=Number(url.searchParams.get('start_time'));return json(start===0?{organizations:companies(),end_time:1704100000,end_of_stream:true,next_page:null,count:1}:state.repeat&&start===1704100000?{organizations:companies(),end_time:1704200000,end_of_stream:true,next_page:null,count:1}:{organizations:[],end_time:start,end_of_stream:true,next_page:null,count:0})}
  if(url.pathname==='/api/v2/incremental/users/cursor.json'){if(url.searchParams.get('start_time')==='0')return json({users:people(),after_cursor:'users-after-1',before_cursor:null,end_of_stream:true});assert.equal(url.searchParams.get('cursor'),'users-after-1');return json({users:state.repeat?[renamed,...arrived]:[],after_cursor:'users-after-1',end_of_stream:true})}
  if(url.pathname==='/api/v2/incremental/tickets/cursor.json'){
   assert.equal(url.searchParams.get('support_type_scope'),'all');assert.equal(url.searchParams.get('exclude_deleted'),null)
   const cursor=url.searchParams.get('cursor')
   if(url.searchParams.get('start_time')==='0')return json({tickets:[101,102,103].map(id=>current(id).record),after_cursor:'tickets-after-1',end_of_stream:false})
   if(cursor==='tickets-after-1')return json({tickets:[104,105,...(state.repeat?[106,107]:[]),...(edgeCases?[109,110,...(state.repeat?[108,111]:[])]:[]),...(credentialTicket?[112]:[]),...arrived1()].map(id=>current(id).record),after_cursor:'tickets-after-2',end_of_stream:true})
   assert.ok(['tickets-after-2','tickets-after-3'].includes(cursor),cursor);return json({tickets:state.repeat&&(cursor==='tickets-after-2'||state.again)?[101,102,106,107,...(edgeCases?[108,111]:[]),...arrived1()].map(id=>current(id).record):[],after_cursor:'tickets-after-3',end_of_stream:true})
  }
  // Ticket 105's inline image keeps its original path token.
  const download=attachments&&url.pathname.match(new RegExp(`^/attachments/token/(?:synthetic-hh-attachment-token-(\\d+)|(${PATH_TOKEN}))/$`))
  if(download){
   const id=download[2]?70501:Number(download[1]);bearer(request)
   if(state.hold?.id===id&&state.hold.host==='account')return held(id,'account')
   state.downloads.push({host:'account',id})
   if(id===81001&&!state.downloadThrottled){state.downloadThrottled=true;return new Response('',{status:429,headers:{'Retry-After':'1'}})}
   return new Response(null,{status:302,headers:{Location:id===81004?`${FOREIGN_ORIGIN}/attachment/${id}/moved.png?token=${signedToken(id)}`:`${FILES_ORIGIN}/attachment/${id}/file?token=${signedToken(id)}`}})
  }
  const comments=url.pathname.match(/^\/api\/v2\/tickets\/(\d+)\/comments\.json$/)
  if(comments){
   if(state.gone.has(comments[1]))return json({error:'RecordNotFound'},404)
   assert.equal(url.searchParams.get('include_inline_images'),'true')
   if(comments[1]==='101'&&!state.throttled){state.throttled=true;return new Response('{"error":"TooManyRequests"}',{status:429,headers:{'Retry-After':'1','Content-Type':'application/json'}})}
   const entry=current(comments[1]);if(!entry||entry.record.status==='deleted')return json({error:'RecordNotFound'},404)
   return cursorPage(entry.comments,request,'comments',comments[1]==='102'?1:100)
  }
  const many=url.pathname.match(/^\/api\/v2\/(users|organizations)\/show_many\.json$/)
  if(many){const wanted=new Set(url.searchParams.get('ids').split(',').map(Number)),source=many[1]==='users'?people():companies();return json({[many[1]]:source.filter(row=>wanted.has(row.id))})}
  return json({error:'InvalidEndpoint'},404)
 }
 /** What Zendesk's consent page does once the admin approves: the code goes back to the callback. */
 function consent(authorizeUrl){
  const url=new URL(authorizeUrl),p=url.searchParams
  assert.equal(url.origin,ORIGIN);assert.equal(url.pathname,'/oauth/authorizations/new')
  assert.equal(p.get('response_type'),'code');assert.equal(p.get('client_id'),CLIENT_ID);assert.equal(p.get('scope'),'read hc:read');assert.equal(p.get('code_challenge_method'),'S256')
  assert.match(p.get('code_challenge'),/^[A-Za-z0-9_-]{43}$/);assert.match(p.get('state'),/^[A-Za-z0-9_-]{43}$/)
  const code=`synthetic-code-${state.grants.size+1}`;state.grants.set(code,{challenge:p.get('code_challenge'),redirect_uri:p.get('redirect_uri')})
  return {code,state:p.get('state'),redirectUri:p.get('redirect_uri')}
 }
 return {handler,consent,state,tickets,holdDownload,release}
}
