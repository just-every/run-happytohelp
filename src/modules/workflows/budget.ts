import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'
/** One cron invocation shares D1's 1,000-statement limit with integrations, mail and
 * the outbox. Each workflow phase stops starting new units once it has used its own
 * share, so a backlog in one never starves another; every unit is durable, so the
 * next minute resumes the rest. */
export type Spent=()=>boolean
export function workflowBudget(env:Env){
 const metered=boundedDatabase(env.DB),phases:{hit:boolean}[]=[]
 // A rolling phase (the SLA refresh scan) never finishes by design, so it never marks the run incomplete.
 const phase=(share:number,rolling=false):Spent=>{const start=metered.statements,state={hit:false};if(!rolling)phases.push(state);return ()=>state.hit||=metered.statements-start>=share}
 return {env:{...env,DB:metered.database},phase,complete:()=>!phases.some(p=>p.hit)}
}
