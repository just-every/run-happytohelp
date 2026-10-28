import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {auditStatement,requestSource} from '../../audit/record'
import {campaignSchema} from './model'
export const campaignRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/widget-campaigns'
campaignRoutes.get(path,async c=>{const actor=await scope(c);return c.json({campaigns:(await c.env.DB.prepare('SELECT id,revision,config_json FROM widget_campaigns WHERE project_id=? ORDER BY updated_at,id').bind(actor.projectId).all<{id:string;revision:number;config_json:string}>()).results.map(({config_json,...row})=>({...row,...JSON.parse(config_json)}))})})
campaignRoutes.put(path+'/:campaignId',async c=>{
 const actor=await scope(c,true),id=c.req.param('campaignId')||''
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new HTTPException(400)
 const body=await c.req.json(),{revision,...input}=body||{},parsed=campaignSchema.safeParse(input)
 if(!parsed.success||!Number.isSafeInteger(revision)||revision<0)throw new HTTPException(400,{message:parsed.success?'Invalid revision':parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')})
 const now=Date.now(),config=parsed.data
 const guard={sql:'changes()>0',params:[]}
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO widget_campaigns(project_id,id,revision,config_json,updated_at) SELECT ?,?,1,?,? WHERE (?=0 AND (SELECT count(*) FROM widget_campaigns WHERE project_id=?)<50) OR EXISTS(SELECT 1 FROM widget_campaigns WHERE project_id=? AND id=? AND revision=?) ON CONFLICT(project_id,id) DO UPDATE SET revision=widget_campaigns.revision+1,config_json=excluded.config_json,updated_at=excluded.updated_at WHERE widget_campaigns.revision=?`).bind(actor.projectId,id,JSON.stringify(config),now,revision,actor.projectId,actor.projectId,id,revision,revision),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'widget.campaign.saved',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'widget_campaign',id},detail:{revision:revision+1,enabled:config.enabled}},now,guard),
 ])
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Campaign changed or campaign limit reached. Reload before saving.'})
 return c.json({id,revision:revision+1,...config})
})
