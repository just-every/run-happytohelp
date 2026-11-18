// Vite serve-only entry. Production never imports the local identity layer.
import worker from '../server'
import {withLocalOwner} from './owner-entry'
import type {Env,Job} from '../platform/env'
export {ConversationSocket} from '../server'
const local=withLocalOwner(worker)
export default {...local,fetch(request:Request,env:Env,execution:ExecutionContext){
 return local.fetch(request,{...env,APP_ORIGIN:import.meta.env.RER_LOCAL_ORIGIN||env.APP_ORIGIN},execution)
}} satisfies ExportedHandler<Env,Job>
