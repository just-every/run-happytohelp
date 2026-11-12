import { type Row,type LegacyBundle,type MappedRow,timestamp,text,stable } from './types'
import {mapCore} from './map-core'
import {mapKnowledge} from './map-knowledge'
import {archiveOnly} from './archive-only'
import {mapOperations} from './map-operations'
import {historical,type MappingProfile} from './adoption/profile'
import {historicalTargets} from './adoption/historical'
import {historicalNoteMedia} from './adoption/note-media'
export function mapLegacy(table:string,row:Row,bundle:LegacyBundle,profile?:MappingProfile):MappedRow[]{
 if(historical(profile)&&['users','user_settings','project_users','memberships','ai_defaults'].includes(table))return []
 const mapped=archiveOnly(table,row,bundle)?[]:historical(profile)&&table==='media'?historicalNoteMedia(row,bundle,profile):mapCore(table,row,bundle,profile)??mapKnowledge(table,row,bundle)??mapOperations(table,row,bundle)??[]
 return historical(profile)?historicalTargets(table,row,bundle,mapped,profile):mapped
}
// Knowledge comes before contacts: publishing a document raises the context
// revision of every customer in the workspace, which costs nothing before any exists.
export const tableOrder=['projects','users','project_users','memberships','ai_defaults','ais','ai_profiles','datasets','knowledge_datasets','dataset_files','knowledge_versions','knowledge_documents','context_subjects','contacts','conversations','buckets','messages','events','notes','conversation_notes','conversation_participants','media','categories','knowledge_categories','articles','knowledge_articles','article_categories','knowledge_article_categories','macros','plugins','collectors','collector_actions','context_evidence','context_profiles','context_insights','insights','collector_summaries','ai_generations','ai_attempts','ai_round_usage','local_agent_grants','local_grants','local_agent_devices','local_devices','local_agent_device_project_settings','support_delegations','local_jobs','support_delegation_events','local_events','training_runs','training_cases','billing_accounts','charges','billing_ledger','billing_operations','ai_usages','ai_usage']
