/** How long a proven factor counts as a recent step-up for sensitive actions. */
export const STEP_UP_MS=15*60*1000
export type FactorMethod='password'|'email_link'|'totp'|'webauthn'|'recovery'|'installation'|'sso'
export const SECOND_FACTORS:FactorMethod[]=['totp','webauthn','recovery','installation']
export const POLICY_ROLES=['owner','admin','operator','collaborator'] as const

export function sessionFactorStatement(db:D1Database,tokenHash:string,userId:string,method:FactorMethod,now=Date.now()){
 return db.prepare('INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET method=excluded.method,verified_at=excluded.verified_at').bind(tokenHash,userId,method,now)
}

/** The roles a workspace's two-factor policy covers, from its settings. */
export function policyRoles(value:unknown):string[]{
 let roles=value
 if(typeof roles==='string'){try{roles=JSON.parse(roles)}catch{return []}}
 return Array.isArray(roles)?roles.filter((role):role is string=>(POLICY_ROLES as readonly string[]).includes(role)):[]
}

export interface FactorState {factorAt:number|null;factorMethod:FactorMethod|null;hasFactor:boolean;required:boolean;installation:boolean}
/** 'verify': the account has a factor this session has not proven. 'enrol': the workspace requires one the account lacks. */
export function pendingFactor(state:FactorState):'verify'|'enrol'|null{
 if(state.installation||state.factorMethod==='sso')return null
 if(state.hasFactor)return state.factorMethod&&SECOND_FACTORS.includes(state.factorMethod)?null:'verify'
 return state.required?'enrol':null
}
export function recentStepUp(state:FactorState,now=Date.now()){
 if(state.installation)return true
 if(!state.factorAt||now-state.factorAt>STEP_UP_MS)return false
 return state.hasFactor?SECOND_FACTORS.includes(state.factorMethod!):true
}

/** Mailbox proof can replace an unknown password, but can never replace an enrolled second factor. */
export const recentMailboxProof=(state:FactorState)=>state.factorMethod==='email_link'&&recentStepUp(state)
