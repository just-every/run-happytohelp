import {managedMailDeclaration,publicMailNames} from '../deployment/mail-declaration.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {invalid} from '@runeditrun/rer/errors';

/** A custom public address changes application links, never resource identity. */
export async function hostedDeclaration(root,declaration,value,env){
 const hasOrigin=value!==undefined&&value!=='';
 const mail=Object.fromEntries(publicMailNames.filter(name=>typeof env[name]==='string').map(name=>[name,env[name]]));
 if(!hasOrigin&&env.MAIL_PROVIDER!=='rer'&&!Object.keys(mail).length)return null;
 const custom=env.MAIL_PROVIDER==='rer'?managedMailDeclaration(declaration):structuredClone(declaration);
 // Public inputs belong in vars; credentials keep the declaration's secret path.
 custom.vars={...custom.vars,...mail};
 if(hasOrigin){
  let url;
  try{url=new URL(value);}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||url.port||url.origin!==value)
   throw invalid('H2H_PUBLIC_ORIGIN must be an exact HTTPS origin, without credentials, path, query or fragment.');
  custom.vars={...custom.vars,[custom.originVar||'APP_ORIGIN']:url.origin};
  delete custom.originVar;
 }
 const path='.rer/hosted-deploy.json';
 await mkdir(join(root,'.rer'),{recursive:true,mode:0o700});
 await writeFile(join(root,path),JSON.stringify(custom,null,2)+'\n',{mode:0o600});
 return path;
}
