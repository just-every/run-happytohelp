import type {MappingProfile} from '../../legacy-import/adoption/profile'
import {stable} from '../../legacy-import/types'
import {getLineage,lineagePredicate} from './lineage-record'

/** Equal policy and custodian are necessary, but only verified origin lineage
 * can admit a journal made under a different immutable package fingerprint. */
export async function ownsEarlierJournal(db:D1Database,profile:MappingProfile,runId:string,delegated:boolean){
 const saved=await db.prepare('SELECT profile_json FROM legacy_import_mapping_profiles WHERE run_id=?').bind(runId).first<{profile_json:string}>()
 if(saved?.profile_json===stable(profile))return true
 if(!delegated||!saved)return false
 const current=await getLineage(db,profile.manifestSha256)
 if(!current)return false
 const proof=lineagePredicate(current)
 if(!await db.prepare(proof.sql).bind(...proof.params).first())return false
 let prior:MappingProfile;try{prior=JSON.parse(saved.profile_json)}catch{return false}
 if(prior.kind!=='historical-adoption'||prior.policyVersion!==2||prior.custodyProjectId!==profile.custodyProjectId||prior.sourceProjectId!==profile.sourceProjectId||prior.custodianId!==profile.custodianId)return false
 if(prior.manifestSha256===current.origin_sha256)return true
 const l=await getLineage(db,prior.manifestSha256)
 return !!l?.verified_at&&l.origin_sha256===current.origin_sha256&&l.custody_project_id===current.custody_project_id&&l.source_project_id===current.source_project_id&&l.custodian_id===current.custodian_id
}
