import {Hono} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {machinePrincipal} from '../authority'
import {pullView} from '../../move-in/zendesk-source/view'
import {attachmentView} from '../../move-in/zendesk-attachments/view'
import {resumePull,scopedPull,startPull} from './pulls'
import {resumeAttachments,startAttachments} from './attachments'
import {copyControl} from './control'
import {result,verifyResult} from './result'
const root='/projects/:setupProjectId/rehearsals/:id/copy/zendesk/pulls'
export function createZendeskCopyRoutes(){
 const app=new Hono<AppEnv>()
 app.get('/projects/:setupProjectId/rehearsals/:id/copy/zendesk',async c=>{const g=await machinePrincipal(c);return c.json({data:{projectId:g.zendesk_project_id,subdomain:g.zendesk_subdomain,basePullId:g.zendesk_base_pull_id,acceptedCursor:JSON.parse(g.zendesk_cursor_json),activeDay:g.active_day}})})
 app.post(root,async c=>{const g=await machinePrincipal(c),pull=await startPull(c.env,g,await copyControl(c,['day','cursor']));return c.json({data:await pullView(c.env,pull,{yours:false,canStop:false,canTakeOver:false})},202)})
 app.get(root+'/:pullId',async c=>{const g=await machinePrincipal(c),pull=await scopedPull(c.env,g,c.req.param('pullId')!);return c.json({data:await pullView(c.env,pull,{yours:false,canStop:false,canTakeOver:false})})})
 app.post(root+'/:pullId/resume',async c=>{await copyControl(c);const g=await machinePrincipal(c),pull=await scopedPull(c.env,g,c.req.param('pullId')!);await resumePull(c.env,g,pull);return c.json({data:{id:pull.id}},202)})
 app.post(root+'/:pullId/attachments',async c=>{await copyControl(c);const g=await machinePrincipal(c),pull=await scopedPull(c.env,g,c.req.param('pullId')!),run=await startAttachments(c.env,g,pull);return c.json({data:await attachmentView(c.env,run)},202)})
 app.post(root+'/:pullId/attachments/resume',async c=>{await copyControl(c);const g=await machinePrincipal(c),pull=await scopedPull(c.env,g,c.req.param('pullId')!),run=await resumeAttachments(c.env,g,pull);return c.json({data:await attachmentView(c.env,run)},202)})
 app.post(root+'/:pullId/verify',async c=>{await copyControl(c);const g=await machinePrincipal(c),pull=await scopedPull(c.env,g,c.req.param('pullId')!);return c.json({data:await verifyResult(c.env,g,pull)})})
 app.get(root+'/:pullId/result',async c=>{const g=await machinePrincipal(c),pull=await scopedPull(c.env,g,c.req.param('pullId')!);return c.json({data:await result(c.env,g,pull)})})
 return app
}
