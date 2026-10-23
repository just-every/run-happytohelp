import {archive} from './archive-inputs.mjs';
export const emptyReason='Export is empty: no source records were found';
export const encode=body=>typeof body==='string'?Buffer.from(body):body;
export const sourceName=vendor=>vendor==='zendesk'?'source.ndjson':'source.json';
export function person(vendor){return vendor==='zendesk'?{user:{id:83,role:'end-user',name:'Keira',email:'keira@example.test',created_at:'2024-04-01T00:00:00Z'}}:{type:'contact',id:'person-83',name:'Keira',email:'keira@example.test',created_at:1711929600}}
// These inputs and expected empty outcomes are handwritten, not obtained from
// the reader. Unknown semantic fields still count as source positions.
export function emptyFiles(vendor){return vendor==='zendesk'?[
 ['zero.ndjson',''],['blank.ndjson',' \t\r\n\n '],['bom.ndjson','\uFEFF \r\n\t'],
]:[
 ['zero.json',''],['blank.json',' \t\r\n\n '],['bom.json','\uFEFF \r\n\t'],
 ['zero.jsonl',''],['blank.jsonl',' \t\r\n\n '],['bom.jsonl','\uFEFF \r\n\t'],
 ['array.json','\n[]'],['list.json','\n{"type":"list"}'],
 ['envelope.json','\n{"contacts":[],"conversations":[],"articles":[],"macros":[],"data":[]}'],
 ['metadata.json','{"type":"contact.list","total_count":0,"pages":{},"data":[]}'],
 ['lines.jsonl','\n[]\r\n{"kind":"list","data":[]}\r\n'],
]}
export function emptyCases(vendor){const files=emptyFiles(vendor);return [
 ...files,
 ['zero-files.zip',archive([])],
 ['directory.zip',archive([{name:'empty/'}])],
 ['later-directories.zip',archive(Array.from({length:25},(_,i)=>({name:`empty-${i}/`,method:i%2?0:8})))],
 ['blank-member.zip',archive([{name:'nested/source.jsonl',body:'\uFEFF \r\n\t'}])],
 ['multiple-empty.zip',archive(files.map(([name,body])=>({name,body})))],
 ['later-empty.zip',archive([...Array.from({length:21},(_,i)=>({name:`empty-${i}/`})),...files.map(([name,body])=>({name,body}))])],
]}
export function laterSource(vendor,{unsupported=false,offset=25}={}){
 const record=unsupported?vendor==='zendesk'?{audit_log:{id:91,name:'Source-only audit entry'}}:{type:'audit_log',id:'audit-91',name:'Source-only audit entry'}:person(vendor);
 const entries=[...Array.from({length:offset},(_,i)=>({name:`empty-${i}/`,method:i%2?0:8})),...emptyFiles(vendor).map(([name,body])=>({name,body})),{name:sourceName(vendor),body:'\r\n'+JSON.stringify(record)}];
 return {entries,body:archive(entries),record};
}
export const upload=(body,name,actor='owner')=>({method:'POST',actor,headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});
