import type {Env} from '../../platform/env'
import type {StoredField} from './types'
import {ownerHeads,loadReferencedPlans} from '../import-kit/src/d1/referenced-plans'
import {sha256,canonicalJson} from '../import-kit/src/provenance/identity'

// Both import doors retain these same applied plan entries. Capture their custody
// revisions with the origin, so form writes can fence the visibility read atomically.
export const fieldSourceState=`COALESCE((SELECT json_array(origin.vendor,origin.source_id,origin.source_json,origin.revision,
 (SELECT json_group_array(json_object('id',p.id,'job_id',p.job_id,'ordinal',p.ordinal,'effect_ordinal',p.effect_ordinal,'record_json',p.record_json,'custody',c.revision))
 FROM (SELECT * FROM ik_provenance WHERE destination=f.project_id AND target_kind='field' AND target_id=f.id AND reversed=0 ORDER BY id) p
 LEFT JOIN ik_d1_custody_states c ON c.job_id=p.job_id))
 FROM move_in_origins origin WHERE origin.project_id=f.project_id AND origin.target_kind='field' AND origin.target_id=f.id),'null')`
const states=new WeakMap<StoredField,string>()
export const fieldSourceSnapshot=(field:StoredField)=>states.get(field)

export async function fieldVisibility(env:Pick<Env,'DB'>,projectId:string){
 const rows=(await env.DB.prepare(`SELECT f.*,${fieldSourceState} AS source_state FROM ticket_fields f WHERE f.project_id=? ORDER BY f.name,f.id`).bind(projectId).all<StoredField&{source_state:string}>()).results
 const proofs=rows.flatMap(row=>{const origin=JSON.parse(row.source_state);return origin?.[0]==='zendesk'&&origin[3]!=='erased-visibility'?origin[4]:[]})
 const plans=await loadReferencedPlans(await ownerHeads(env.DB,[...new Set<string>(proofs.map(p=>p.job_id))]),proofs,env.DB)
 return rows.map(({source_state,...field})=>{
  const origin=JSON.parse(source_state)
  let visible=!origin||origin[0]!=='zendesk'
  if(origin?.[0]==='zendesk'){
   if(origin[3]==='erased-visibility')visible=JSON.parse(origin[2]).visible_in_portal===true
   else visible=origin[4].some((raw:any)=>{
    const plan=plans.get(raw.job_id),entry=plan?.entries[raw.ordinal],source=entry?.source,provenance=JSON.parse(raw.record_json),effect=entry?.effects[raw.effect_ordinal]
    return raw.custody!=null&&plan?.destination===projectId&&source?.kind==='ticket_field'
     &&(effect?.value as any)?.source?.vendor==='zendesk'&&(effect?.value as any)?.source?.id===origin[1]
     &&source.sourceId===origin[1]&&source.sourceId===provenance.sourceId&&source.payloadHash===provenance.sourceHash
     &&sha256(canonicalJson(source.payload))===source.payloadHash&&effect?.targetKind==='field'&&effect.targetId===field.id
     &&sha256(canonicalJson(effect.value))===provenance.valueHash&&(source.payload as any).visible_in_portal===true
   })
  }
  field.form_eligible=visible?1:0;states.set(field,source_state);return field
 })
}
