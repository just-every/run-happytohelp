import type {Env} from '../../platform/env'
import {resolveHelpAccess} from './access'
import {accessReaders} from './door'
import {renderKnowledge} from './reference-store'
/** Public HTML shares the JSON door's identity and neutral reference rendering. */
export async function renderPublicKnowledgeHtml(env:Env,projectId:string,request:Request,html:string){
 return renderKnowledge(env,projectId,html,accessReaders(await resolveHelpAccess(env,projectId,request)),'html')
}
