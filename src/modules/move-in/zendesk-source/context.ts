import type {Env} from '../../../platform/env'
import type {Phase,PullRow,PullState} from './pull-store'
/** One invocation's view of a pull: what it read, what it will commit, and whether more follows. */
export interface PullContext {
 env:Env;pull:PullRow;token:string
 cursor:Record<string,any>;counts:Record<string,any>;incremental:number[];resume:Record<string,any>
 statements:D1PreparedStatement[];phase:Phase;state:PullState;patch:Partial<PullRow>
 requests:number;more:boolean;nextAt?:number
}
/** Zendesk asked us to wait (Retry-After) or the incremental 10-a-minute window is
 * full. The pull persists next_at and is queued again with that delay; nothing sleeps. */
export class Deferred extends Error{readonly waitMs:number;constructor(waitMs:number){super('deferred');this.waitMs=Math.max(1000,Math.ceil(waitMs))}}
