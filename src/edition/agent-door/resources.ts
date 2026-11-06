import type {Env} from '../../platform/env'
import type {ResourceDefinition} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {articleRead,contextRead,conversationRead,jobRead,operationRead,readClasses,type Who} from './read.ts'
import {linkedProject} from './people.ts'
export function happyResources(env:Env):ResourceDefinition[]{
 const resource=(path:string,name:string,scope:string,read:(who:Who,id:string)=>Promise<any>):ResourceDefinition=>({
  uriTemplate:'happytohelp://projects/{project}/'+path,name,mimeType:'application/json',scope:'happytohelp.'+scope,classes:['jobs.read','operations.read'].includes(scope)?['standard']:['standard','sensitive'],
  classify:record=>['jobs.read','operations.read'].includes(scope)?[{class:'standard',facts:{measure:1}}]:readClasses(record.json),
  async read(uri,ctx){
   try{
    const parsed=new URL(uri),parts=parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent),project=await linkedProject(env)
    if(parsed.protocol!=='happytohelp:'||parsed.hostname!=='projects'||!project||parts[0]!==project.project_id||!ctx.scopes.includes('happytohelp.'+scope))return null
    return {json:await read(ctx,parts[2]),untrusted:true}
   }catch{return null}
  },
 })
 return [
  resource('conversations/{id}','Support transcript','conversations.read',(who,id)=>conversationRead(env,who,id)),
  resource('conversations/{id}/context','Customer context','context.read',(who,id)=>contextRead(env,who,id)),
  resource('articles/{id}','Knowledge article','articles.read',(who,id)=>articleRead(env,who,id)),
  resource('jobs/{id}','Connector work','jobs.read',(who,id)=>jobRead(env,who,id)),
  resource('operations/{id}','Attributed native operation','operations.read',(who,id)=>operationRead(env,who,id)),
 ]
}
