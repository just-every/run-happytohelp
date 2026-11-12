/** Rowid is the unique, immutable insertion key of these durable rowid tables.
 * It pages duplicate source IDs too, without putting a concealed target ID in a cursor.
 * These reads observe a quiescent pull; they do not promise a transactional snapshot. */
export type ProjectionKind='tickets'|'articles'
export interface Position {v:1;project:string;kind:ProjectionKind;after:string}
const validRowid=(value:unknown):value is string=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n
export function encodeCursor(project:string,kind:ProjectionKind,after:string){
 const bytes=new TextEncoder().encode(JSON.stringify({v:1,project,kind,after} satisfies Position))
 return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
}
export function decodeCursor(value:string,project:string,kind:ProjectionKind):string {
 try{
 if(value.length>2048||!/^[-_A-Za-z0-9]+$/.test(value))throw new Error('invalid_cursor')
 const decoded=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)))
 const cursor=JSON.parse(decoded) as Position
 if(!cursor||Array.isArray(cursor)||Object.keys(cursor).sort().join(',')!=='after,kind,project,v'||cursor.v!==1||cursor.project!==project||cursor.kind!==kind||!validRowid(cursor.after)||encodeCursor(project,kind,cursor.after)!==value)throw new Error('invalid_cursor')
 return cursor.after
 }catch{throw new Error('invalid_cursor')}
}
