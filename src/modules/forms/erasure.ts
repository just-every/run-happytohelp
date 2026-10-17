import type {Env} from '../../platform/env'
/** Form values live in native ticket fields, already erased with their ticket. */
export function eraseFormStatements(env:Env,projectId:string,contactId:string){return [
 env.DB.prepare('DELETE FROM request_form_submissions WHERE project_id=? AND contact_id=?').bind(projectId,contactId),
]}
