import type {Trust} from '../../vendor/agent-base/modules/agent-door/index.ts'
import type {Env} from '../../platform/env'

export function installationTrust(env:Env,origin:string):Trust|null{
 const values=[env.RER_OWNER_CLAIM_ISSUER,env.RER_OWNER_CLAIM_INSTALLATION_ID,env.RER_OWNER_CLAIM_APP_ORIGIN,env.RER_OWNER_CLAIM_PUBLIC_KEYS]
 if(values.every(value=>value===undefined||value===''))return null
 if(env.RER_MANAGEMENT_ORIGIN&&env.RER_MANAGEMENT_ORIGIN!==env.RER_OWNER_CLAIM_ISSUER)throw new Error('Owner-claim issuer differs from installation issuer')
 if(values.some(value=>typeof value!=='string'||!value)||env.RER_OWNER_CLAIM_APP_ORIGIN!==origin||env.RER_INSTALLATION_ID&&env.RER_INSTALLATION_ID!==env.RER_OWNER_CLAIM_INSTALLATION_ID)throw new Error('Incomplete or conflicting owner-claim trust')
 return {issuer:String(env.RER_OWNER_CLAIM_ISSUER),installationId:String(env.RER_OWNER_CLAIM_INSTALLATION_ID),appOrigin:origin,publicKeys:JSON.parse(String(env.RER_OWNER_CLAIM_PUBLIC_KEYS))}
}
