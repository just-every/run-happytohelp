import {decodeCbor} from '../two-factor/cbor'
import {fromB64url,type RegistrationInput} from '../two-factor/webauthn'
import {refuse} from './common'
/** Recovery installs a new root factor: require authenticator user verification. */
export async function registrationVerified(credential:RegistrationInput){
 try{
  const decoded=decodeCbor(fromB64url(credential.response.attestationObject)).value
  const data=decoded instanceof Map?decoded.get('authData'):null
  if(!(data instanceof Uint8Array)||data.length<37||!(data[32]&0x04))refuse()
 }catch{refuse()}
}
