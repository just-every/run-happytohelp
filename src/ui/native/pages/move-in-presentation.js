import {reasons} from './move-in-reasons';

const labels={ticket_field:'Ticket fields',ticket_form:'Request forms',group:'Groups',schedule:'Business calendars',view:'Saved views',trigger:'Triggers',automation:'Automations','invalid-record':'Unreadable records',user:'People',contact:'Contacts',agent:'Staff',ticket:'Conversations',conversation:'Conversations',macro:'Saved replies',canned_response:'Saved replies',article:'Articles',collection:'Collections',category:'Categories','thread-page':'Thread pages','article-ref':'Article summaries','article-draft':'Article drafts','tag-name':'Tags'};
export const vendorNames={zendesk:'Zendesk',intercom:'Intercom',helpscout:'Help Scout',freshdesk:'Freshdesk'};
// The source's own name for one record, as its owner knows it.
const sourceKinds={ticket_field:'ticket field',ticket_form:'request form',group:'group',schedule:'business calendar',view:'view',trigger:'trigger',automation:'automation',user:'user',contact:'contact',agent:'agent',ticket:'ticket',conversation:'conversation',macro:'macro',canned_response:'canned response',article:'article',collection:'collection',category:'category','thread-page':'thread page','article-ref':'article summary','article-draft':'article draft'};
const expected={expected_string:'should be text',expected_integer:'should be a whole number',expected_id:'should be an ID',expected_iso:'should be a date and time such as 2024-01-31T10:00:00Z',expected_unix:'should be a Unix time in seconds',expected_object:'should be an object',expected_array:'should be a list',expected_boolean:'should be true or false',expected_visibility:'should be true or false',required_structural_field_missing:'is missing',unsupported_structural_value:'has a value HappyToHelp doesn’t recognise'};
const field=path=>`“${String(path).replace(/^\//,'').replace(/~1/g,'/').replace(/~0/g,'~')||'record'}”`;
// Codes that carry a field or record name after a colon.
const patterns=[
 [/^configuration_action_unsupported:(.*)$/,([,name])=>`The “${name}” action cannot be translated safely. This entire rule stays in your original file and is not activated.`],
 [/^configuration_condition_unsupported:([^:]*):(.*)$/,([,name])=>`The “${name}” condition cannot be translated safely. The whole rule or view is set aside, so its scope is never broadened.`],

 [/^unsupported_source_field:(.*)$/,([,path])=>`The ${field(path)} field isn’t used by HappyToHelp; it stays in your original file.`],
 [/^opaque_source_field:(.*):[a-z_]+$/,([,path])=>`The ${field(path)} field stays in your original file; it isn’t imported.`],
 [/^malformed_source_field:(.*):([a-z_]+)$/,([,path,why])=>`The ${field(path)} field ${expected[why]||'can’t be read'}, so it was set aside.`],
 [/^unsupported_record_kind:(.*)$/,([,kind])=>`HappyToHelp doesn’t import “${kind}” records; they stay in your original file.`],
 [/^unsupported_envelope_field:(.*)$/,([,name])=>`The “${name}” list isn’t imported; it stays in your original file.`],
 [/^unsupported_part_type:(.*)$/,([,kind])=>`Conversation parts of type “${kind}” aren’t imported.`],
 [/^unsent_or_hidden_thread_not_imported:([^:]*):(.*)$/,([,id,state])=>`Thread ${id} was never sent (${state}), so it isn’t imported.`],
 [/^thread_event_metadata_only:(.*)$/,([,id])=>`Thread ${id} is an event, kept in your original file only.`],
 [/^saved_reply_reference_not_content:(.*)$/,([,id])=>`A message used saved reply ${id}; the saved reply itself isn’t part of this file.`],
 [/^attachments_metadata_retained_bytes_not_imported:.*$/,()=>reasons.attachments_metadata_retained_bytes_not_imported],
 [/^source_metadata_only:(.*)$/,([,kind])=>`The ${sourceKinds[kind]||kind} is kept in your original file only.`],
];
export const kindLabel=kind=>labels[kind]||String(kind).replaceAll('_',' ');
export function reasonLabel(reason){
 const text=String(reason);if(reasons[text])return reasons[text];
 for(const [pattern,words] of patterns){const match=text.match(pattern);if(match)return words(match)}
 return text.replaceAll('_',' ');
}
/** "Zendesk ticket 5001", "Tag “billing”", or "Line 4 of export.jsonl" for a record without an ID. */
export function recordName(vendor,decision){
 if(decision.kind==='tag-name')return `Tag “${decision.sourceId}”`;
 if(decision.sourceId==null)return `Line ${decision.location?.row||1} of ${decision.location?.artifact}`;
 return `${vendorNames[vendor]||vendor} ${sourceKinds[decision.kind]||String(decision.kind).replaceAll('_',' ')} ${decision.sourceId}`;
}
export const where=location=>location?`${location.artifact}, line ${location.row||1}`:'';
