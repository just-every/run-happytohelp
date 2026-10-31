import type {Env} from '../../platform/env'
import {D1SqlDatabase,IntegrationsRepository,pickEnvelope} from '../../vendor/base/modules/integrations/index.ts'
import {DestinationUnavailable} from './destinations'

// Base's immutable four-attempt policy and attempt numbering stay intact. An
// exhausted delivery gets exactly one extra claim per explicit audited approval.
// Base classifies a subsequent 429 as terminal because its budget is exhausted.
const approved=`EXISTS(SELECT 1 FROM native_integration_audit a WHERE a.project_id=integration_deliveries.namespace AND a.resource_id=integration_deliveries.id AND a.action='delivery.resend.'||(integration_deliveries.attempts+1))`
export class NativeDeliveryRepository extends IntegrationsRepository {
 private destinations=new Map<string,string>()
 constructor(env:Env,projectId:string){super(new D1SqlDatabase(env.DB),projectId)}
 observeDestination(id:string,ciphertext:string){
  const previous=this.destinations.get(id)
  if(previous!==undefined&&previous!==ciphertext)throw new DestinationUnavailable('Destination changed')
  this.destinations.set(id,ciphertext)
 }
 async get(id:string){
  const delivery=await super.get(id),ciphertext=delivery&&this.destinations.get(delivery.destinationId)
  if(!delivery||delivery.state!=='sending'||ciphertext===undefined)return delivery
  // Base rechecks get() after asynchronous protocol preparation. Bind that last
  // admission to the native authority and the exact configuration used to prepare
  // the wire, as well as the still-live Base claim. A refusal is provably unsent.
  const admitted=await this.query(`SELECT 1 FROM integration_deliveries v
   JOIN native_integration_intents i ON i.id=v.id AND i.project_id=v.namespace
   JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id
   JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id
   JOIN projects p ON p.id=i.project_id
   WHERE v.namespace=? AND v.id=? AND v.state='sending' AND v.claim=? AND v.claim_until>? AND v.envelope=?
   AND (d.credential_id IS NULL OR EXISTS(SELECT 1 FROM api_credentials cr WHERE cr.namespace=d.project_id AND cr.id=d.credential_id AND cr.revoked_at IS NULL AND (cr.expires_at IS NULL OR cr.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND (d.connector<>'zapier' OR EXISTS(SELECT 1 FROM json_each(cr.scopes) WHERE value=CASE WHEN e.event LIKE 'contact.%' THEN 'contacts:read' WHEN e.event LIKE 'article.%' THEN 'articles:read' ELSE 'conversations:read' END))))
   AND d.id=? AND d.enabled=1 AND d.secret_ciphertext=? AND e.event=? AND e.erased_at IS NULL AND i.error_code IS NULL
   AND ((d.kind='webhook' AND ?='webhook') OR (d.kind='slack' AND ?='slack.'||d.mode||'.v1'))
   AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)
   AND (e.contact_id IS NULL OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=e.contact_id AND ct.project_id=e.project_id AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1))`,
   [id,delivery.claim,Date.now(),JSON.stringify(pickEnvelope(delivery)),delivery.destinationId,ciphertext,delivery.event,delivery.protocol,delivery.protocol])
  if(admitted.length&&delivery.tenant===this.namespace&&delivery.id===id)return delivery
  await this.finish(id,delivery.claim!,{kind:'rejected',code:'preflight_failed'},Date.now(),null)
  return super.get(id)
 }
 async due(now:number,limit=100){
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid delivery batch limit')
  return (await this.query(`SELECT id FROM integration_deliveries WHERE namespace=? AND state='queued' AND next_at<=? AND (attempts<max_attempts OR ${approved}) ORDER BY next_at,id LIMIT ?`,[now,limit])).map(row=>String(row.id))
 }
 async claim(id:string,now:number,leaseMs:number){
  const ordinary=await super.claim(id,now,leaseMs)
  if(ordinary)return ordinary
  const claim=crypto.randomUUID()
  const result=await this.sql.batch([
   {sql:`UPDATE integration_deliveries SET state='sending',attempts=attempts+1,claim=?,claim_until=? WHERE namespace=? AND id=? AND state='queued' AND next_at<=? AND attempts>=max_attempts AND ${approved} RETURNING id`,params:[claim,now+leaseMs,this.namespace,id,now]},
   {sql:'INSERT INTO integration_attempts(namespace,id,delivery_id,number,started_at) SELECT namespace,claim,id,attempts,? FROM integration_deliveries WHERE namespace=? AND id=? AND claim=?',params:[now,this.namespace,id,claim]}
  ])
  return result[0]!.length?claim:null
 }
}
