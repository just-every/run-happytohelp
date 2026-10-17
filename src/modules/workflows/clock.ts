import type {Env} from '../../platform/env'
/** Runtime clock. A production request can never select the clock. Local installs
 * may bind H2H_WORKFLOW_NOW; the test Worker supplies the same binding at its edge. */
export function workflowNow(env:Env):number {
 if(String(env.H2H_LOCAL)==='true'&&env.H2H_WORKFLOW_NOW!==undefined){
  const value=Number(env.H2H_WORKFLOW_NOW)
  if(!Number.isSafeInteger(value)||value<0)throw new Error('H2H_WORKFLOW_NOW must be an epoch millisecond time')
  return value
 }
 return Date.now()
}

export async function workflowEnvironment(env:Env):Promise<Env>{
 if(String(env.H2H_LOCAL)!=='true'||env.H2H_WORKFLOW_NOW!==undefined)return env
 const clock=await env.DB.prepare('SELECT now FROM workflow_clock ORDER BY updated_at DESC LIMIT 1').first<{now:number}>()
 return clock?{...env,H2H_WORKFLOW_NOW:String(clock.now)}:env
}
