import {HTTPException} from 'hono/http-exception'
import {reservedLocalId} from '../conversations/admission'
import {emailAddress} from '../integrations/inbound-routing'
export const noticeCommand=Symbol('noticeCommand')
export interface OutboundTicketInput {[noticeCommand]?:string;kind:'email'|'call'|'sms'|'whatsapp';firstComment?:'internal';requesterPhone?:string;connectionId?:string;templateId?:string;parameters?:string[];localId:string;requesterId:string|null;requesterEmail:string|null;requesterName:string;subject:string;content:string;mailboxId:string|null;fromAddress:string|null;cc:string[];bcc:string[];formId?:string;fields?:Record<string,unknown>;groupId?:string|null;assigneeId?:string|null}
function string(value:unknown,label:string,max:number,required=true){
 if(typeof value!=='string'||value.length>max||required&&!value.trim()||/[\0]/.test(value))throw new HTTPException(400,{message:`Invalid ${label}`})
 return value.trim()
}
function addresses(value:unknown,label:string){
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>50)throw new HTTPException(400,{message:`Invalid ${label}`})
 const result=value.map(raw=>{const address=emailAddress(raw);if(typeof raw!=='string'||!address||raw.trim().toLowerCase()!==address)throw new HTTPException(400,{message:`Invalid ${label} address`});return address})
 return [...new Set(result)].sort()
}
export function outboundTicketInput(body:Record<string,unknown>):OutboundTicketInput{
 if(!body||!['email','call','sms','whatsapp'].includes(String(body.kind)))throw new HTTPException(400,{message:'Choose email, call, SMS or WhatsApp'})
 const kind=body.kind as OutboundTicketInput['kind'],localId=string(body.localId,'localId',200),requesterId=body.requesterId===undefined?null:string(body.requesterId,'requesterId',200),requesterEmail=body.requesterEmail===undefined?null:emailAddress(body.requesterEmail),requesterName=body.requesterName===undefined?'':string(body.requesterName,'requesterName',200,false)
 if(reservedLocalId(localId))throw new HTTPException(400,{message:'Reserved local id prefix'})
 if(body.requesterEmail!==undefined&&(!requesterEmail||String(body.requesterEmail).trim().toLowerCase()!==requesterEmail))throw new HTTPException(400,{message:'Invalid requester email'})
 if(!['sms','whatsapp'].includes(kind)&&!requesterId&&!requesterEmail)throw new HTTPException(400,{message:'Provide a requester or requester email'})
 const fromAddress=body.fromAddress===undefined?null:emailAddress(body.fromAddress)
 if(body.fromAddress!==undefined&&(!fromAddress||String(body.fromAddress).trim().toLowerCase()!==fromAddress))throw new HTTPException(400,{message:'Invalid sender address'})
 const internalEmail=kind==='email'&&body.firstComment==='internal'
 const subject=string(body.subject,'subject',500),content=string(body.content,'content',100000),cc=addresses(body.cc,'CC'),bcc=addresses(body.bcc,'BCC'),mailboxId=kind==='email'&&!(internalEmail&&(body.mailboxId==null||body.mailboxId===''))?string(body.mailboxId,'mailboxId',200):null
 if(kind==='email'&&fromAddress&&!mailboxId)throw new HTTPException(400,{message:'A sender address requires a mailbox'})
 if(/[\r\n]/.test(subject))throw new HTTPException(400,{message:'Subject must fit on one line'})
 if(cc.length+bcc.length>50||cc.some(address=>bcc.includes(address)))throw new HTTPException(400,{message:'Recipients must be unique across CC and BCC'})
 if(kind==='call'&&(cc.length||bcc.length||fromAddress))throw new HTTPException(400,{message:'Call logs cannot send email copies'})
 if(body.firstComment!==undefined&&(kind!=='email'||body.firstComment!=='public'&&body.firstComment!=='internal'))throw new HTTPException(400,{message:'Choose a public reply or internal note for an email ticket'})
 if(body.firstComment==='internal'&&(cc.length||bcc.length))throw new HTTPException(400,{message:'Internal notes cannot send email copies'})
 const configuration:Pick<OutboundTicketInput,'formId'|'fields'|'groupId'|'assigneeId'>={}
 if(body.formId!==undefined)configuration.formId=string(body.formId,'formId',200)
 if(body.fields!==undefined){if(!body.fields||typeof body.fields!=='object'||Array.isArray(body.fields)||Object.keys(body.fields).length>50)throw new HTTPException(400,{message:'Invalid field values'});configuration.fields=Object.fromEntries(Object.entries(body.fields as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)))}
 for(const key of ['groupId','assigneeId'] as const)if(body[key]!==undefined)configuration[key]=body[key]===null?null:string(body[key],key,200)
 const channel:Pick<OutboundTicketInput,'requesterPhone'|'connectionId'|'templateId'|'parameters'>={}
 if(kind==='sms'||kind==='whatsapp'){
  channel.requesterPhone=string(body.requesterPhone,'requester phone',20)
  if(!/^\+[1-9]\d{7,14}$/.test(channel.requesterPhone))throw new HTTPException(400,{message:'Use an international phone number, starting with +'})
  channel.connectionId=string(body.connectionId,'channel connection',200)
  if(requesterId||requesterEmail||cc.length||bcc.length||fromAddress)throw new HTTPException(400,{message:'Channel requesters come only from recorded phone consent; email copies are unavailable'})
  if(kind==='whatsapp'){
   channel.templateId=string(body.templateId,'approved template',200)
   if(!Array.isArray(body.parameters)||body.parameters.length>10||body.parameters.some(v=>typeof v!=='string'||!v.trim()||v.length>500))throw new HTTPException(400,{message:'Provide each template parameter once, in order'})
   channel.parameters=body.parameters as string[]
  }
 }
 // Public (including an explicit choice) keeps historical normalized command bytes.
 // Only the new internal intent adds a key to the immutable reservation identity.
 return {...channel,kind,localId,requesterId,requesterEmail,requesterName,subject,content,mailboxId,fromAddress,cc,bcc,...configuration,...(body.firstComment==='internal'?{firstComment:'internal' as const}:{})}
}

/** A proactive batch contains isolated requester tickets, never a shared CC list. */
export function outboundNoticeInputs(body:Record<string,unknown>):OutboundTicketInput[]{
 if(body.firstComment!==undefined)throw new HTTPException(400,{message:'First-comment choice is available for single email tickets only'})
 if(['formId','fields','groupId','assigneeId','brandId'].some(key=>body[key]!==undefined))throw new HTTPException(400,{message:'Configuration is available for single tickets only'})
 if(!Array.isArray(body.requesters)||body.requesters.length<2||body.requesters.length>50)throw new HTTPException(400,{message:'Choose 2–50 requester emails'})
 const requesters=addresses(body.requesters,'requester')
 if(requesters.length<2)throw new HTTPException(400,{message:'Choose at least two distinct requesters'})
 if(body.kind!=='email'||body.requesterId!==undefined||body.requesterEmail!==undefined||addresses(body.cc,'CC').length||addresses(body.bcc,'BCC').length)throw new HTTPException(400,{message:'Service notices use one email ticket per requester, without CC or BCC'})
 return requesters.map(requesterEmail=>outboundTicketInput({...body,requesterEmail}))
}
