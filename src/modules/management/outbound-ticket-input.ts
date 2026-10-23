import {HTTPException} from 'hono/http-exception'
import {object} from '../tickets/model'
import {reservedLocalId} from '../conversations/admission'
import {emailAddress} from '../integrations/inbound-routing'
export interface OutboundTicketInput {kind:'email'|'call';localId:string;requesterId:string|null;requesterEmail:string|null;requesterName:string;subject:string;content:string;mailboxId:string|null;fromAddress:string|null;cc:string[];bcc:string[];configuration?:{brandId?:string;formId?:string|null;fields?:Record<string,unknown>;assigneeId?:string|null;groupId?:string|null;channel?:'walk_in';internal?:boolean}}
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
 if(!body||!['email','call'].includes(String(body.kind)))throw new HTTPException(400,{message:'Ticket kind must be email or call'})
 const kind=body.kind as 'email'|'call',localId=string(body.localId,'localId',200),requesterId=body.requesterId===undefined?null:string(body.requesterId,'requesterId',200),requesterEmail=body.requesterEmail===undefined?null:emailAddress(body.requesterEmail),requesterName=body.requesterName===undefined?'':string(body.requesterName,'requesterName',200,false)
 if(reservedLocalId(localId))throw new HTTPException(400,{message:'Reserved local id prefix'})
 if(body.requesterEmail!==undefined&&(!requesterEmail||String(body.requesterEmail).trim().toLowerCase()!==requesterEmail))throw new HTTPException(400,{message:'Invalid requester email'})
 if(!requesterId&&!requesterEmail)throw new HTTPException(400,{message:'Provide a requester or requester email'})
 const fromAddress=body.fromAddress===undefined?null:emailAddress(body.fromAddress)
 if(body.fromAddress!==undefined&&(!fromAddress||String(body.fromAddress).trim().toLowerCase()!==fromAddress))throw new HTTPException(400,{message:'Invalid sender address'})
 const subject=string(body.subject,'subject',500),content=string(body.content,'content',100000),cc=addresses(body.cc,'CC'),bcc=addresses(body.bcc,'BCC'),mailboxId=kind==='email'&&object(body.configuration??{}).internal!==true?string(body.mailboxId,'mailboxId',200):null
 if(/[\r\n]/.test(subject))throw new HTTPException(400,{message:'Subject must fit on one line'})
 if(cc.length+bcc.length>50||cc.some(address=>bcc.includes(address)))throw new HTTPException(400,{message:'Recipients must be unique across CC and BCC'})
 if(kind==='call'&&(cc.length||bcc.length||fromAddress))throw new HTTPException(400,{message:'Call logs cannot send email copies'})
 let configuration:OutboundTicketInput['configuration']
 if(body.configuration!==undefined){
  const c=object(body.configuration)
  if(Object.keys(c).some(key=>!['brandId','formId','fields','assigneeId','groupId','channel','internal'].includes(key)))throw new HTTPException(400,{message:'Unknown ticket configuration'})
  configuration={}
  if(c.brandId!==undefined)configuration.brandId=string(c.brandId,'brandId',200)
  for(const key of ['formId','assigneeId','groupId'] as const)if(c[key]!==undefined)configuration[key]=c[key]===null?null:string(c[key],key,200)
  if(c.fields!==undefined)configuration.fields=Object.fromEntries(Object.entries(object(c.fields)).sort(([a],[b])=>a.localeCompare(b)))
  if(c.channel!==undefined){if(c.channel!=='walk_in'||kind!=='call')throw new HTTPException(400,{message:'Walk-in tickets must contain private notes'});configuration.channel=c.channel}
  if(c.internal!==undefined){if(typeof c.internal!=='boolean')throw new HTTPException(400,{message:'Internal must be boolean'});configuration.internal=c.internal}
  if(configuration.internal&&(cc.length||bcc.length))throw new HTTPException(400,{message:'Internal tickets cannot send email copies'})
 }
 return {kind,localId,requesterId,requesterEmail,requesterName,subject,content,mailboxId,fromAddress,cc,bcc,...(configuration?{configuration}:{})}
}
