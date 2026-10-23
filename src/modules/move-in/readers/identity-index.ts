import {archiveChunk} from './archive'
import {indexFile} from './records'
import {lowerPosition,RecordStructureError} from './classification'
import {auditShape} from './shapes'
import {AdmissionError,IndexLimitError} from './admission-error'
import {LIMITS,type Vendor} from '../types'
import {attachmentReferences,attachmentMember,isAttachmentMember} from './attachment-references'
export interface IdentityIndexIssue {code:string;location:{artifact:string;row:number;pointer:string};reason?:string}
/** Full syntax validation and bounded schema traversal precede any D1/R2 writes.
 * Diagnostic presentation never controls this traversal. Unknown semantic leaves
 * remain incomplete; a structural/work limit is an admission refusal. */
export async function indexUpload(vendor:Vendor,name:string,bytes:Uint8Array,accept:(people:Record<string,any>[],references:unknown[],location:{artifact:string;row:number;pointer:string},uninterpreted:unknown[])=>void,incomplete?:(issue:IdentityIndexIssue)=>void){
 let cursor=0,complete=true,records=0,nodes=0,opaqueNodes=0;
 const binary=new Set<string>(),referenced=new Set<string>()
 do{
  let chunk;try{chunk=await archiveChunk(name,bytes,cursor)}catch(error){if(error instanceof AdmissionError)throw error;throw new AdmissionError(error instanceof Error?error.message:'invalid_archive',name)}
  for(const file of chunk.files){
   if(isAttachmentMember(file.name)){binary.add(file.name);continue}
   let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes).replace(/^\uFEFF/,'')}catch{throw new AdmissionError('invalid_utf8',file.name)}
   let positions;try{positions=indexFile(file,vendor,LIMITS.records-records)}catch(error){if(error instanceof IndexLimitError)throw new AdmissionError(error.message,file.name,error.row,error.pointer);throw error}
   records+=positions.length
   for(const position of positions){
    const location={artifact:file.name,row:position.row,pointer:position.pointer},refuse=(code:string,pointer=position.pointer):never=>{throw new AdmissionError(code,file.name,position.row,pointer)}
    if(position.error)refuse(position.error)
    const body=raw.slice(position.start,position.end);if(new TextEncoder().encode(body).length>LIMITS.recordBytes)refuse('record_size_limit')
    let record:unknown;try{record=JSON.parse(body)}catch{refuse('invalid_json')}
    if(position.unsupported!==undefined){complete=false;incomplete?.({code:'unsupported_source_field',location})}
    let classification;try{classification=lowerPosition(record,vendor,position.unsupported,position.sourceKind)}catch(error){if(error instanceof RecordStructureError)refuse(error.message,position.pointer+error.pointer);throw error}
    if('field' in classification){opaqueNodes+=classification.nodes;if(opaqueNodes>LIMITS.opaqueUploadNodes)refuse('upload_opaque_structure_node_limit');accept([],[],location,[classification.payload]);continue}
    const {kind,payload,prefix}=classification
    for(const ref of attachmentReferences(vendor,kind,payload))referenced.add(attachmentMember(ref.conversation,ref.occurrence))
    const shape=auditShape(vendor,['user','lead'].includes(kind)&&vendor==='intercom'?'contact':kind,payload);nodes+=shape.nodes
    if(shape.exhausted!==undefined)refuse('source_identity_node_limit',position.pointer+prefix+shape.exhausted)
    if(nodes>LIMITS.identityNodes)refuse('upload_identity_node_limit',position.pointer+prefix)
    if(!shape.complete){complete=false;for(const issue of shape.issues)incomplete?.({code:issue.code,location:{...location,pointer:position.pointer+prefix+issue.path},reason:issue.reason})}
    accept(shape.people,shape.references,location,shape.uninterpreted)
   }
  }
  if(chunk.done)break;cursor=chunk.next
 }while(true)
 // Empty members are valid auxiliaries, so decide only after the entire bounded
 // archive has passed validation. Count source positions, not extracted aliases:
 // unsupported records still require their own reasoned plan decisions.
 for(const file of binary)if(!referenced.has(file))throw new AdmissionError('unreferenced_attachment',file)
 if(records===0)throw new AdmissionError('empty_export',name,1,'','Export is empty: no source records were found')
 return complete
}
