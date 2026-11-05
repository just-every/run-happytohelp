import {DoorError} from '../../import-kit/src/door/protocol'
import {canonicalJson,sha256} from '../../import-kit/src/provenance/identity'

export const unitHash=(value:unknown)=>sha256(canonicalJson(value))
export const unitRefusal=(reason:string):never=>{throw new DoorError('legacy_work_unit_unsupported',422,{reason})}
export interface LegacyDependency {from:string;to:string;atomic:boolean;evidence:unknown}

/** Only explicit atomic closures coalesce. A cycle of otherwise ordered work
 * refuses, rather than changing its meaning by guessing a larger transaction. */
export function unitGroups(identities:string[],edges:LegacyDependency[]){
 const roots=new Map(identities.map(id=>[id,id]))
 const root=(id:string):string=>{const parent=roots.get(id);if(parent===undefined)return unitRefusal('A dependency is outside the prepared source.');if(parent!==id)roots.set(id,root(parent));return roots.get(id)!}
 for(const edge of edges){const a=root(edge.from),b=root(edge.to);if(edge.atomic&&a!==b)roots.set(a<b?b:a,a<b?a:b)}
 const members=new Map<string,string[]>()
 for(const id of identities){const r=root(id),group=members.get(r)??[];group.push(id);members.set(r,group)}
 const groups=[...members.values()].map(group=>group.sort()).sort((a,b)=>a[0]<b[0]?-1:1),owner=new Map(groups.flatMap(group=>group.map(id=>[id,group[0]] as const))),pending=new Map(groups.map(group=>[group[0],group]))
 const result:string[][]=[],done=new Set<string>()
 while(pending.size){const ready=[...pending.keys()].filter(id=>edges.every(edge=>owner.get(edge.from)!==id||owner.get(edge.to)===id||done.has(owner.get(edge.to)!))).sort()
  if(!ready.length)return unitRefusal('Ordered dependencies cycle outside a supported atomic closure.')
  for(const id of ready){result.push(pending.get(id)!);pending.delete(id);done.add(id)}
 }
 return {groups:result,owner}
}
