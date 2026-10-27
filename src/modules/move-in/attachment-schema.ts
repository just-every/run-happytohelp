import type {Env} from '../../platform/env'

/** Reads may precede the additive migration; admission still requires it. */
export async function hasSuppliedAttachmentSchema(env:Env){
 const {results}=await env.DB.prepare("PRAGMA table_info(move_in_attachment_bytes)").all<{name:string}>()
 const columns=new Set(results.map(row=>row.name))
 return ['media_id','project_id','conversation_id','note_id','base64'].every(name=>columns.has(name))
}
