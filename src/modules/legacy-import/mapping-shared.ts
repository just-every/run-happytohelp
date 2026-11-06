import { type Row,type LegacyBundle,type MappedRow,timestamp,text,stable } from './types'
export const truth=(value:unknown)=>value===true||value===1||value==='1'||value==='true'
export const columns=(row:Row,names:string[])=>Object.fromEntries(names.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))
export const minor=(v:unknown)=>{const value=String(v);if(!/^-?\d+(\.\d{1,2})?$/.test(value))throw new Error('Invalid exact currency decimal');const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split('.');const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));const result=Number(negative?-amount:amount);if(!Number.isSafeInteger(result))throw new Error('Currency amount exceeds exact safe range');return result}
export const minorUnits=(value:unknown)=>{const raw=String(value);if(!/^-?\d+$/.test(raw))throw new Error('Invalid exact currency minor amount');const amount=Number(raw);if(!Number.isSafeInteger(amount))throw new Error('Currency minor amount exceeds exact safe range');return amount}
export const active=(state:unknown)=>['queued','pending','running','sending','processing','in_progress','needs_input'].includes(String(state))
export function publishedFiles(dataset:Row,bundle:LegacyBundle){
 const files=(bundle.tables.dataset_files||[]).filter(file=>String(file.dataset_id)===String(dataset.id)&&!file.deleted_at&&(file.markdown||file.content))
 if(dataset.status==='ready')return files
 if(!dataset.last_refreshed_at)return []
 if(Array.isArray(dataset.published_file_ids))return files.filter(file=>(dataset.published_file_ids as unknown[]).map(String).includes(String(file.id)))
 const refreshed=timestamp(dataset.last_refreshed_at)
 return files.filter(file=>(file.updated_at||file.created_at)&&timestamp(file.updated_at||file.created_at)<=refreshed)
}
