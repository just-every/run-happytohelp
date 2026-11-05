import {DoorError} from '../../import-kit/src/door/protocol'
import {canonicalJson,sha256} from '../../import-kit/src/provenance/identity'

export const unitCompare=(a:string,b:string)=>a<b?-1:a>b?1:0
export const unitHash=(value:unknown)=>sha256(canonicalJson(value))
export const unitRefusal=(reason:string):never=>{throw new DoorError('legacy_work_unit_unsupported',422,{reason})}
export interface LegacyDependency {from:string;to:string;atomic:boolean;evidence:unknown}

/** Only explicit atomic closures coalesce. A cycle of otherwise ordered work
 * refuses, rather than changing its meaning by guessing a larger transaction. */
export function unitGroups(identities:string[],edges:LegacyDependency[]){
 const roots=new Map(identities.map(id=>[id,id]))
 const root=(id:string):string=>{if(!roots.has(id))return unitRefusal('A dependency is outside the prepared source.');let parent=id;while(roots.get(parent)!==parent)parent=roots.get(parent)!;while(id!==parent){const next=roots.get(id)!;roots.set(id,parent);id=next}return parent}
 for(const edge of edges){const a=root(edge.from),b=root(edge.to);if(edge.atomic&&a!==b)roots.set(a<b?b:a,a<b?a:b)}
 const members=new Map<string,string[]>()
 for(const id of identities){const r=root(id),group=members.get(r)??[];group.push(id);members.set(r,group)}
 const groups=[...members.values()].map(group=>group.sort()).sort((a,b)=>unitCompare(a[0],b[0])),owner=new Map(groups.flatMap(group=>group.map(id=>[id,group[0]] as const))),byId=new Map(groups.map(group=>[group[0],group]))
 const needs=new Map(groups.map(group=>[group[0],new Set<string>()])),dependants=new Map(groups.map(group=>[group[0],new Set<string>()]))
 for(const edge of edges){const from=owner.get(edge.from)!,to=owner.get(edge.to)!;if(from!==to){needs.get(from)!.add(to);dependants.get(to)!.add(from)}}
 const result:string[][]=[];let ready=[...needs.keys()].filter(id=>!needs.get(id)!.size).sort()
 while(ready.length){const next:string[]=[];for(const id of ready){result.push(byId.get(id)!);for(const child of dependants.get(id)!){const pending=needs.get(child)!;pending.delete(id);if(!pending.size)next.push(child)}}ready=next.sort()}
 if(result.length!==groups.length)return unitRefusal('Ordered dependencies cycle outside a supported atomic closure.')
 return {groups:result,owner}
}
