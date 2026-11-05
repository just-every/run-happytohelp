import type {D1Database} from '../../import-kit/src/d1/types'
import type {DoorPlanRow,DoorRequest,ImportDoorClaimConfig} from '../../import-kit/src/door/types'
import {verifyImportGrant} from '../../import-kit/src/door/grants'
import {loadSnapshot} from '../../import-kit/src/door/store'
import {DoorError} from '../../import-kit/src/door/protocol'
import {LEGACY_LIMITS,LEGACY_NAMESPACE} from './limits'

/** A later action has its own grant. Reusing an approved plan cannot promote
 * its earlier, larger source/native allowance into this request's authority.
 * Called inside Base's verified source resolver, before nonce/native writes. */
export async function legacyPlanQuota(db:D1Database,claim:ImportDoorClaimConfig,binding:{project_id:string;owner_id:string},request:Request,row:DoorPlanRow){
 const {grant,kid}=await verifyImportGrant(request.headers.get('Authorization')!.slice(7),claim),limit=Math.min(grant.maxRecords,LEGACY_LIMITS.records)
 if(!await db.prepare('SELECT 1 FROM ik_door_settings WHERE installation_id=? AND enabled=1 AND NOT EXISTS(SELECT 1 FROM ik_door_revoked_keys WHERE installation_id=? AND kid=?)').bind(row.installation_id,row.installation_id,kid).first())throw new DoorError('grant_replayed_revoked_or_expired',403)
 const snapshot=await loadSnapshot({options:{database:db,destination:binding.project_id,ownerPrincipalId:binding.owner_id},access:{installationId:row.installation_id,namespace:LEGACY_NAMESPACE}} as DoorRequest,row)
 if(snapshot.sourceCount>limit)throw new DoorError('plan_exceeds_grant_quota',413)
 const native=new Set(snapshot.records.flatMap(record=>record.targets.map(target=>target.kind+':'+target.id)))
 if(native.size>limit)throw new DoorError('legacy_native_expansion_exceeds_grant',413)
 return snapshot
}
