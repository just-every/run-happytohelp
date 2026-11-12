import runtime from '../../helpers/legacy-worker/runtime'
import type {Env} from '../../../src/platform/env'
export {ConversationSocket} from '../../helpers/legacy-worker/runtime'
// Test-only configured first-owner bootstrap; native authentication stays real.
export default {...runtime,fetch:(request:Request,env:Env,context:ExecutionContext)=>runtime.fetch(request,{...env,H2H_SETUP_TOKEN:'synthetic-wire-setup',OWNER_EMAIL:'synthetic-wire@example.test'},context)}
