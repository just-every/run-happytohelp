import {apiRouter} from './http'
import {conversationApi} from './api-conversations'
import {resourceApi} from './api-resources'
import {managedTools} from './managed-tools'
export const api=apiRouter()
conversationApi(api)
resourceApi(api)
managedTools(api)

// A mounted router's notFound handler does not own misses in its parent.
api.all('*',c=>c.json({error:{code:'not_found',message:'Not found'}},404))
