import {missing} from '@runeditrun/rer/errors';
import {deploymentMailEnvironment,mailInputNames,outboundEmailOff} from '../deployment/environment.mjs';

// This hook sees proposed local inputs, never hosted secret readback. Cleanup
// and unrelated secret changes must remain possible with incomplete mail setup.
export function mailDeployPolicy({options,env,bindings,declaration}){
 if(options.remove||options.unsetSecret||options.reopenInstallationKey)return;
 const requested=String(options.setSecret||options.rotateSecret||'').split(',').filter(Boolean);
 const mailName=name=>mailInputNames.includes(name)||declaration.secrets?.some(item=>item.binding===name&&mailInputNames.includes(item.environment));
 if(requested.length&&!requested.some(mailName))return;
 const proposed={...env,...bindings};
 let normalized;
 try{normalized=deploymentMailEnvironment(proposed);}
 catch(error){
  // Normalization errors name inputs only. Unexpected failures keep their
  // original identity and are handled by rer's ordinary error boundary.
  if(error?.constructor!==Error)throw error;
  throw missing(`${error.message}. Nothing was built or uploaded.`);
 }
 if(requested.length&&(!proposed.MAIL_MODE&&!proposed.MAIL_PROVIDER||outboundEmailOff(normalized)))
  throw missing('Mail credentials are not bound while email is off. Save them privately, then explicitly choose MAIL_MODE=own and EMAIL_PROVIDER before deploying.');
}
