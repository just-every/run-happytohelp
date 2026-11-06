import {apiRouter} from './http'
import {conversationApi} from './api-conversations'
import {zapierApi} from './zapier'
import {mcpApi} from './mcp'
import {resourceApi} from './api-resources'
export const api=apiRouter()
conversationApi(api)
resourceApi(api)
zapierApi(api)
mcpApi(api)

// A mounted router's notFound handler does not own misses in its parent.
api.all('*',c=>c.json({error:{code:'not_found',message:'Not found'}},404))
