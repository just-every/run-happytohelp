import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readManifest} from '../package.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Download every attachment of the package from the installation's R2 and compare it
 * with the manifest's size and SHA-256, and with the original file under the company's
 * source-objects/ when the export kept it (hashed independently). Media ids only. */
export async function verifyAttachments(target,root,{skip=new Set()}={}){
  const {manifest}=await readManifest(root),originals=path.join(root,'..','source-objects'),withOriginals=existsSync(originals);
  let identical=0,bytes=0;const bad=[],objects=manifest.objects.filter(object=>!skip.has(String(object.mediaId)));
  const one=async object=>{
    const stored=await target.env.FILES.get(object.key);if(!stored){bad.push({mediaId:object.mediaId,missing:true});return;}
    const data=Buffer.from(await stored.arrayBuffer()),digest=sha(data),entry=manifest.source.attachments.find(e=>e.key===object.key);
    const original=withOriginals&&entry?.sourceKey?sha(await readFile(path.join(originals,entry.sourceKey))):null;
    if(data.length===object.size&&digest===object.sha256&&(!withOriginals||original===digest)){identical++;bytes+=data.length;}else bad.push({mediaId:object.mediaId,size:data.length,expectedSize:object.size});
  };
  for(let i=0;i<objects.length;i+=8){await Promise.all(objects.slice(i,i+8).map(one));await target.renew?.();}
  return {attachments:objects.length,comparedWith:withOriginals?'manifest sha256 and source-objects/':'manifest sha256',identical,bytes,mismatched:bad.length,bad:bad.slice(0,20)};
}
