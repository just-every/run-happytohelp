import {digestPattern} from './manifest'
import {refuse} from './errors'
export function requireSha(sha:string){if(!digestPattern.test(sha))refuse(400,'invalid_request','Invalid manifest fingerprint');return sha}
