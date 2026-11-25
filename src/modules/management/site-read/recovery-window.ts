/** A read that has been `running` longer than this is not coming back; it is marked uncertain and never repeated. */
export const STALE_RUNNING_MS = 5 * 60_000
export const LOST_QUEUE_MS = 5 * 60_000
export const GIVE_UP_MS = 24 * 3_600_000

export const readStateSql = "json_extract(settings_json,'$.site_read.state')"
export const readAtSql = "json_extract(settings_json,'$.site_read.at')"
// Wake lost queued reads as soon as either queued recovery action can apply.
export const siteReadRecoveryDue = (now:string)=>`${readStateSql} IN ('queued','running') AND ${readAtSql}<${now}-${Math.min(STALE_RUNNING_MS,LOST_QUEUE_MS,GIVE_UP_MS)}`
