import {app} from '../../src/app'
import {consumeQueue} from '../../src/queue'
export {ConversationSocket} from '../../src/modules/conversations/socket'
export default {queue:consumeQueue,fetch(request:Request,env:any,context:ExecutionContext){return app.fetch(request,env,context)}}
