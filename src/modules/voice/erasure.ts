import type {Env} from '../../platform/env'
const calls='SELECT id FROM voice_calls WHERE project_id=?1 AND contact_id=?2'
export const voiceErasureCount=`(SELECT count(*) FROM voice_calls WHERE project_id=?1 AND contact_id=?2 AND erased=0)`
export function voiceErasureStatements(env:Env,projectId:string,contactId:string){
 return [
 `DELETE FROM voice_context_links WHERE project_id=?1 AND (contact_id=?2 OR linked_contact_id=?2)`,
 `DELETE FROM voice_transcript_segments WHERE call_id IN (${calls})`,
 `INSERT OR IGNORE INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at) SELECT 'voice-erasure:'||?1||':'||?2||':'||n.provider,?1,?2,'voice:'||n.provider,'','unsupported','The telephony provider retains call metadata, recordings and transcripts under its own retention. Remove those copies in the provider account; local erasure does not recall them.',unixepoch()*1000,unixepoch()*1000 FROM voice_calls v JOIN voice_numbers n ON n.id=v.number_id AND n.project_id=v.project_id WHERE v.project_id=?1 AND v.contact_id=?2 GROUP BY n.provider`,
 `UPDATE voice_identities SET phone_cipher=NULL,erased=1 WHERE project_id=?1 AND contact_id=?2`,
 `UPDATE voice_steps SET response_xml='' WHERE call_id IN (${calls})`,
 `UPDATE voice_commands SET state='erased' WHERE project_id=?1 AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)`,
 `UPDATE voice_calls SET remote_cipher=NULL,recording_cipher=NULL,transcript=NULL,summary='',follow_up=0,provider_stop_state=NULL,erased=1 WHERE project_id=?1 AND contact_id=?2`,
 ].map(sql=>env.DB.prepare(sql).bind(projectId,contactId))
}
