import type {Env} from '../../platform/env'
import {publishActivity} from '../conversations/activity'

/** Only invalidate operator projections after a durable commit; never replay a
 * committed merge or mail operation because a live connection was unavailable. */
export async function publishConversationAction(env:Env,projectId:string,ids:string[],kind:string){
 try{await Promise.all(ids.map(id=>publishActivity(env,projectId,id,kind)));return true}
 catch(error){console.error('Committed conversation action could not publish its live refresh',error);return false}
}
