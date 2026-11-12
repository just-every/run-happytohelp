import {transportFetch} from '../../../dashboard/utils/busy';
import {nativeRequest} from '../../transport';
import {LEGACY_LIMITS} from '../../../../modules/legacy-import/worker-contract';
export const fingerprint=async file=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
export const packageBase=(projectId,sha)=>`/api/move-in/projects/${encodeURIComponent(projectId)}/legacy-import/${sha}`;
export function rememberPackage(sha){const url=new URL(window.location.href);url.searchParams.set('legacyPackage',sha);url.searchParams.set('legacy','1');window.history.replaceState(window.history.state,'',url);}
export async function selectPackage(selected){
 const files=new Map();let root;
 for(const file of selected){const path=file.webkitRelativePath||file.name,parts=path.split('/');if(parts.length>2)throw Error('Choose a flat export folder; nested files are not supported.');if(parts.length===2){if(root&&root!==parts[0])throw Error('Choose one export folder.');root=parts[0];}const name=parts.at(-1);if(files.has(name))throw Error('Duplicate package filename.');files.set(name,file);}
 const manifestFile=files.get('manifest.json');if(!manifestFile)throw Error('Choose the export folder including manifest.json.');if(manifestFile.size>LEGACY_LIMITS.manifestBytes)throw Error('Manifest exceeds 2 MiB. Re-export a smaller package.');
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await manifestFile.arrayBuffer()));}catch{throw Error('Manifest must contain valid UTF-8 JSON.');}
 if(manifest?.format!=='happytohelp-legacy-chunks-v1'||!Array.isArray(manifest.chunks)||!Array.isArray(manifest.context)||!Array.isArray(manifest.objects)||!manifest.source?.projectId||!manifest.source?.rowCounts||manifest.attachmentsComplete!==true)throw Error('Choose a complete chunked HappyToHelp export.');
 const descriptors=[...manifest.chunks.map(p=>({...p,kind:'chunk'})),...manifest.context.map(p=>({...p,kind:'context'})),...manifest.objects.map(p=>({...p,bytes:p.size,kind:'object'}))];
 if(descriptors.length>LEGACY_LIMITS.descriptors)throw Error('Package has too many files. Re-export a smaller package.');
 const names=new Set(['manifest.json']);for(const p of descriptors){if(typeof p.file!=='string'||!(p.kind==='chunk'?/^rows-\d{6}\.json$/:p.kind==='context'?/^context-\d{6}\.json$/:/^object-\d{6}\.bin$/).test(p.file)||names.has(p.file))throw Error('Invalid or duplicate package filename.');names.add(p.file);if(!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>(p.kind==='object'?LEGACY_LIMITS.objectBytes:LEGACY_LIMITS.partBytes))throw Error(`File exceeds the upload limit: ${p.file}`);}
 for(const name of files.keys())if(!names.has(name))throw Error('The selected folder contains an unlisted file. Choose only the original export files.');
 return {manifest,manifestFile,files,descriptors,sha:await fingerprint(manifestFile)};
}
export async function scanPackage(base,signal){
 let cursor=null,summary,missing=[],presentFiles=0,presentBytes=0;
 do{const response=await nativeRequest(`${base}/status?excludeTables=ai_usages${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal});summary=response.data;missing.push(...summary.missing);presentFiles+=summary.page.presentFiles;presentBytes+=summary.page.presentBytes;cursor=summary.nextCursor;}while(cursor);
 return {...summary,missing,presentFiles,presentBytes};
}
export async function uploadFile(base,part,file,signal){
 if(file.size!==part.bytes)throw Error(`File size differs from manifest: ${part.file}`);
 if(await fingerprint(file)!==part.sha256)throw Error(`File fingerprint differs from manifest: ${part.file}`);
 return nativeRequest(`${base}/files/${encodeURIComponent(part.file)}?excludeTables=ai_usages`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file,signal});
}

// Runner routes may not be installed on an intake-only edition. Preserve their
// actual HTTP status even when the router returns a non-JSON 404 document.
export async function runnerRequest(path,init={}){
 const response=await transportFetch(path,{credentials:'same-origin',...init});
 let value;try{value=await response.json()}catch{throw Object.assign(new Error('Import runner response unavailable'),{status:response.status})}
 if(!response.ok)throw Object.assign(new Error(typeof value.error==='string'?value.error:'Import request refused'),{status:response.status,data:value});
 if(!value?.data?.runId&&!value?.data?.run)throw Object.assign(new Error('Import result pending'),{status:503});
 return value;
}
