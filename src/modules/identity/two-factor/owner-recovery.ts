import {Hono} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {recoveryAuthority} from '../recovery-authority/routes'
/** Recovery has its own short-lived capability; no native session until the
 * replacement factor and every current authority predicate commit together. */
export const ownerRecovery=new Hono<AppEnv>()
ownerRecovery.route('/owner-recovery',recoveryAuthority)
