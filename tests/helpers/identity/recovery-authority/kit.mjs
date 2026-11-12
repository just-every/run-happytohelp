import assert from 'node:assert/strict'
import {createHash,createHmac,randomBytes} from 'node:crypto'
import {totp,encryptionKey} from '../two-factor.mjs'
import {startApp} from '../../../journeys/kit/app.mjs'
export const root='/api/identity/owner-recovery'
export const random=()=>randomBytes(32).toString('base64url')
export const digest=secret=>createHash('sha256').update(Buffer.from(secret,'base64url')).digest('base64url')
export const key=randomBytes(32).toString('hex')
export const installation='d6f96c8b-83a5-4edb-b1ba-cb5e34ffb072'
export const bindings={H2H_OWNER_RECOVERY_KEY:key,H2H_OWNER_RECOVERY_GENERATION:'1',H2H_OWNER_RECOVERY_ENABLED:'true',RER_INSTALLATION_ID:installation,RER_MANAGEMENT_ORIGIN:'https://platform.example',APP_ORIGIN:'https://app.example',H2H_SETUP_TOKEN:'synthetic-setup-recovery',INTEGRATION_ENCRYPTION_KEY:encryptionKey(),EMAIL_PROVIDER:'off'}
export const password='correct-horse-battery-owner'
export async function fresh(extra={}){const app=await startApp({bindings:{...bindings,...extra}});const owner=await app.ok('/api/identity/bootstrap',{body:{email:'owner@example.test',password,name:'Lantern support',allowedOrigin:'https://lantern.example',setupToken:bindings.H2H_SETUP_TOKEN}});return {app,owner}}
export function envelope(payload,signKey=key){const text=JSON.stringify(Object.fromEntries(Object.keys(payload).sort().map(k=>[k,payload[k]])));return {alg:'HS256',payload:Buffer.from(text).toString('base64url'),signature:createHmac('sha256',Buffer.from(signKey,'hex')).update('h2h-owner-recovery-v1\n'+text).digest('base64url')}}
export function custody(op='bind',generation=1,overrides={}){const now=Math.floor(Date.now()/1000);return envelope({v:1,type:'custody-request',iss:'https://platform.example',aud:'https://app.example'+root+'/custody',installation_id:installation,app_id:'happytohelp',environment:'production',op,generation,nonce:random(),iat:now,exp:now+120,...overrides})}
export async function bind(app){return app.ok(root+'/custody',{body:custody()})}
export const capabilityHeaders=capability=>({'X-Recovery-Capability':capability,Origin:'https://app.example'})
export async function challenge(app){const secret=random();const result=await app.ok(root+'/challenge',{body:{nonce:digest(secret)}});return {...result,capability:secret}}
export async function authorize(app,request,overrides={}){const payload=JSON.parse(Buffer.from(request.challenge.payload,'base64url'));return app.call(root+'/authorize',{body:envelope({...payload,type:'platform-authorization',iss:'https://platform.example',aud:'https://app.example'+root+'/authorize',platform_proof_id:random(),...overrides})})}
export async function enrol(app,request,passwordValue){const options=await app.ok(root+'/enrol/totp',{body:{},headers:capabilityHeaders(request.capability)});return {options,result:await app.call(root+'/complete',{body:{factorId:options.factorId,code:totp(options.secret),...(passwordValue?{password:passwordValue}:{})},headers:capabilityHeaders(request.capability)})}}
export async function factor(app,token){const options=await app.ok('/api/identity/two-factor/totp',{body:{},token});const result=await app.ok('/api/identity/two-factor/totp/confirm',{body:{factorId:options.factorId,code:totp(options.secret)},token});return {...options,...result}}
export async function signIn(app,email,passwordValue=password){return app.call('/api/identity/signin',{body:{email,password:passwordValue}})}
export function session(result){return result.headers.get('set-cookie')?.match(/h2h_session=([^;]+)/)?.[1]}
export async function assertNoSession(app,request){assert.equal((await app.call('/api/identity/session',{headers:capabilityHeaders(request.capability)})).status,401)}
