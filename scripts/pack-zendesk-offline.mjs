#!/usr/bin/env node
// Local files only. Output is packing data for the mounted Move in reader,
// never a Zendesk network exporter or a native database writer.
import {readFile,lstat,realpath} from 'node:fs/promises'
import {resolve,dirname,relative,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
const LIMIT=2*1024*1024,RECORD=128*1024,FORMAT='happytohelp-zendesk-offline-v1'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const id=value=>{if(!(typeof value==='number'&&Number.isSafeInteger(value)&&value>0||typeof value==='string'&&/^[1-9][0-9]*$/.test(value)))throw Error('positive Zendesk ID required');return String(value)}
export async function packZendesk(manifestPath){
 const root=dirname(resolve(manifestPath)),manifest=JSON.parse(await readFile(manifestPath,'utf8'))
 if(manifest.format!==FORMAT||!Array.isArray(manifest.files)||manifest.files.length>64)throw Error('offline manifest format or file count invalid')
 let readBytes=0,redacted=0
 const local=async path=>{
  if(typeof path!=='string'||isAbsolute(path)||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('local relative file path required')
  const file=resolve(root,path),stat=await lstat(file),actual=await realpath(file),rel=relative(root,actual)
  if(!stat.isFile()||stat.isSymbolicLink()||rel.startsWith('..')||isAbsolute(rel)||stat.size>LIMIT||readBytes+stat.size>LIMIT)throw Error('local file outside root or input bound')
  readBytes+=stat.size;return readFile(file)
 }
 const clean=value=>{
  if(typeof value==='string'&&/^https?:\/\//i.test(value)){try{const url=new URL(value);if(url.username||url.password||url.search||url.hash){url.username='';url.password='';url.search='';url.hash='';redacted++}return url.href}catch{return value}}
  if(Array.isArray(value))return value.map(clean)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,clean(child)]))
  return value
 }
 const records=[],tickets=new Map(),comments=new Map(),metrics=new Map(),audits=new Map()
 const plural={ticket:'tickets',user:'users',organization:'organizations',ticket_field:'ticket_fields',comments:'comments',metrics:'ticket_metric_events',audits:'audits'}
 for(const file of manifest.files){
  if(!Object.hasOwn(plural,file.kind))throw Error('unsupported source file kind')
  const bytes=await local(file.path),raw=bytes.toString('utf8');if(!bytes.equals(Buffer.from(raw)))throw Error('invalid UTF-8')
  if(['comments','metrics','audits'].includes(file.kind)&&file.ticket_id!==undefined){const target=file.kind==='comments'?comments:file.kind==='metrics'?metrics:audits;target.set(id(file.ticket_id),target.get(id(file.ticket_id))??[])}
  const pieces=/\.(?:jsonl|ndjson)$/i.test(file.path)?raw.split('\n').flatMap((line,i)=>line.trim()?[{value:JSON.parse(line),row:i+1,pointer:''}]:[]):[{value:JSON.parse(raw),row:1,pointer:''}]
  for(const piece of pieces){
   const value=piece.value,list=Array.isArray(value)?value:Array.isArray(value?.[plural[file.kind]])?value[plural[file.kind]]:[value?.[file.kind]??value]
   for(let i=0;i<list.length;i++){
    const record=clean(list[i]),source={file:file.path,sha256:digest(bytes),row:piece.row,pointer:Array.isArray(value)?`/${i}`:Array.isArray(value?.[plural[file.kind]])?`/${plural[file.kind]}/${i}`:piece.pointer}
    if(['ticket','user','organization','ticket_field'].includes(file.kind)){
     id(record.id)
     if(file.kind==='ticket'){
      if(record._offline!==undefined)throw Error('source ticket must not contain packing data')
      if(tickets.has(id(record.id))){if(JSON.stringify(tickets.get(id(record.id)).original)!==JSON.stringify(record))throw Error('conflicting repeated ticket ID');continue}
      const packed={...record,_offline:{format:FORMAT,attachments:[],history:{metrics:'missing',audits:'missing'},metric_events:[],audits:[],provenance:[source]}}
      tickets.set(id(record.id),{packed,original:record});records.push({ticket:packed})
     }else records.push({[file.kind]:record})
    }else{
     const tid=id(record.ticket_id??file.ticket_id),target=file.kind==='comments'?comments:file.kind==='metrics'?metrics:audits
     const entries=target.get(tid)??[];entries.push({record:{...record,ticket_id:tid},source,...(file.kind==='comments'?{complete:file.complete===true&&value?.next_page==null,page:file.page??1,pages:file.pages??1}:{})});target.set(tid,entries)
    }
   }
  }
 }
 for(const [tid,{packed}] of tickets){
  const pages=comments.get(tid)
  if(pages){
   if(!pages.length)throw Error('empty supplied comment component')
   const group=new Map();for(const page of pages)group.set(page.page,page)
   const expected=pages[0].pages
   packed._offline.comments_complete=pages.every(p=>p.complete&&p.pages===expected)&&Number.isSafeInteger(expected)&&expected>0&&group.size===expected&&Array.from({length:expected},(_,i)=>i+1).every(i=>group.has(i))
   const seen=new Set();packed.comments=[]
   for(const p of pages){const cid=id(p.record.id);if(seen.has(cid))throw Error('duplicate supplied comment ID');seen.add(cid);const {ticket_id,...comment}=p.record;packed.comments.push(comment);packed._offline.provenance.push(p.source)}
  }
  for(const [kind,map,key] of [['metrics',metrics,'metric_events'],['audits',audits,'audits']])if(map.has(tid)){
   packed._offline.history[kind]='supplied';packed._offline[key]=map.get(tid).map(entry=>entry.record);packed._offline.provenance.push(...map.get(tid).map(entry=>entry.source))
  }
 }
 for(const map of [comments,metrics,audits])for(const tid of map.keys())if(!tickets.has(tid))throw Error('source component references a missing ticket')
 const owners=new Set(),paths=new Set()
 for(const binding of manifest.attachments??[]){
  const ticket=tickets.get(id(binding.ticket_id))?.packed;if(!ticket)throw Error('attachment ticket missing')
  const aid=id(binding.attachment_id),cid=id(binding.comment_id),key=aid
  if(owners.has(key)||paths.has(binding.path))throw Error('ambiguous attachment binding');owners.add(key);paths.add(binding.path)
  const comment=ticket.comments?.find(c=>id(c.id)===cid),attachment=comment?.attachments?.find(a=>id(a.id)===aid)
  if(!attachment)throw Error('attachment source relationship missing')
  const bytes=await local(binding.path)
  if(!bytes.length||bytes.length>48*1024||attachment.size!==bytes.length||binding.size!==bytes.length||binding.sha256!==digest(bytes))throw Error('attachment digest or size mismatch')
  ticket._offline.attachments.push({attachment_id:attachment.id,comment_id:comment.id,path:binding.path,sha256:binding.sha256,base64:bytes.toString('base64')})
 }
 if(redacted)for(const {packed} of tickets.values())packed._offline.redacted_urls=redacted
 const lines=records.map(record=>JSON.stringify(record));if(lines.length>5000||lines.some(line=>Buffer.byteLength(line)>RECORD))throw Error('split export: record or count bound exceeded')
 const output=lines.join('\n')+'\n';if(Buffer.byteLength(output)>LIMIT)throw Error('split export: packed upload exceeds 2 MiB')
 return output
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==3)throw Error('usage: node scripts/pack-zendesk-offline.mjs local-manifest.json');process.stdout.write(await packZendesk(process.argv[2]))}catch(error){console.error(`Zendesk packing refused: ${error.message}`);process.exitCode=1}
}
