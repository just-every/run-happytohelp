import type {D1Database} from '../../import-kit/src/d1/types'
import type {TargetEffect,TargetRow} from '../../import-kit/src/types'
import {nativeSetGuards} from '../../import-kit/src/d1/native-set'
import {packGuards} from '../../import-kit/src/d1/budget'
import {batchBytes} from '../../import-kit/src/d1/transport'
import {DoorError} from '../../import-kit/src/door/protocol'
import {legacyTargets} from './targets'

/** Include gone-but-retained native rows. A succession of complete snapshots
 * cannot use shrinking source counts to evade the unchanged native grant. */
export async function preflightNativeBounds(db:D1Database,destination:string,effects:TargetEffect[],maxRecords:number){
 const current=await legacyTargets.list(db,destination),rows=new Map(current.map(row=>[row.targetId,row]))
 for(const effect of effects)rows.set(effect.targetId,{...effect,destination,revision:'0'.repeat(64)} as TargetRow)
 if(rows.size>maxRecords)throw new DoorError('legacy_native_expansion_exceeds_grant',413)
 try{const statements=nativeSetGuards(legacyTargets,[...rows.values()],destination).map(entry=>entry.guard);if(batchBytes(packGuards(statements,true))>2*1024*1024)throw new Error('legacy_native_set_limit')}
 catch{throw new DoorError('legacy_native_snapshot_exceeds_limit',413,{reason:'The complete native snapshot exceeds the unchanged exact D1 read limits.'})}
}
