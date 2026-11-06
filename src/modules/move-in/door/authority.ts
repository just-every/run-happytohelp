import type {Env} from '../../../platform/env'
import type {D1Sql,D1Database as KitDatabase} from '../../import-kit/src/d1/types'
import {configureClaim} from '../../owner-claim/verify.mjs'
import {enableDoorAtFirstClaim,type ImportDoorClaimConfig} from '../../import-kit/src/door/index'

/** Trust comes only from the Business-authorized installation plan. Hosting mode
 * and a native claim alone confer no import authority. */
export function claimConfiguration(env:Env,origin?:string):ImportDoorClaimConfig|null {
 if(env.RER_IMPORT_DOOR!=='on'||env.RER_DEMO==='1')return null
 try{
  if(env.RER_INSTALLATION_ID&&env.RER_INSTALLATION_ID!==env.RER_OWNER_CLAIM_INSTALLATION_ID)return null
  if(env.RER_MANAGEMENT_ORIGIN&&env.RER_MANAGEMENT_ORIGIN!==env.RER_OWNER_CLAIM_ISSUER)return null
  const expectedEmail=String(env.H2H_SETUP_OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase()
  const config=configureClaim({issuer:String(env.RER_OWNER_CLAIM_ISSUER||''),installationId:String(env.RER_OWNER_CLAIM_INSTALLATION_ID||''),appOrigin:String(env.RER_OWNER_CLAIM_APP_ORIGIN||''),expectedEmail,publicKeys:JSON.parse(String(env.RER_OWNER_CLAIM_PUBLIC_KEYS))})
  if(origin&&config.appOrigin!==origin)return null
  if(env.APP_ORIGIN&&env.APP_ORIGIN!==config.appOrigin)return null
  return config
 }catch{return null}
}
export interface ClaimDestination {installation_id:string;owner_id:string;project_id:string}
const live=`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))`
const claimed=`o.singleton=1 AND o.claim_id=u.id AND u.email=? AND m.user_id=u.id AND m.role='owner' AND m.project_id=p.id AND p.created_at=u.created_at AND ${live}`
/** Initial setup writes both timestamps in the same guarded batch. Exactly one
 * such owner workspace may bind; extra memberships never select a destination. */
export async function bindClaim(env:Env,claim:ImportDoorClaimConfig){
 await env.DB.prepare(`INSERT INTO h2h_import_door_claim(installation_id,owner_id,project_id)
  SELECT ?,u.id,p.id FROM owner_setup o JOIN users u ON u.id=o.claim_id JOIN memberships m ON m.user_id=u.id JOIN projects p ON p.id=m.project_id WHERE ${claimed}
  AND (SELECT COUNT(*) FROM memberships candidate JOIN projects original ON original.id=candidate.project_id WHERE candidate.user_id=u.id AND candidate.role='owner' AND original.created_at=u.created_at)=1
  ON CONFLICT(installation_id) DO NOTHING`).bind(claim.installationId,claim.expectedEmail).run()
}
export function ownerPredicate(claim:ImportDoorClaimConfig,binding:ClaimDestination):D1Sql {
 return {sql:`EXISTS(SELECT 1 FROM h2h_import_door_claim b JOIN owner_setup o ON o.claim_id=b.owner_id JOIN users u ON u.id=b.owner_id JOIN memberships m ON m.user_id=u.id AND m.project_id=b.project_id JOIN projects p ON p.id=b.project_id
 WHERE b.installation_id=? AND b.owner_id=? AND b.project_id=? AND ${claimed})`,params:[claim.installationId,binding.owner_id,binding.project_id,claim.expectedEmail]}
}
export async function claimedDestination(env:Env,claim:ImportDoorClaimConfig){
 const row=await env.DB.prepare('SELECT * FROM h2h_import_door_claim WHERE installation_id=?').bind(claim.installationId).first<ClaimDestination>()
 if(!row)return null
 const predicate=ownerPredicate(claim,row)
 return (await env.DB.prepare(`SELECT (${predicate.sql}) allowed`).bind(...predicate.params!).first<{allowed:number}>())?.allowed===1?row:null
}
export async function healImportDoor(env:Env,principalId?:string){
 const claim=claimConfiguration(env);if(!claim)return
 // A non-owner sign-in cannot open or bind a door.
 const owner=await env.DB.prepare('SELECT u.id FROM owner_setup o JOIN users u ON u.id=o.claim_id WHERE o.singleton=1 AND u.email=?').bind(claim.expectedEmail).first<{id:string}>()
 if(!owner||principalId&&principalId!==owner.id)return
 await bindClaim(env,claim)
 const binding=await claimedDestination(env,claim);if(!binding)return
 await enableDoorAtFirstClaim(env.DB,claim.installationId,ownerPredicate(claim,binding))
}
/** Base checks its grant predicate inside every batch; this adds HH's current
 * native owner/workspace authority to that same atomic transaction. */
export function authorizedDatabase(db:D1Database,predicate:D1Sql,additional:()=>D1Sql[]=()=>[]):KitDatabase {
 const statements=new WeakMap<object,{sql:string;raw:D1PreparedStatement}>();let admitted=false
 const track=(raw:D1PreparedStatement,sql:string):ReturnType<KitDatabase['prepare']>=>{
  const statement={bind:(...params:any[])=>track(raw.bind(...params),sql),first:<T>()=>raw.first<T>(),all:<T>()=>raw.all<T>()}
  statements.set(statement,{sql,raw});return statement
 }
 const guards=()=>[predicate,...(admitted?additional():[])].map(p=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${p.sql}) THEN 1 ELSE 0 END`).bind(...p.params??[]))
 return {prepare:sql=>track(db.prepare(sql),sql),async batch(input){
  const raw=input.map(statement=>{const found=statements.get(statement);if(!found)throw new Error('import_statement_untracked');return found})
  const before=guards(),after=guards(),results=await db.batch([...before,...raw.map(row=>row.raw),...after,db.prepare('DELETE FROM ik_d1_assertions')])
  if(raw.some(row=>/^INSERT INTO ik_door_grants\b/.test(row.sql)))admitted=true
  return results.slice(before.length,-after.length-1)
 }}
}
