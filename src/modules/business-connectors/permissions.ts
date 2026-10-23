import type {Permission} from '../access/catalogue'
export function businessRouteRule(method:string,path:string):Permission|'self'|undefined{
 if(!path.startsWith('/api/business/projects/:projectId/'))return
 if(method==='GET'||path.endsWith('/refresh'))return 'self'
 if(path.endsWith('/connections')||method==='DELETE')return 'integrations.install'
 if(path.endsWith('/map'))return 'contacts.manage'
 if(['/approve','/execute','/reconcile'].some(end=>path.endsWith(end)))return 'refunds.approve'
 return 'conversations.manage'
}
