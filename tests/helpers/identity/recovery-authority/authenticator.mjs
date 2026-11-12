import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto'
const hash=value=>createHash('sha256').update(value).digest()
const head=(major,n)=>n<24?Buffer.from([(major<<5)|n]):n<256?Buffer.from([(major<<5)|24,n]):Buffer.from([(major<<5)|25,n>>8,n&255])
function cbor(value){
 if(value instanceof Map)return Buffer.concat([head(5,value.size),...[...value].flatMap(([key,item])=>[cbor(key),cbor(item)])])
 if(value instanceof Uint8Array)return Buffer.concat([head(2,value.length),value])
 if(typeof value==='string'){const bytes=Buffer.from(value);return Buffer.concat([head(3,bytes.length),bytes])}
 if(typeof value==='number')return value<0?head(1,-1-value):head(0,value)
 throw Error('Unsupported authenticator value')
}
/** An independent cryptographic client, with a real new private key. Nothing
 * substitutes for the application's registration/assertion verifier or writes. */
export function authenticator(origin){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=keys.publicKey.export({format:'jwk'}),id=randomBytes(32),rp=hash(new URL(origin).hostname)
 const client=(type,challenge)=>Buffer.from(JSON.stringify({type,challenge,origin}))
 return {
  registration(challenge){
   const count=Buffer.alloc(4),length=Buffer.alloc(2);length.writeUInt16BE(id.length)
   const cose=new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(publicKey.x,'base64url')],[-3,Buffer.from(publicKey.y,'base64url')]])
   const auth=Buffer.concat([rp,Buffer.from([0x45]),count,Buffer.alloc(16),length,id,cbor(cose)])
   return {id:id.toString('base64url'),type:'public-key',response:{clientDataJSON:client('webauthn.create',challenge).toString('base64url'),attestationObject:cbor(new Map([['fmt','none'],['authData',auth],['attStmt',new Map()]])).toString('base64url')}}
  },
  assertion(challenge){
   const count=Buffer.alloc(4);count.writeUInt32BE(1)
   const auth=Buffer.concat([rp,Buffer.from([0x05]),count]),data=client('webauthn.get',challenge)
   return {id:id.toString('base64url'),type:'public-key',response:{clientDataJSON:data.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:sign('sha256',Buffer.concat([auth,hash(data)]),keys.privateKey).toString('base64url')}}
  },
 }
}
