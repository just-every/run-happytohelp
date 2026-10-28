import {app} from '../../src/app'
export {ConversationSocket} from '../../src/modules/conversations/socket'
export default {fetch(request:Request,env:any,context:ExecutionContext){return app.fetch(request,env,context)}}
