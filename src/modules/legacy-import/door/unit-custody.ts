import type {DoorPackageFile} from '../../import-kit/src/door/types'
import type {ParsedRecord} from '../../import-kit/src/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {recordKey,type PreparedLegacy} from './bridge'
import {legacyBlobContext} from './blob-context'
import type {DecodedLegacy} from './format'
import {unitCompare,unitRefusal} from './unit-graph'

const alias=(kind:string,sourceId:string,role:'context'|'archive'|'rejected'|'metadata',files:string[])=>({kind,sourceId,role,files:files.sort()})
const file=(path:string,role:'source'|'object'|'context',logicalBytes:number)=>({path,role,logicalBytes})
/** File custody and context copies are separate from primary records. Every
 * verified file and every additional alias receives exactly one stable owner. */
export function legacyUnitCustody(prepared:PreparedLegacy,decoded:DecodedLegacy,files:readonly DoorPackageFile[],owner:Map<string,string>,destination:string){
 const byOwner=new Map([...new Set(owner.values())].map(id=>[id,{files:[] as ReturnType<typeof file>[],aliases:[] as ReturnType<typeof alias>[]}]))
 const primary=new Map<string,ParsedRecord[]>(),recordFiles=new Map<string,string[]>(),fileOwners=new Map<string,string>(),aliasOwners=new Map<string,{owner:string;value:ReturnType<typeof alias>}>(),declared=new Map(files.map(f=>[f.path,f]))
 if(declared.size!==files.length)return unitRefusal('A verified file identity repeats.')
 const addAlias=(id:string,value:ReturnType<typeof alias>)=>{const key=recordKey(value.kind,value.sourceId),prior=aliasOwners.get(key);if(prior){prior.value.files=[...new Set([...prior.value.files,...value.files])].sort();if(id<prior.owner)prior.owner=id}else aliasOwners.set(key,{owner:id,value})}
 const addFile=(path:string,role:'source'|'object'|'context',ids:string[],bytes?:number)=>{const entry=declared.get(path);if(!entry||bytes!==undefined&&entry.bytes!==bytes||fileOwners.has(path))return unitRefusal('File custody differs from the decoded source.');const choices=ids.map(id=>owner.get(id));if(choices.some(id=>!id))return unitRefusal('A file has no primary owner.');const id=choices.sort()[0];if(!id)return unitRefusal('A file has no stable custody owner.');fileOwners.set(path,id);byOwner.get(id)!.files.push(file(path,role,entry.bytes))}
 for(const record of prepared.records)if(record.pointer){const match=/^\/primary\/([a-z][a-z0-9_]*)\/(\d+)$/.exec(record.pointer);if(!match||match[1]!==record.kind)return unitRefusal('A prepared source pointer is unsupported.');const list=primary.get(record.kind)??[];if(list[Number(match[2])])return unitRefusal('A primary row repeats.');list[Number(match[2])]=record;primary.set(record.kind,list)}
 for(const [table,rows] of Object.entries(decoded.bundle.tables)){const records=primary.get(table)??[];if(records.length!==rows.length||rows.some((row,i)=>!records[i]||canonicalJson((records[i].payload as {row:unknown}).row)!==canonicalJson(row)))return unitRefusal('Prepared primary rows differ from decoded custody.')}
 const offsets=new Map<string,number>()
 for(const part of decoded.manifest.chunks){const start=offsets.get(part.table)??0,records=(primary.get(part.table)??[]).slice(start,start+part.count);offsets.set(part.table,start+part.count);const ids=records.map(r=>recordKey(r.kind,r.sourceId));addFile(part.file,'source',ids.length?ids:[recordKey('legacy-manifest',String(decoded.manifest.source.projectId))],part.bytes);for(const id of ids)recordFiles.set(id,[...(recordFiles.get(id)??[]),part.file])}
 offsets.clear()
 for(const part of decoded.manifest.context){const start=offsets.get(part.table)??0,records=(primary.get(part.table)??[]).slice(start,start+part.count);offsets.set(part.table,start+part.count);const ids=records.map(r=>recordKey(r.kind,r.sourceId));addFile(part.file,'context',ids.length?ids:[recordKey('legacy-manifest',String(decoded.manifest.source.projectId))],part.bytes);for(const r of records){const id=recordKey(r.kind,r.sourceId);addAlias(owner.get(id)!,alias('legacy-context:'+r.kind,r.sourceId,'context',[part.file]))}}
 const contexts=legacyBlobContext(decoded,destination)
 for(const [i,object] of decoded.objects.entries()){const id=recordKey('legacy-object',String(object.metadata.mediaId)),group=owner.get(id);if(!group)return unitRefusal('An object has no prepared source identity.');addFile(object.metadata.file,'object',[id],object.bytes.length);recordFiles.set(id,[object.metadata.file]);for(const digest of contexts[i].aliases)addAlias(group,alias('legacy-identity',digest,'metadata',[object.metadata.file]))}
 const manifest=recordKey('legacy-manifest',String(decoded.manifest.source.projectId));addFile('manifest.json','source',[manifest]);addAlias(owner.get(manifest)!,alias('legacy-manifest-metadata',String(decoded.manifest.source.projectId),'metadata',['manifest.json']))
 for(const record of prepared.records){const id=recordKey(record.kind,record.sourceId),mapped=prepared.mapping.get(id)!;if(mapped.rejection||!mapped.effects.length)addAlias(owner.get(id)!,alias('legacy-disposition:'+record.kind,record.sourceId,mapped.rejection?'rejected':'archive',recordFiles.get(id)??['manifest.json']))}
 if(fileOwners.size!==declared.size)return unitRefusal('A verified file has no compiler custody owner.')
 for(const {owner:id,value} of aliasOwners.values())byOwner.get(id)!.aliases.push(value)
 for(const value of byOwner.values()){value.files.sort((a,b)=>unitCompare(a.path,b.path));value.aliases.sort((a,b)=>unitCompare(recordKey(a.kind,a.sourceId),recordKey(b.kind,b.sourceId)))}
 return byOwner
}
