export const MAILGUN_MAX_FUTURE_MS=5*60*1000
export const MAILGUN_MAX_AGE_MS=9*60*60*1000
/** A claim is needed only while a signed timestamp can still pass the freshness check. */
export const MAILGUN_CLAIM_RETENTION_MS=MAILGUN_MAX_FUTURE_MS+MAILGUN_MAX_AGE_MS+60*1000
