import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {invalid} from '@runeditrun/rer/errors';

/** A custom public address changes application links, never resource identity. */
export async function hostedDeclaration(root,declaration,value,mailProvider){
 const hasOrigin=value!==undefined&&value!=='';
 if(!hasOrigin&&mailProvider!=='rer')return null;
 const custom=structuredClone(declaration);
 if(hasOrigin){
  let url;
  try{url=new URL(value);}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||url.port||url.origin!==value)
   throw invalid('H2H_PUBLIC_ORIGIN must be an exact HTTPS origin, without credentials, path, query or fragment.');
  custom.vars={...custom.vars,[custom.originVar||'APP_ORIGIN']:url.origin};
  delete custom.originVar;
 }
 // Native deployments retain EMAIL_* aliases; assigned managed mail uses its
 // own provider and sender inputs in the declaration the owner kit uploads.
 if(mailProvider==='rer')for(const secret of custom.secrets??[])if(['MAIL_PROVIDER','MAIL_FROM','MAIL_API_KEY'].includes(secret.binding))secret.environment=secret.binding;
 const path='.rer/hosted-deploy.json';
 await mkdir(join(root,'.rer'),{recursive:true,mode:0o700});
 await writeFile(join(root,path),JSON.stringify(custom,null,2)+'\n',{mode:0o600});
 return path;
}
