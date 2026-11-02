import {contextSubjectScopeSql} from './scope'
import { Hono } from 'hono'
import type { AppEnv } from '../../platform/env'

export const insightInventory = new Hono<AppEnv>()
insightInventory.get('/:projectId/insights', async c => {
 let before: [number, string] | undefined
 try {
  const raw = c.req.query('cursor')
  if (raw) {
   const parsed = JSON.parse(atob(raw))
   if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || typeof parsed[1] !== 'string' || parsed[1].length > 200) throw new Error('Invalid cursor')
   before = [parsed[0],parsed[1]]
  }
 } catch { return c.json({ error: 'Invalid cursor' }, 400) }
 const rows = await c.env.DB.prepare(`SELECT id,subject_id,help_type,content,buttons,evidence_ids,created_at,dismissed_at
  FROM context_insights WHERE project_id=? AND ${contextSubjectScopeSql('?','context_insights.project_id','context_insights.subject_id')}
  ${before ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''}
  ORDER BY created_at DESC,id DESC LIMIT 51`)
  .bind(c.req.param('projectId'), c.get('actor').id, ...(before ? [before[0], before[0], before[1]] : []))
  .all<{id:string;subject_id:string;help_type:string;content:string;buttons:string;evidence_ids:string;created_at:number;dismissed_at:number|null}>()
 const page = rows.results.slice(0, 50)
 const last = page.at(-1)
 return c.json({
  data: page.map(row => ({...row, title:row.help_type, buttons:JSON.parse(row.buttons), evidence_ids:JSON.parse(row.evidence_ids)})),
  nextCursor: rows.results.length > 50 && last ? btoa(JSON.stringify([last.created_at,last.id])) : null,
 })
})
