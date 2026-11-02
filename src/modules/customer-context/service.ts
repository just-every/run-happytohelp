import {contextSubjectAllowed} from './scope'
// @ts-ignore Retained attributed correction/retraction semantics.
import {mergeProfile} from './profiles/version.js'
import type { Env } from '../../platform/env'
import {cooldown,eligibleEvidence,fingerprint,publicSignals,validateProfile,type Evidence,type ProfileType} from './evidence'
export async function getContextPacket(env:Env,projectId:string,subjectId:string,userId?:string){
 const visible=await contextSubjectAllowed(env,projectId,subjectId,userId)
 const subject=visible?await env.DB.prepare('SELECT consent,revision FROM context_subjects WHERE project_id=? AND subject_id=?').bind(projectId,subjectId).first<{consent:number;revision:number}>():null;
 const result=visible?await env.DB.prepare('SELECT id,source,content,visibility,occurred_at FROM context_evidence WHERE project_id=? AND subject_id=? ORDER BY occurred_at DESC LIMIT 96').bind(projectId,subjectId).all<Evidence>():{results:[]};
 const evidence=eligibleEvidence(result.results.reverse());const profiles=visible?await env.DB.prepare('SELECT type,profile FROM context_profiles WHERE project_id=? AND subject_id=?').bind(projectId,subjectId).all<{type:string;profile:string}>():{results:[]};
 const profile=Object.fromEntries(profiles.results.map(p=>[p.type,JSON.parse(p.profile)]));return {version:'profile-evidence.v3',subjectId,revision:subject?.revision,evidence,evidence_fingerprint:await fingerprint(evidence),profiles:profile,consent:!!subject?.consent,approved_broad_personalization:publicSignals(profile.contact||{},!!subject?.consent)}
}
export async function saveProfile(env:Env,projectId:string,subjectId:string,type:ProfileType,candidate:unknown,expectedFingerprint:string){
 await env.DB.prepare('INSERT INTO context_subjects(project_id,subject_id) VALUES(?,?) ON CONFLICT DO NOTHING').bind(projectId,subjectId).run();
 const packet=await getContextPacket(env,projectId,subjectId);if(packet.evidence_fingerprint!==expectedFingerprint)throw new Error('Evidence changed');if(!validateProfile(type,candidate,packet.evidence))throw new Error('Unsupported profile evidence');
 await env.DB.prepare('INSERT INTO context_profiles(project_id,subject_id,type) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(projectId,subjectId,type).run();
 const prior=await env.DB.prepare('SELECT generated_count,started_at FROM context_profiles WHERE project_id=? AND subject_id=? AND type=?').bind(projectId,subjectId,type).first<{generated_count:number;started_at:number|null}>();
 const merged=mergeProfile(packet.profiles[type]||{},candidate,{evidence_fingerprint:expectedFingerprint});
 const now=Date.now();const threshold=now-cooldown(type,prior!.generated_count);
 const changed=await env.DB.prepare('UPDATE context_profiles SET profile=?,evidence_fingerprint=?,started_at=?,generated_count=generated_count+1 WHERE project_id=? AND subject_id=? AND type=? AND generated_count=? AND (started_at IS NULL OR started_at<=?) AND EXISTS(SELECT 1 FROM context_subjects WHERE project_id=? AND subject_id=? AND revision=?)').bind(JSON.stringify(merged.profile),expectedFingerprint,now,projectId,subjectId,type,prior!.generated_count,threshold,projectId,subjectId,packet.revision).run();if(!changed.meta.changes)throw new Error('Profile cooldown active');return {saved:true}
}
export async function saveInsight(env:Env,projectId:string,subjectId:string,input:any){
 const packet=await getContextPacket(env,projectId,subjectId);if(!packet.consent)throw new Error('Monitoring consent required');
 const ids=input.evidence_ids;if(!Array.isArray(ids)||ids.length<1||ids.length>4||!ids.every((id:string)=>packet.evidence.some(e=>e.id===id)))throw new Error('Invalid insight evidence');
 if(typeof input.content!=='string'||!input.content.trim()||input.content.length>360||typeof input.help_type!=='string'||!input.help_type)throw new Error('Invalid insight');
 if(!Array.isArray(input.buttons)||input.buttons.length>3||input.buttons.filter((b:any)=>b.action==='close').length!==1||input.buttons.some((b:any)=>!['send','close'].includes(b.action)||typeof b.text!=='string'||!b.text.trim()||b.text.length>90))throw new Error('Invalid insight buttons');
 const recent=await env.DB.prepare('SELECT evidence_ids,created_at FROM context_insights WHERE project_id=? AND subject_id=? ORDER BY created_at DESC LIMIT 20').bind(projectId,subjectId).all<{evidence_ids:string;created_at:number}>();
 if(recent.results[0]?.created_at>Date.now()-120000)throw new Error('Insight cooldown active');if(recent.results.some(r=>JSON.parse(r.evidence_ids).some((id:string)=>ids.includes(id))))throw new Error('Evidence already covered');
 const id=crypto.randomUUID();const saved=await env.DB.prepare(`INSERT INTO context_insights(id,project_id,subject_id,help_type,content,buttons,evidence_ids,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM context_subjects WHERE project_id=? AND subject_id=? AND consent=1) AND NOT EXISTS(SELECT 1 FROM context_insights i WHERE i.project_id=? AND i.subject_id=? AND (i.created_at>? OR EXISTS(SELECT 1 FROM json_each(i.evidence_ids) old JOIN json_each(?) new ON old.value=new.value)))`).bind(id,projectId,subjectId,input.help_type,input.content,JSON.stringify(input.buttons),JSON.stringify(ids),Date.now(),projectId,subjectId,projectId,subjectId,Date.now()-120000,JSON.stringify(ids)).run();if(!saved.meta.changes)throw new Error('Insight consent, cooldown or evidence changed');return {id}
}
