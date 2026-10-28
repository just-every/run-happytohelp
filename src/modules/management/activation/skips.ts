import type {Env} from '../../../platform/env'
import type {StepId} from './types'

/** What only the owner can do, and so what the owner may leave for now. Nothing the installation observes alone is skippable. */
export const skippable:readonly StepId[]=['widget_seen','model_key','sender_dns']

/** What a local trial goes without: the widget on the owner's own website and an AI key. */
export const localTrialSteps:readonly StepId[]=['widget_seen','model_key']

/** The skips stored for a workspace (`activation_skips`: step id to the time it was skipped, ms), read from the parsed project settings. */
export function storedSkips(settings:any):Set<StepId> {
 const stored=settings?.activation_skips
 return new Set(stored&&typeof stored==='object'&&!Array.isArray(stored)?skippable.filter(id=>typeof stored[id]==='number'):[])
}

/**
 * Skip or undo one step for the workspace in one atomic statement on the settings row (a skip creates it if it does not
 * exist yet). `json_patch` merges the nested object and removes a key patched to null, which `json_set` cannot do.
 * Skipping a skipped step or undoing an unskipped one changes nothing, not even the timestamp. The step is one of
 * `skippable`, never free text.
 */
function skipStatement(env:Env,projectId:string,id:StepId,skipped:boolean,now:number) {
 const path=`$.activation_skips.${id}`
 return skipped
  ? env.DB.prepare(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES(?,json_object('activation_skips',json_object(?,?)),?)
   ON CONFLICT(project_id) DO UPDATE SET settings_json=json_patch(settings_json,json_object('activation_skips',json_object(?,?))),updated_at=excluded.updated_at
   WHERE json_type(settings_json,?) IS NULL`).bind(projectId,id,now,now,id,now,path)
  : env.DB.prepare(`UPDATE project_settings SET settings_json=json_patch(settings_json,json_object('activation_skips',json_object(?,NULL))),updated_at=?
   WHERE project_id=? AND json_type(settings_json,?) IS NOT NULL`).bind(id,now,projectId,path)
}

export async function setSkip(env:Env,projectId:string,id:StepId,skipped:boolean) {
 await skipStatement(env,projectId,id,skipped,Date.now()).run()
}

/** Skip every local-trial step together, in one transaction; each keeps a skip it already had, as `setSkip` does. */
export async function skipLocalTrial(env:Env,projectId:string) {
 const now=Date.now()
 await env.DB.batch(localTrialSteps.map(id=>skipStatement(env,projectId,id,true,now)))
}
