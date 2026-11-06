import {contextSubjectAllowed,requireContextSubjectScope} from './scope'
import {enqueueContextJob} from './jobs'
import { Hono,type Context } from 'hono'
import type { AppEnv } from '../../platform/env'
import { requireProject } from '../../platform/auth'
import { requiredString,id } from '../../platform/db'
import { getContextPacket,saveInsight,saveProfile } from './service'
import { PROFILE_KEYS,type ProfileType } from './evidence'
import { insightInventory } from './insight-inventory'
export const routes=new Hono<AppEnv>()
routes.use('/:projectId/*',async(c,next)=>{await requireProject(c,c.req.param('projectId'),true);await next()})
routes.route('/',insightInventory)
const subjectAllowed=(c:Context<AppEnv>)=>contextSubjectAllowed(c.env,c.req.param('projectId')!,c.req.param('subjectId')!,c.get('actor').id)
const requireSubject=(c:Context<AppEnv>)=>requireContextSubjectScope(c.env,c.req.param('projectId')!,c.req.param('subjectId')!,c.get('actor').id)
routes.get('/:projectId/:subjectId',async c=>c.json(await getContextPacket(c.env,c.req.param('projectId')!,c.req.param('subjectId')!,c.get('actor').id)))
routes.put('/:projectId/:subjectId/consent',async c=>{await requireSubject(c);const b=await c.req.json();if(typeof b.consent!=='boolean')return c.json({error:'Boolean consent required'},400);await c.env.DB.prepare('INSERT INTO context_subjects(project_id,subject_id,consent) VALUES(?,?,?) ON CONFLICT(project_id,subject_id) DO UPDATE SET consent=excluded.consent').bind(c.req.param('projectId'),c.req.param('subjectId'),b.consent?1:0).run();return c.json({consent:b.consent})})
routes.post('/:projectId/:subjectId/evidence',async c=>{await requireSubject(c);const b=await c.req.json();const source=requiredString(b.source,'source',100);if(!['customer_message','agent_message','customer_activity','customer_activity_summary','approved_knowledge_document','configured_company_identity','configured_company_tone'].includes(source))return c.json({error:'Invalid evidence source'},400);const evidenceId=id();await c.env.DB.prepare('INSERT INTO context_evidence(id,project_id,subject_id,source,content,visibility,occurred_at) VALUES(?,?,?,?,?,?,?)').bind(evidenceId,c.req.param('projectId'),c.req.param('subjectId'),source,requiredString(b.content,'content',10000),'private_operational_evidence',Date.now()).run();return c.json({id:evidenceId},201)})
routes.put('/:projectId/:subjectId/profiles/:type',async c=>{await requireSubject(c);const type=c.req.param('type');if(!Object.hasOwn(PROFILE_KEYS,type))return c.json({error:'Invalid profile type'},400);const b=await c.req.json();try{return c.json(await saveProfile(c.env,c.req.param('projectId'),c.req.param('subjectId'),type as ProfileType,b.profile,b.evidenceFingerprint))}catch(e){return c.json({error:String(e)},409)}})
routes.get('/:projectId/:subjectId/insights',async c=>{if(!await subjectAllowed(c))return c.json([]);return c.json((await c.env.DB.prepare('SELECT * FROM context_insights WHERE project_id=? AND subject_id=? ORDER BY created_at DESC LIMIT 20').bind(c.req.param('projectId'),c.req.param('subjectId')).all()).results)})
routes.post('/:projectId/:subjectId/insights',async c=>{await requireSubject(c);try{return c.json(await saveInsight(c.env,c.req.param('projectId'),c.req.param('subjectId'),await c.req.json()),201)}catch(e){return c.json({error:String(e)},409)}})
routes.post('/:projectId/:subjectId/insights/:insightId/dismiss',async c=>{await requireSubject(c);await c.env.DB.prepare('UPDATE context_insights SET dismissed_at=? WHERE id=? AND project_id=? AND subject_id=?').bind(Date.now(),c.req.param('insightId'),c.req.param('projectId'),c.req.param('subjectId')).run();return c.json({dismissed:true})})
routes.put('/:projectId/:subjectId/monitoring',async c=>{await requireSubject(c);
 const b=await c.req.json();if(typeof b.enabled!=='boolean'||!Array.isArray(b.helpTypes)||b.helpTypes.length>8||b.helpTypes.some((t:unknown)=>typeof t!=='string'||!t||t.length>60))return c.json({error:'Invalid monitoring configuration'},400)
 await c.env.DB.prepare('INSERT INTO context_subjects(project_id,subject_id,bot_enabled,help_types) VALUES(?,?,?,?) ON CONFLICT(project_id,subject_id) DO UPDATE SET bot_enabled=excluded.bot_enabled,help_types=excluded.help_types').bind(c.req.param('projectId'),c.req.param('subjectId'),b.enabled?1:0,JSON.stringify([...new Set(b.helpTypes)])).run();return c.json({saved:true})
})
routes.post('/:projectId/:subjectId/generate/:kind',async c=>{if(!await subjectAllowed(c))return c.json({error:'Error: Context subject missing'},409);const b=await c.req.json();try{return c.json(await enqueueContextJob(c.env,c.req.param('projectId'),c.req.param('subjectId'),c.req.param('kind'),b.model),202)}catch(e){return c.json({error:String(e)},409)}})
routes.get('/:projectId/:subjectId/jobs',async c=>{if(!await subjectAllowed(c))return c.json([]);return c.json((await c.env.DB.prepare('SELECT id,kind,state,created_at,finished_at,result_json,error FROM context_jobs WHERE project_id=? AND subject_id=? ORDER BY created_at DESC LIMIT 50').bind(c.req.param('projectId'),c.req.param('subjectId')).all()).results)})
routes.post('/:projectId/:subjectId/jobs/:jobId/abandon',async c=>{await requireSubject(c);
 const b=await c.req.json();const reason=requiredString(b.reason,'review reason',1000)
 const result=await c.env.DB.batch([
  c.env.DB.prepare("UPDATE context_jobs SET state='failed',error=?,finished_at=? WHERE id=? AND project_id=? AND subject_id=? AND state='uncertain'").bind(`Operator review abandoned uncertain attempt: ${reason}`,Date.now(),c.req.param('jobId'),c.req.param('projectId'),c.req.param('subjectId')),
  c.env.DB.prepare("UPDATE context_collectors SET job_id=NULL,last_run_at=? WHERE project_id=? AND subject_id=? AND job_id=? AND EXISTS(SELECT 1 FROM context_jobs WHERE id=? AND state='failed')").bind(Date.now(),c.req.param('projectId'),c.req.param('subjectId'),c.req.param('jobId'),c.req.param('jobId')),
 ])
 return c.json({abandoned:!!result[0].meta.changes})
})
