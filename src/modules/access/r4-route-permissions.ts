import type {Permission} from './catalogue'
type Rule=Permission|'self'|'none'
/** R4 doors share the same permission whether called by settings or the inbox. */
export function r4RouteRule(method:string,path:string):Rule|undefined{
 const base='/api/(?:management|dashboard)/projects/:projectId'
 if(!new RegExp(`^${base}/`).test(path))return
 const tail=path.replace(new RegExp(`^${base}`),'')
 if(tail==='/notification-triggers')return method==='GET'?'self':'settings.manage'
 if(/^\/notification-(?:preferences|inbox)(?:\/:id\/read)?$/.test(tail))return 'self'
 if(tail==='/macros')return 'self'
 if(tail==='/macros/attachment-options')return 'self'
 if(/^\/macros\/:macroId(?:\/(?:versions|usage))?$/.test(tail))return 'self'
 if(/^\/macros\/:macroId\/(?:preview|apply)$/.test(tail))return 'conversations.manage'
 if(/^\/conversations\/:conversationId\/(?:macro-draft|collaboration)$/.test(tail))return 'self'
 if(tail==='/conversations/:conversationId/followers'&&method==='PUT')return 'conversations.manage'
 if(/^\/conversations\/:conversationId\/(?:merge(?:\/preview)?|merges(?:\/:mergeId\/undo)?)$/.test(tail))return method==='GET'?'self':'conversations.manage'
 if(tail==='/conversations/:conversationId/merged-history')return 'self'
 if(/^\/conversations\/:conversationId\/partner-(?:forwards(?:\/(?:preview|:forwardId))?|files\/:fileId)$/.test(tail))return method==='GET'?'self':'conversations.reply'
}
