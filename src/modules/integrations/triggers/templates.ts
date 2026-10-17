import {renderPlaceholders} from '../../macros/placeholders'
import {HTTPException} from 'hono/http-exception'
export type CustomerEvent='request_received'|'ticket_solved'
export const defaultTriggers=[
 {event:'request_received' as const,channel:'*',brand_id:'*',enabled:1,subject:'Request #{{ticket.id}} received',body:'Hi {{requester.name | there}},\n\nWe received your request #{{ticket.id}}. We expect to reply {{expected_reply_time}}.\n\n{{brand.name}}',expected_reply_time:'within one business day'},
 {event:'ticket_solved' as const,channel:'*',brand_id:'*',enabled:1,subject:'Request #{{ticket.id}} solved',body:'Hi {{requester.name | there}},\n\nYour request #{{ticket.id}} has been solved. Reply if you need more help.\n\n{{brand.name}}',expected_reply_time:'within one business day'},
]
/** The macro renderer and its fallback syntax are shared across both surfaces. */
export function renderNotificationTemplate(template:string,values:Record<string,unknown>){
 const {text,unresolved}=renderPlaceholders(template,values)
 if(unresolved.length||text.includes('{{')||text.includes('}}'))throw new HTTPException(400,{message:`Missing notification template values: ${unresolved.join(', ')||'invalid placeholder'}`})
 return text
}
