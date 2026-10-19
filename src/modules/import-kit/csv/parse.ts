import {HTTPException} from 'hono/http-exception'
import type {Definition,Kind,PreviewInput} from './types'
import {validateAttribute} from '../../customers/validation'

const bad=(message:string):never=>{throw new HTTPException(400,{message})}

/** RFC 4180 cells, including quoted commas, escaped quotes and embedded newlines. */
export function parseCsv(source:string){
 if(source.length>1_000_000)bad('CSV must be at most 1 MB')
 const records:string[][]=[],cells:string[]=[];let cell='',quoted=false,closed=false
 const pushCell=()=>{cells.push(cell);cell='';closed=false}
 const pushRow=()=>{pushCell();records.push(cells.splice(0))}
 source=source.replace(/^\uFEFF/,'')
 for(let i=0;i<source.length;i++){
  const char=source[i]
  if(quoted){if(char==='"'){if(source[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=char;continue}
  if(char===','){pushCell();continue}
  if(char==='\r'||char==='\n'){if(char==='\r'&&source[i+1]==='\n')i++;pushRow();continue}
  if(char==='"'){if(cell||closed)bad('Invalid quote in CSV');quoted=true;continue}
  if(closed)bad('Unexpected text after closing CSV quote')
  cell+=char
 }
 if(quoted)bad('Unclosed CSV quote')
 if(cell||cells.length||closed)pushRow()
 if(records.length<2)bad('CSV must contain a header and at least one data row')
 const headers=records.shift()!.map(value=>value.trim())
 if(headers.some(value=>!value)||new Set(headers).size!==headers.length)bad('CSV headers must be nonempty and unique')
 if(records.length>1000)bad('Import at most 1000 data rows per run')
 return {headers,records}
}

export function previewInput(body:unknown):PreviewInput{
 if(!body||typeof body!=='object')bad('Import body required')
 const b=body as Record<string,unknown>
 if(b.kind!=='contacts'&&b.kind!=='companies')bad('Choose contacts or companies')
 if(typeof b.csv!=='string'||!b.mapping||typeof b.mapping!=='object'||Array.isArray(b.mapping))bad('CSV and column mapping required')
 if(b.matchDomains!==undefined&&typeof b.matchDomains!=='boolean')bad('matchDomains must be a boolean')
 const mapping=b.mapping as Record<string,string>,allowed=b.kind==='contacts'?['name','email','externalId','company']:['name','domains']
 for(const [target,column] of Object.entries(mapping))if((!allowed.includes(target)&&!/^attribute:[\w-]+$/.test(target))||typeof column!=='string'||!column.trim())bad('Invalid column mapping')
 if(!Object.keys(mapping).length)bad('Map at least one column')
 if(b.kind==='companies'&&!mapping.name)bad('Map the company name column')
 return {kind:b.kind as Kind,csv:b.csv as string,mapping,matchDomains:b.matchDomains===true}
}

export function attributeValue(raw:string,definition:Definition):unknown{
 if(raw==='')return null
 let value:unknown=raw
 if(definition.type==='number')value=Number(raw)
 if(definition.type==='checkbox'){if(/^(true|1|yes)$/i.test(raw))value=true;else if(/^(false|0|no)$/i.test(raw))value=false}
 return validateAttribute(definition,value)
}
