import type {NativeValue} from './readers/normalise'

/** Source lifecycle categories are explicit. Help Scout and Intercom use Closed
 * for a reopenable resolution, so they map to Solved. Zendesk/Freshdesk also
 * distinguish a final Closed state, which must retain native follow-up behavior. */
export function completeImportedTicket(value:NativeValue){
 const source=value.tables.move_in_conversations?.[0]
 for(const row of value.tables.conversations??[]){
  row.subject??=source?.subject??''
  if(!source)throw Error('imported_ticket_source_required')
  const states:Record<string,Record<string,string>>={
   zendesk:{new:'new',open:'open',pending:'pending',hold:'on_hold',solved:'solved',closed:'closed'},
   freshdesk:{open:'open',pending:'pending',resolved:'solved',closed:'closed',spam:'solved'},
   helpscout:{active:'open',pending:'pending',closed:'solved',spam:'solved'},
   intercom:{open:'open',snoozed:'on_hold',closed:'solved'},
  }
  const category=source.vendor==='freshdesk'&&source.source_state==='spam'?(row.resolved_at===null?'open':'solved'):states[source.vendor]?.[source.source_state]
  if(!category)throw Error('imported_ticket_state_unsupported')
  row.status_id??=category;row.status_category??=category
  const channels:Record<string,string>={email:'email',outbound_email:'email',web:'widget',chat:'widget',messenger:'widget',beaconchat:'widget',phone:'phone',voice:'phone',portal:'portal',feedback_widget:'widget',unknown:'unknown'}
  row.channel??=channels[source.source_channel]??'unknown'
 }
 return value
}
