import type {Env} from '../../platform/env'
const invocation=Symbol('workflow invocation')
type InvocationEnv=Env&{[invocation]?:{id:string;events:Set<number>}}
/** Share the identity and served set through cron/queue message effects and both
 * journal phases. Another invocation or request cannot reset this invocation's
 * event allowance, even if it advances the durable event between phases. */
export function workflowInvocation(env:Env):string|undefined{return (env as InvocationEnv)[invocation]?.id}
export function servedWorkflowEvents(env:Env):Set<number>|undefined{return (env as InvocationEnv)[invocation]?.events}
export function withWorkflowInvocation(env:Env):Env{return workflowInvocation(env)?env:{...env,[invocation]:{id:crypto.randomUUID(),events:new Set<number>()}}}
