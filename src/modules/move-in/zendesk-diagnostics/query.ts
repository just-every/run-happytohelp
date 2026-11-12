import {decodeCursor,type ProjectionKind} from './cursor'
export interface PageQuery {limit:number;after:string}
/** Only these fixed reads exist. No caller controls SQL, a vendor, project join or projection. */
export function readQuery(url:string,project:string,kind:ProjectionKind|'summary'):PageQuery {
 const query=new URL(url).search
 if(query.length>4096)throw new Error('invalid_query')
 const params=new URLSearchParams(query),allowed=kind==='summary'?[]:['limit','cursor']
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new Error('invalid_query')
 const limit=params.get('limit')??'50'
 if(!/^[1-9][0-9]?$/.test(limit)||Number(limit)>90)throw new Error('invalid_query')
 const cursor=params.get('cursor')
 return {limit:Number(limit),after:cursor===null?'0':decodeCursor(cursor,project,kind as ProjectionKind)}
}
