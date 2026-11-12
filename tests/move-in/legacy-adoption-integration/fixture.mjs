import {writeLegacyPackage} from '../../helpers/legacy-package.mjs'
import {generateKeyPairSync,createHash} from 'node:crypto'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function packageFixture(root,projectId,{large=false,secret=false,invalidKey=false,staff=[],representative=false}={}){
 const {publicKey}=generateKeyPairSync('rsa',{modulusLength:1024});
 const der=publicKey.export({format:'der',type:'spki'}),dkim='k=rsa; p='+(invalidKey?der.subarray(0,der.length-1):der).toString('base64');
 const historical=Array.from({length:120},()=> 'A synthetic archive preserves the original customer account history across every import and verifies each relationship before any write.').join(' ')
 const object=Buffer.from('Synthetic attachment bytes for importer intake.\n'.repeat(large?10000:1));
 const key=`legacy/projects/${projectId}/media/synthetic-media`;
 const source={format:'happytohelp-legacy-v1',source:{repository:'just-every/run-happytohelp',revision:'synthetic-importer-r1',exportedAt:'2026-11-12T00:00:00Z',projectId,operatorNote:'synthetic-private-package-metadata'},tables:{
  projects:[{id:projectId,name:'Synthetic support workspace',website:'https://synthetic-history.example',created_at:1}],
  users:staff,
  project_users:staff.map((u,i)=>({id:'synthetic-membership-'+i,project_id:projectId,user_id:u.id,role:i===0?'owner':'admin'})),
  contacts:[{id:'synthetic-contact',project_id:projectId,name:'Synthetic customer',email:'synthetic-customer@example.test'},{id:'synthetic-peer-contact',project_id:projectId,name:'Retained peer',email:'synthetic-peer@example.test'}],
  conversations:[{id:'synthetic-conversation',project_id:projectId,contact_id:'synthetic-contact',subject:'Synthetic invoice question'},{id:'synthetic-peer-conversation',project_id:projectId,contact_id:'synthetic-peer-contact',subject:'Retained peer history'}],
  messages:[{id:'synthetic-message',agent_id:staff[0]?.id,project_id:projectId,conversation_id:'synthetic-conversation',content:secret?'Synthetic credential test: sk_test_'+'SYNTHETIC1234567890'.repeat(2):`Synthetic public DNS record ${dkim}. ${historical}`},{id:'synthetic-peer-message',project_id:projectId,conversation_id:'synthetic-peer-conversation',contact_id:'synthetic-peer-contact',content:'Retained peer message'}],
  ...(staff.length?{events:[{id:'synthetic-wire-note',conversation_id:'synthetic-conversation',agent_id:staff[0].id,type:'INTERNAL_NOTE',payload:'Historical private note retained in its original voice.',created_at:1}],macros:[{id:'synthetic-wire-macro',project_id:projectId,title:'Historical reply',content:'Historical saved answer',created_by_id:staff[0].id,created_at:1}]}:{}),
  ai_usages:[{id:'synthetic-usage',project_id:projectId,usage:{prompt_tokens:3,completion_tokens:2}}],
  media:[{id:'synthetic-media',message_id:'synthetic-message',project_id:projectId,object_key:key,filename:'synthetic.txt'},{id:'synthetic-peer-media',message_id:'synthetic-peer-message',project_id:projectId,object_key:`legacy/projects/${projectId}/media/synthetic-peer-media`,filename:'synthetic-peer.txt'}],
 },objects:[{key,dataBase64:object.toString('base64'),sha256:sha(object)},{key:`legacy/projects/${projectId}/media/synthetic-peer-media`,dataBase64:Buffer.from('Synthetic retained peer bytes').toString('base64'),sha256:sha('Synthetic retained peer bytes')}]};
 if(representative){for(let i=0;i<34;i++)source.tables.contacts.push({id:`synthetic-extra-contact-${i}`,project_id:projectId,name:`Synthetic history ${i}`,email:`synthetic-${i}@example.test`,created_at:i+1});for(let i=0;i<64;i++)source.tables.messages.push({id:`synthetic-extra-message-${i}`,project_id:projectId,conversation_id:'synthetic-conversation',agent_id:staff[0]?.id,content:`Synthetic retained history ${i}`,local_id:`synthetic-delivery-${i}`,created_at:i+1})}
 const built=await writeLegacyPackage(root,source,{rowsPerChunk:representative?30:2});
 return {...built,root,bytes:await readFile(join(root,'manifest.json'))};
}
export async function modifiedPackage(root,manifest,files={}){await mkdir(root,{recursive:true});for(const [file,bytes]of Object.entries(files))await writeFile(join(root,file),bytes);const bytes=Buffer.from(JSON.stringify(manifest));await writeFile(join(root,'manifest.json'),bytes);return {root,manifest,bytes,manifestSha256:sha(bytes)}}
