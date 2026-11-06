import type {Env} from '../../../platform/env'
import {mailbox} from '../inbound-routing'

/** The reader's seven inputs. It is off (null) unless the bucket, the SES prefix, the mailbox, the region and both
 * halves of the read-only key are set; the replay prefix is optional. A value that fails its shape also turns the
 * reader off, so a typo never widens what it reads. */
export interface LegacyMailS3Config {
 bucket:string
 /** Written by SES alone, so SES's own verdict headers under it count. Ends with `/`. */
 sesPrefix:string
 /** Written by operators. Nothing under it is ever authenticated. Ends with `/`, or null. */
 replayPrefix:string|null
 mailbox:string
 region:string
 accessKeyId:string
 secretAccessKey:string
}
const BUCKET=/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION=/^[a-z]{2}(?:-[a-z]+)+-\d$/
/** Prefix keys never start with `/`, end with `/` and hold no dot segment, so a key under one cannot leave it. */
const prefixOk=(value:string)=>value.length<=512&&value.endsWith('/')&&!value.startsWith('/')&&!/[\u0000-\u001f\u007f]/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..')
const text=(env:Env,name:string)=>typeof env[name]==='string'?(env[name] as string).trim():''

export function legacyMailS3Config(env:Env):LegacyMailS3Config|null{
 const bucket=text(env,'LEGACY_MAIL_S3_BUCKET'),sesPrefix=text(env,'LEGACY_MAIL_S3_PREFIX'),replay=text(env,'LEGACY_MAIL_S3_REPLAY_PREFIX'),region=text(env,'LEGACY_AWS_REGION')
 const accessKeyId=text(env,'LEGACY_AWS_ACCESS_KEY_ID'),secretAccessKey=text(env,'LEGACY_AWS_SECRET_ACCESS_KEY'),address=mailbox(text(env,'LEGACY_MAIL_S3_MAILBOX'))
 if(!bucket||!sesPrefix||!region||!accessKeyId||!secretAccessKey||!address)return null
 if(!BUCKET.test(bucket)||!REGION.test(region)||!prefixOk(sesPrefix))return null
 if(replay&&(!prefixOk(replay)||replay.startsWith(sesPrefix)||sesPrefix.startsWith(replay)))return null
 return {bucket,sesPrefix,replayPrefix:replay||null,mailbox:address,region,accessKeyId,secretAccessKey}
}
/** The source of a key: the prefix it sits under. SES's prefix wins only for keys that are really under it. */
export function sourceOf(config:LegacyMailS3Config,key:string):'ses'|'replay'|null{
 if(key.startsWith(config.sesPrefix))return 'ses'
 if(config.replayPrefix&&key.startsWith(config.replayPrefix))return 'replay'
 return null
}
