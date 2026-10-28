import {managedMailDeclaration} from '../deployment/mail-declaration.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {invalid} from '@runeditrun/rer/errors';

/** A custom public address changes application links, never resource identity. */
export async function hostedDeclaration(root,declaration,value,mailProvider){
 const hasOrigin=value!==undefined&&value!=='';
 if(!hasOrigin&&mailProvider!=='rer')return null;
 const custom=mailProvider==='rer'?managedMailDeclaration(declaration):structuredClone(declaration);
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
