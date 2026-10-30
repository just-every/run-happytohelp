import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from './common'
import {requireReportPermission} from '../reports/permission'
import {readReport} from '../reports/read'
import {reportRange,validTimezone} from '../reports/calendar'

export const brandReports=new Hono<AppEnv>()
/** Each workspace remains a separate brand/security boundary. A shared team member
 * explicitly selects brands; the result never contains customer records or text. */
brandReports.get('/projects/:projectId/brands/reports',async c=>{
 const actor=await scope(c),query=c.req.query()
 const ids=[...new Set((query.projects||'').split(',').filter(Boolean))]
 if(ids.length<2||ids.length>20||ids.some(id=>!/^[-a-zA-Z0-9_]{1,200}$/.test(id))||!ids.includes(actor.projectId)||query.format)throw new HTTPException(400,{message:'Explicitly select this brand and at least one other brand, up to 20 brands total; exports use each brand’s own report door'})
 async function permitted(id:string){
  const row=await c.env.DB.prepare(`SELECT p.id,p.name,m.role,s.settings_json FROM projects p
   JOIN memberships m ON m.project_id=p.id AND m.user_id=? LEFT JOIN project_settings s ON s.project_id=p.id
   WHERE p.id=? AND json_extract(COALESCE(s.settings_json,'{}'),'$.deleted_at') IS NULL`).bind(actor.id,id).first<{id:string;name:string;role:string;settings_json:string|null}>()
  if(!row)throw new HTTPException(403,{message:'Every selected brand requires explicit membership and report permission'})
  await requireReportPermission(c,{id:actor.id,projectId:id,role:row.role},'reports.view')
  return row
 }
 const brands=[]
 for(const id of ids){
  const row=await permitted(id),timezone=JSON.parse(row.settings_json||'{}').timezone||'UTC'
  if(!validTimezone(timezone))throw new HTTPException(422,{message:'Configure a valid timezone for every selected brand'})
  const report=await readReport(c.env,id,reportRange(query,timezone))
  // Detailed comments and conversation IDs stay within the individual brand door.
  const {comments,...metrics}=report
  brands.push({id,name:row.name,...metrics})
 }
 // A membership narrowed while another brand was being read cannot expose its data.
 for(const id of ids)await permitted(id)
 const aggregate=brands.reduce((sum,brand)=>({volume:sum.volume+brand.volume,resolved:sum.resolved+brand.aiResolution.total,ai:sum.ai+brand.aiResolution.count,rated:sum.rated+brand.satisfaction.total,positive:sum.positive+brand.satisfaction.positive}),{volume:0,resolved:0,ai:0,rated:0,positive:0})
 return c.json({data:{brands,aggregate:{...aggregate,aiResolutionRate:aggregate.resolved?aggregate.ai/aggregate.resolved:null,satisfactionRate:aggregate.rated?aggregate.positive/aggregate.rated:null},explanation:'Only explicitly selected brands with current membership and report permission are included. Each uses its own calendar timezone; customer identities, comments and credentials are excluded. Cross-brand medians and percentiles are not combined.'}})
})
