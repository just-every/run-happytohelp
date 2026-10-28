import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'

/** Invalidate native open views after a committed role change. Reads and writes
 * still authorize independently; a disconnected client cannot retain authority. */
export function publishAccessChange(c:Context<AppEnv>,projectId:string,target:{roleId?:string;userId?:string}){
 c.executionCtx.waitUntil(c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(`project:${projectId}`)).fetch('https://conversation.internal/access-change',{method:'POST',body:JSON.stringify(target)}).catch(()=>{console.error('Native access refresh notification failed')}))
}
