// The server answers 503 when its database is briefly busy: that is a wait, never a failure. Views keep what
// they show, say they are busy (role="status") and read again after Retry-After, at most this long.
const BUSY_RETRY_CAP_SECONDS = 10;
const BUSY_RETRY_DEFAULT_SECONDS = 3;

export const isBusy = error => error?.status === 503;
export const busyWait = error => 1000 * Math.min(BUSY_RETRY_CAP_SECONDS, error?.retryAfter > 0 ? error.retryAfter : BUSY_RETRY_DEFAULT_SECONDS);
