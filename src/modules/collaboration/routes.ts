import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {dashboardAccess} from '../management/dashboard'
import {requestSource} from '../audit/record'
import {memberAccess} from '../access/gate'
import {listFollowers,setFollowers} from './followers'
export const collaborationRoutes=new Hono<AppEnv>()
const prefix='/projects/:projectId/conversations/:conversationId'
collaborationRoutes.get(`${prefix}/collaboration`,async c=>{
 const {actor,conversation}=await dashboardAccess(c)
 const [followers,members,access]=await Promise.all([
  listFollowers(c.env,actor.projectId,conversation.id),
  c.env.DB.prepare('SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name,u.id LIMIT 1000').bind(actor.projectId).all<{id:string;name:string}>(),
  memberAccess(c.env.DB,actor.projectId,actor.id),
 ])
 return c.json({data:{followers,members:members.results,following:followers.some(row=>row.id===actor.id),canManageFollowers:access?.permissions.has('conversations.manage')??false}})
})
collaborationRoutes.put(`${prefix}/followers`,async c=>{
 const {actor,conversation}=await dashboardAccess(c),body=await c.req.json()
 const followers=await setFollowers(c.env,actor,conversation.id,body?.user_ids,{sessionHash:c.get('sessionHash'),source:requestSource(c)})
 return c.json({data:{followers,following:followers.some(row=>row.id===actor.id)}})
})
