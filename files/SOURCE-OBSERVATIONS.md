Actual source observations at 9c123887be64e57e612ae5da22a49447d284e81a

Selected public source only. No commands in this file were executed as tests.

### CONTRACT.md

```text
366: #### OUTBOUND-001 — Agent-created and proactive tickets
367: 
368: *Tier:* Core · *Cites:* BASE-ROLE-001 · *Register:* R-2
369: 
370: **Requirement.** From the inbox an operator creates a ticket for an existing or new contact: search by name, email or phone or create the contact inline under CUSTOMER-001 identity rules; choose brand, sender address, channel, form, fields, assignee and group; and make the first comment public or an internal note. A public first comment is sent as an outbound email, or, where the customer consented, as an approved SMS/WhatsApp template under CHANNELS-001. The customer is recorded as requester and the operator as submitter, and the customer's reply threads into the same ticket. Logging a phone call or walk-in creates a ticket without contacting the customer. Proactive service notices to several customers (for example a delayed order) create one ticket per requester with a preview, consent checks and rate limits, never send twice on retry and remain distinct from marketing campaigns, which belong to Mango.
371: 
372: **Acceptance.**
373: 1. From the inbox create a ticket for an existing contact and one for a new contact, send the first public email, reply as each customer from a provider mailbox sandbox or official-schema fake and confirm the reply threads into the created ticket with requester and submitter attribution.
374: 2. Create an internal-only ticket (no send), a WhatsApp-template ticket to an opted-in number and one to an opted-out number (refused), and a proactive notice to three contacts with one failed send; verify no duplicate send on retry and refusal for an operator without create authority.
375: 
```

### src/modules/management/outbound-ticket-input.ts

```text
5: export interface OutboundTicketInput {[noticeCommand]?:string;kind:'email'|'call'|'sms'|'whatsapp';requesterPhone?:string;connectionId?:string;templateId?:string;parameters?:string[];localId:string;requesterId:string|null;requesterEmail:string|null;requesterName:string;subject:string;content:string;mailboxId:string|null;fromAddress:string|null;cc:string[];bcc:string[];formId?:string;fields?:Record<string,unknown>;groupId?:string|null;assigneeId?:string|null}
16: export function outboundTicketInput(body:Record<string,unknown>):OutboundTicketInput{
17:  if(!body||!['email','call','sms','whatsapp'].includes(String(body.kind)))throw new HTTPException(400,{message:'Choose email, call, SMS or WhatsApp'})
18:  const kind=body.kind as OutboundTicketInput['kind'],localId=string(body.localId,'localId',200),requesterId=body.requesterId===undefined?null:string(body.requesterId,'requesterId',200),requesterEmail=body.requesterEmail===undefined?null:emailAddress(body.requesterEmail),requesterName=body.requesterName===undefined?'':string(body.requesterName,'requesterName',200,false)
19:  if(reservedLocalId(localId))throw new HTTPException(400,{message:'Reserved local id prefix'})
20:  if(body.requesterEmail!==undefined&&(!requesterEmail||String(body.requesterEmail).trim().toLowerCase()!==requesterEmail))throw new HTTPException(400,{message:'Invalid requester email'})
21:  if(!['sms','whatsapp'].includes(kind)&&!requesterId&&!requesterEmail)throw new HTTPException(400,{message:'Provide a requester or requester email'})
22:  const fromAddress=body.fromAddress===undefined?null:emailAddress(body.fromAddress)
23:  if(body.fromAddress!==undefined&&(!fromAddress||String(body.fromAddress).trim().toLowerCase()!==fromAddress))throw new HTTPException(400,{message:'Invalid sender address'})
24:  const subject=string(body.subject,'subject',500),content=string(body.content,'content',100000),cc=addresses(body.cc,'CC'),bcc=addresses(body.bcc,'BCC'),mailboxId=kind==='email'?string(body.mailboxId,'mailboxId',200):null
25:  if(/[\r\n]/.test(subject))throw new HTTPException(400,{message:'Subject must fit on one line'})
26:  if(cc.length+bcc.length>50||cc.some(address=>bcc.includes(address)))throw new HTTPException(400,{message:'Recipients must be unique across CC and BCC'})
27:  if(kind==='call'&&(cc.length||bcc.length||fromAddress))throw new HTTPException(400,{message:'Call logs cannot send email copies'})
44:  return {...channel,kind,localId,requesterId,requesterEmail,requesterName,subject,content,mailboxId,fromAddress,cc,bcc,...configuration}
```

### src/modules/management/outbound-tickets.ts

```text
23:  async function create(c:Context<AppEnv>,actor:Actor,input:OutboundTicketInput,notice=false){
24:   await requireDestinationScope(c.env,actor,input.groupId??null)
25:   const sessionHash=c.get('sessionHash')
26:   if(input.kind==='email'&&!onCommittedMessage)throw new HTTPException(503,{message:'Outbound email delivery is unavailable'})
27:   const channel=await outboundChannel(c.env,actor,input)
28:   const reservation=await reserveOutboundTicket(c.env,actor,sessionHash,input,channel),conversation=await c.env.DB.prepare(`SELECT c.* FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1`).bind(reservation.conversationId,actor.projectId).first()
29:   if(!conversation)throw new HTTPException(409,{message:'Requester is unavailable'})
30:   if(input.kind==='call'){
31:    const note=await logOutboundCall(c.env,actor,sessionHash,reservation.conversationId,input.content)
32:    return {accepted:true,duplicate:reservation.duplicate,conversation,note}
33:   }
34:   const result=await admitMessage(c.env,{[preserveAssignment]:true,requireAvailableRequester:true,projectId:actor.projectId,conversationId:reservation.conversationId,actor,sessionHash,localId:input.localId,content:channel?.content??input.content,...(channel?{[messageAuthority]:{sql:channel.sql,args:channel.args}}:{}),expectedRevision:0,expectedLastMessageId:null,...(input[noticeCommand]?{[messageCommitStatements]:(messageId:string)=>[c.env.DB.prepare(`UPDATE outbound_notice_commands SET receipts_json=json_set(receipts_json,?,?) WHERE project_id=? AND id=? AND outcome='succeeded' AND EXISTS(SELECT 1 FROM conversation_outbox WHERE project_id=? AND conversation_id=? AND message_id=?)`).bind(`$."${input.localId}".messageId`,messageId,actor.projectId,input[noticeCommand],actor.projectId,reservation.conversationId,messageId)]}:{})})
35:   if(!result.accepted)return {...result,conversation}
48:   }else if(!result.duplicate){
49:    const defer:DeferEmailDelivery=delivery=>c.executionCtx.waitUntil(delivery.catch(()=>{console.error('Outbound ticket email failed; durable delivery status retained')}))
50:    try{await onCommittedMessage!(c.env,result.message!,actor,defer)}catch(error){generationError=error instanceof Error?error.message:String(error)}
51:   }
```

### src/modules/management/outbound-ticket-store.ts

```text
63: export async function logOutboundCall(env:Env,actor:Actor,sessionHash:string,conversationId:string,content:string){
64:  const noteId=`call-${conversationId}`,now=Date.now(),authority=await outboundTicketAuthority(env,actor,sessionHash)
65:  await env.DB.prepare(`INSERT OR IGNORE INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT ?,c.id,?,?,? FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND ${writableContact} AND ${ticketScopeSql('?')} AND EXISTS(${authority.sql})`).bind(noteId,actor.id,content,now,conversationId,actor.projectId,actor.id,...authority.params).run()
66:  const note=await env.DB.prepare(`SELECT n.* FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE n.id=? AND c.project_id=? AND ${writableContact} AND ${ticketScopeSql('?')} AND EXISTS(${authority.sql})`).bind(noteId,actor.projectId,actor.id,...authority.params).first()
67:  if(!note)throw new HTTPException(409,{message:'Call log admission denied'})
68:  return note
```

### src/ui/dashboard/components/CreateEmailTicket.jsx

```text
102:      {!channelTicket&&draft.kind !== 'call' && <><EmailSender mailboxes={mailboxes||[]} mailboxId={draft.mailboxId} fromAddress={draft.fromAddress} onChange={patch=>setDraft(current=>({...current,...patch}))}/>{mailboxes===null&&<p role="status">Loading mailboxes…</p>}{draft.kind==='email'&&<EmailRecipients cc={draft.cc} bcc={draft.bcc} onChange={change}/>}</>}
118:    </Modal.Body>
119:    <Modal.Footer>{preview&&!results&&!uncertain&&<button className="btn btn-white" type="button" disabled={busy} onClick={()=>{setPreview(null);intent.current=null;}}>Edit notice</button>}<button className="btn btn-white" type="button" disabled={busy||uncertain} onClick={close}>{results?'Close':'Cancel'}</button>{(!results||uncertain)&&<button className="btn btn-primary" type="submit" disabled={busy || (!uncertain&&(!options||!!choicesError)) || (!uncertain && !channelTicket && draft.kind!=='call' && !draft.mailboxId)}>{busy?'Creating…':uncertain?'Check same request':channelTicket?'Create and send':draft.kind==='call'?'Log call':draft.kind==='notice'?(preview?'Confirm and email':'Preview recipients'):'Create and email'}</button>}</Modal.Footer>
120:   </form>
121:  </Modal>;
122: }
```

### tests/helpers/email/outbound-configuration.mjs

```text
15:   const command={kind:'email',localId:'configured-existing',requesterId:contact.id,mailboxId:mailbox.id,subject:'Your replacement shipment',content:'Your replacement leaves today.',formId:form.id,fields:{[choice.id]:'replacement',[text.id]:'Leave at reception',[count.id]:2,[decimal.id]:1.25,[date.id]:'2026-11-03',[multi.id]:['fragile','signature'],[check.id]:false,[regex.id]:'ORDER'},groupId:group.id,assigneeId:workspace.users.admin}
73:   const callCommand={kind:'call',localId:'configured-inline-call',requesterEmail:'new@customer.example',requesterName:'Synthetic Rosa',subject:'Collection call',content:'Confirmed collection privately.',formId:form.id,fields:{[choice.id]:'return',[count.id]:1},groupId:null,assigneeId:null}
74:   const call=await app.ok(base,{...operator,body:callCommand});assert.equal(call.conversation.assigned_to,null);assert.equal(call.conversation.group_id,null);assert.notEqual(call.conversation.contact_id,contact.id);assert.equal(call.conversation.requester_id,call.conversation.contact_id);assert.equal(call.conversation.submitter_id,workspace.users.operator);assert.equal(call.message,undefined);assert.equal(sent.length,1)
```

### tests/journeys/email.mjs

```text
9: test('a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome',async()=>{
10:  await localMailJourney()
11:  await completeEmailJourney()
12:  await notificationOutcomesJourney()
13:  await completeMailOutcomes()
14:  await conversationActionsJourney()
15: })
```

### tests/journeys/inbox-browser.mjs

```text
1: import {newTicketConfigurationBrowser} from '../helpers/inbox/new-ticket-configuration.mjs'
2: import {customerScreenOutcomes} from '../helpers/customer-outcomes-edges.mjs'
3: import {voiceBrowserProof} from '../helpers/voice/browser.mjs'
4: import test from 'node:test'
5: import {brandsBrowser} from '../helpers/inbox/brands-browser.mjs'
6: import {collaborationBrowser} from '../helpers/inbox/desk-collaboration.mjs'
7: import {mobileInbox} from '../helpers/inbox/mobile-inbox-browser.mjs'
8: 
9: test('two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening',async()=>{await brandsBrowser();await voiceBrowserProof();await newTicketConfigurationBrowser()})
```

### src/modules/move-in/readers/normalise.ts

```text
23: /** Records the mapping derives from the export: tag names, and for Zendesk each staff requester's inert contact. */
24: export function withDerivedRecords(source:SourceBundle,vendor:Vendor):SourceBundle {
25:  const seen=new Set<string>(),added:SourceRecord[]=[]
26:  for(const record of source.records.filter(r=>['ticket','conversation'].includes(r.kind)||vendor==='helpscout'&&r.kind==='tag'||vendor==='zendesk'&&['macro','trigger','automation'].includes(r.kind)))for(const name of vendor==='zendesk'&&['macro','trigger','automation'].includes(record.kind)?configurationTags(record):tags(record)){if(name.trim().length>80){source.diagnostics.push({severity:'error',code:'tag_name_limit',message:'Tag names longer than 80 characters are not imported',location:record.location});continue}const key=tagKey(name);if(seen.has(key))continue;if(source.records.length+added.length>=LIMITS.records)throw new Error('export_record_limit');seen.add(key);added.push(sourceRecord(vendor,'tag-name',key,{name:name.trim()},record.location.artifact,record.artifactHash,record.location.row??1,`${record.location.pointer??''}/tags`))}
27:  if(vendor==='zendesk')added.push(...staffRequesters(source.records,source.records.length+added.length))
28:  return {...source,records:[...added,...source.records].sort((a,b)=>rank(a.kind)-rank(b.kind))}
29: }
```

### docs/moving-in.md

```text
13: Uploads are limited to 2 MiB, with at most 2 MiB of expanded source bytes, 64 ZIP entries, 5,000 source and derived-tag records and 128 KiB per record. ZIP is a packaging option for supported files. It is not a claim that either vendor's export service produces ZIP. Split larger exports into smaller complete batches, each including the contacts needed by its conversations. Keep the source files until you have checked the report.
14: 
15: Planning reads only candidate native identities and complete related target bundles. A persisted email index preserves Unicode comparisons and reconciles at most 100 changed native contacts per background turn; unrelated workspace history is not accumulated in memory. A native target larger than 512 KiB, or combined native candidates larger than 8 MiB, is reported as a review-size conflict before its content is loaded. Parsing indexes structural source offsets and physical lines once per file, then stages at most 100 records per batch from those saved positions. Archive extraction stages at most 20 entries per batch. One immutable review covers the whole import. Internally, reviewed plans contain at most twenty source records, 512 KiB of estimated decision material and 1 MiB of serialized plan data; an individual decision beyond that bound is refused. Large conversation bundles get a plan of their own; any record needing more than 750 native SQL writes is rejected during review with its source location. A review supports at most 300 internal plans; a larger expansion is refused before approval. Application and undo process at most twenty source records or target bundles per batch, with an additional whole-invocation D1 statement cap. Durable child journals apply in dependency order and undo in reverse order while the report shows global progress. Original uploads and extracted source bytes are retained in private object storage. The global review binds the exact original upload and parsed files by private object key, size and digest; every apply/undo invocation verifies those bytes again. Each smaller Base journal retains its reviewed decisions, source digests and provenance, and explicitly marks original bytes unavailable within that child journal. Exact bytes live in the private group custody, not duplicated in every child journal. Erasure fences the entire group before removing all child journals and source objects.
16: 
17: Unsupported records and fields are reported rather than turned into guessed data. Attachment metadata stays in the original unless explicitly supplied Freshdesk or offline Zendesk bytes pass the checks below. Intercom and Help Scout do not yet attach bytes to native messages. Automation, assignment rules, external actions, company and segment rules, and unsupported conversation parts are not activated. Inspect the report's source filename, physical line and JSON pointer to locate a problem. Invalid JSON, duplicate JSON members (including equivalent escaped names), invalid UTF-8, excessive nesting, oversized records, excess source positions and exhausted identity work budgets refuse the entire upload before private R2 and D1 custody or native effects. The refusal gives the source file, physical line, JSON path and reason. Every ZIP member is checked first, including directories and later extraction batches; no partial upload is retained. An export with no source records is refused after the complete bounded scan. Blank files, supported empty record lists and empty stored or deflated directories can accompany actual records, including records in later archive batches. Directories must first pass header, empty-body and checksum validation. Unsupported record kinds still count as source records and reach the reasoned plan. ZIP32 stored or deflated members and checked 32-bit data descriptors are supported. Opaque archive comments or extra fields, undeclared bytes, encrypted, multidisk or ZIP64 members and unsupported compression are refused; repackage the source files without that metadata. Correct the export and upload again. Valid JSON with unsupported kinds or mapping errors still reaches the reasoned plan; those decisions have no fabricated source ID or native effect. Input counts include repeated records and derived tags; per-kind counts describe distinct identified decisions plus invalid positions. The progress total counts only identified source decisions.
```
