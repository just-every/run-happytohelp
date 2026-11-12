import {writeLegacyPackage} from '../../helpers/legacy-package.mjs'
import {generateKeyPairSync,createHash} from 'node:crypto'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function packageFixture(root,projectId,{large=false,secret=false,invalidKey=false}={}){
 const {publicKey}=generateKeyPairSync('rsa',{modulusLength:1024});
 const der=publicKey.export({format:'der',type:'spki'}),dkim='k=rsa; p='+(invalidKey?der.subarray(0,der.length-1):der).toString('base64');
 const object=Buffer.from('Synthetic attachment bytes for importer intake.\n'.repeat(large?10000:1));
 const key=`legacy/projects/${projectId}/media/synthetic-media`;
 const source={format:'happytohelp-legacy-v1',source:{repository:'just-every/run-happytohelp',revision:'synthetic-importer-r1',exportedAt:'2026-11-12T00:00:00Z',projectId},tables:{
  projects:[{id:projectId,name:'Synthetic support workspace'}],
  contacts:[{id:'synthetic-contact',project_id:projectId,name:'Synthetic customer',email:'synthetic-customer@example.test'}],
  conversations:[{id:'synthetic-conversation',project_id:projectId,contact_id:'synthetic-contact',subject:'Synthetic invoice question'}],
  messages:[{id:'synthetic-message',project_id:projectId,conversation_id:'synthetic-conversation',content:secret?'Synthetic credential test: sk_test_'+'SYNTHETIC1234567890'.repeat(2):`Synthetic public DNS record ${dkim}`}],
  ai_usages:[{id:'synthetic-usage',project_id:projectId,usage:{prompt_tokens:3,completion_tokens:2}}],
  media:[{id:'synthetic-media',project_id:projectId,object_key:key,filename:'synthetic.txt'}],
 },objects:[{key,dataBase64:object.toString('base64'),sha256:sha(object)}]};
 const built=await writeLegacyPackage(root,source);
 return {...built,root,bytes:await readFile(join(root,'manifest.json'))};
}
export async function modifiedPackage(root,manifest,files={}){await mkdir(root,{recursive:true});for(const [file,bytes]of Object.entries(files))await writeFile(join(root,file),bytes);const bytes=Buffer.from(JSON.stringify(manifest));await writeFile(join(root,'manifest.json'),bytes);return {root,manifest,bytes,manifestSha256:sha(bytes)}}
