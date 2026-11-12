import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {enforceRole,memberAccess} from '../../access/gate'
import {projectCounts} from './counts'
import {projectReceipts} from './receipts'
import {parameters,receiptSelector} from './selectors'

export const c2Diagnostics=new Hono<AppEnv>()
const base='/projects/:projectId/diagnostics/c2'
c2Diagnostics.use(base+'/*',async(c,next)=>{
 c.header('Cache-Control','no-store')
 await next()
 // Native permission refusals can carry their own Response and replace prepared headers.
 c.res.headers.set('Cache-Control','no-store')
})
async function authority(c:Parameters<typeof scope>[0]){
 const actor=await scope(c,true)
 await enforceRole(c,{...actor,role:actor.role==='owner'?'owner':'admin'},'settings.manage')
 const access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access||access.ticketScope!==null||access.knowledgeArticleIds!==null)throw new HTTPException(403,{message:'Whole-project diagnostic access required'})
 return actor
}
c2Diagnostics.get(base+'/counts',async c=>{
 parameters(c.req.url,[])
 const actor=await authority(c)
 return c.json({data:await projectCounts(c.env.DB,actor.projectId),installationObservation:{kind:'mailgun_token_claims',state:'pending'}})
})
c2Diagnostics.get(base+'/receipts',async c=>{
 const input=receiptSelector(c.req.url),actor=await authority(c)
 return c.json({data:await projectReceipts(c.env.DB,actor.projectId,input)})
})
