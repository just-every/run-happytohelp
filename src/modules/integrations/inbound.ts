import {rerInbound} from './rer-inbound'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {receiveEmail} from './inbound-service'
import {ClosedTicketRefusal,noticeMember} from './closed-ticket-mail'
import {emailEvidence,gatewayHeaderEntries} from './email-classification'
import {sendgridInbound} from './sendgrid-inbound'
import {emailFileLinks} from './email-file-links'
export const inboundEmail=new Hono<AppEnv>()
inboundEmail.route('/',rerInbound)
inboundEmail.post('/email/inbound',async c=>{if(typeof c.env.INBOUND_EMAIL_TOKEN!=='string'||c.req.header('Authorization')!==`Bearer ${c.env.INBOUND_EMAIL_TOKEN}`)throw new HTTPException(403);const body=await c.req.json()
 // `from` is the sender the gateway authenticated; `replyTo` is a reply target only. `envelopeFrom` (the SMTP return path, empty for a
 // null sender), `subject` and `headers` (name to value) are optional classification evidence.
 const evidence=emailEvidence({envelopeFrom:typeof body?.envelopeFrom==='string'?body.envelopeFrom:body?.from,headerFrom:body?.from,subject:body?.subject,headers:gatewayHeaderEntries(body?.headers)})
 // A member's refused reply to a Closed ticket is answered with a notice to them as well as the 422.
 const result=await receiveEmail(c.env,{...body,evidence,senderAuthenticated:true}).catch(async error=>{if(error instanceof ClosedTicketRefusal)await noticeMember(c.env,error);throw error});return c.json(result,result.duplicate?200:201)})
inboundEmail.route('/',sendgridInbound)
inboundEmail.route('/',emailFileLinks)
