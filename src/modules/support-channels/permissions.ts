import type {Permission} from '../access/catalogue'
/** Public provider signatures authorize webhooks; native settings and transcript doors keep explicit role rules. */
export function supportChannelRule(method:string,path:string):Permission|'self'|'none'|undefined{
 if(path==='/api/support-channels/webhooks/:id'||path==='/api/support-channels/attachments/:token')return 'none'
 const prefix='/api/support-channels/projects/:projectId'
 if(path===prefix+'/connections'||path===prefix+'/connections/:id')return 'integrations.install'
 if(path===prefix+'/conversations/:conversationId/templates')return 'conversations.reply'
 if(path===prefix+'/connections/:id/link-code')return 'self'
 if(path===prefix+'/connections/:id/accounts')return 'integrations.install'
 if(path===prefix+'/report')return 'reports.view'
 if(path===prefix+'/conversations/:conversationId/consent')return 'conversations.manage'
 if(method==='GET'&&path===prefix+'/conversations/:conversationId')return 'self'
}
