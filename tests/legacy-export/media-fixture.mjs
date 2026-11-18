import {deflateSync} from 'node:zlib'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
const uuid=(group,n)=>`${group}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
/** A valid PNG assembled from generated pixels, with checked chunk CRCs. */
export function generatedPng(){
 const chunk=(type,bytes)=>{const name=Buffer.from(type),body=Buffer.concat([name,bytes]),header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(bytes.length);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,body,tail])}
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,53,146,159,255]))),chunk('IEND',Buffer.alloc(0))])
}
export async function seedPublicMedia(insert,connection,{projectId,n,ownerId,objectDirectory}){
 const bytes=generatedPng(),directory=projectId+'/synthetic-public',date='2026-11-17 00:00:00'
 await mkdir(join(objectDirectory,directory),{recursive:true})
 for(const [group,name,parentType,parent] of [['d3','logo','Project',projectId],['d4','public-diagram','Article',uuid('d5',n)]]){
  const id=uuid(group,n),url=`https://storage.happytohelp.com/${directory}/${name}.png`
  await writeFile(join(objectDirectory,directory,name+'.png'),bytes)
  await insert('media',{id,disk:'s3',directory,filename:name,filename_original:name+'.png',extension:'png',mime_type:'image/png',aggregate_type:'image',size:bytes.length,url,original_media_id:group==='d4'&&n===1?uuid('c4',n):null,variant_name:group==='d4'&&n===1?'synthetic-public-variant':null,created_at:date,updated_at:date})
  if(group==='d3')await connection.execute('UPDATE projects SET avatar_url=? WHERE id=?',[url,projectId])
  else await insert('articles',{id:parent,project_id:projectId,title:'Synthetic public image guide',slug:'synthetic-public-image-guide',summary:'A public article and its generated image.',content:`<p>Generated public help image.</p><img src="${url}" alt="Synthetic diagram">`,created_by_id:ownerId,published_at:date,created_at:date,updated_at:date})
  await insert('mediables',{media_id:id,mediable_type:'App\\Models\\'+parentType,mediable_id:parent,tag:'image',order:0})
 }
}
