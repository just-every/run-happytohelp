import {HTTPException} from 'hono/http-exception'
import {reservedLocalId} from '../conversations/admission'
import {emailAddress} from '../integrations/inbound-routing'
export interface OutboundTicketInput {kind:'email'|'call';localId:string;requesterId:string|null;requesterEmail:string|null;requesterName:string;subject:string;content:string;mailboxId:string|null;fromAddress:string|null;cc:string[];bcc:string[]}
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
 const subject=string(body.subject,'subject',500),content=string(body.content,'content',100000),cc=addresses(body.cc,'CC'),bcc=addresses(body.bcc,'BCC'),mailboxId=kind==='email'?string(body.mailboxId,'mailboxId',200):null
 if(/[\r\n]/.test(subject))throw new HTTPException(400,{message:'Subject must fit on one line'})
 if(cc.length+bcc.length>50||cc.some(address=>bcc.includes(address)))throw new HTTPException(400,{message:'Recipients must be unique across CC and BCC'})
 if(kind==='call'&&(cc.length||bcc.length||fromAddress))throw new HTTPException(400,{message:'Call logs cannot send email copies'})
 return {kind,localId,requesterId,requesterEmail,requesterName,subject,content,mailboxId,fromAddress,cc,bcc}
}

/** A proactive batch contains isolated requester tickets, never a shared CC list. */
export function outboundNoticeInputs(body:Record<string,unknown>):OutboundTicketInput[]{
 if(!Array.isArray(body.requesters)||body.requesters.length<2||body.requesters.length>50)throw new HTTPException(400,{message:'Choose 2–50 requester emails'})
 const requesters=addresses(body.requesters,'requester')
 if(requesters.length<2)throw new HTTPException(400,{message:'Choose at least two distinct requesters'})
 if(body.kind!=='email'||body.requesterId!==undefined||body.requesterEmail!==undefined||addresses(body.cc,'CC').length||addresses(body.bcc,'BCC').length)throw new HTTPException(400,{message:'Service notices use one email ticket per requester, without CC or BCC'})
 return requesters.map(requesterEmail=>outboundTicketInput({...body,requesterEmail}))
}
