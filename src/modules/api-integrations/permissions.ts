/** Managed connector administration shares the native installation permission.
 * Provider intake authenticates its signature, never a native session. */
export function apiIntegrationRule(method:string,path:string):'integrations.install'|'none'|undefined{
 const root='/api/management/projects/:projectId/connections/helpscout'
 if(method==='POST'&&path==='/api/helpscout/projects/:projectId/webhook')return 'none'
 if(path===root&&['GET','PUT','DELETE'].includes(method)||path===root+'/pull'&&method==='POST'||path==='/api/management/projects/:projectId/connections/connectors'&&method==='GET')return 'integrations.install'
}
