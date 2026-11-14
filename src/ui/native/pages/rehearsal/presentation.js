export const DAY = 24 * 60 * 60 * 1000;
export function localInput(time) {
 const date = new Date(time);
 return new Date(time - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function when(value) {
 if (value === null || value === undefined || value === '') return 'Not recorded';
 if(typeof value === 'string') return value;
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
export function literal(value) {
 return value === null || value === undefined ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
export function refusal(error) {
 const code = error.data?.code || error.data?.error?.code || `http_${error.status || 'unavailable'}`;
 if (code === 'two_factor_setup_required') return {code, message:'Set up two-factor sign-in in Profile → Security, then return here to grant daily copy consent.'};
 if (error.status === 403 || error.status === 409) return {code, message:'Daily copy consent is unavailable for this account, workspace or current source state. Refresh the status before trying again.'};
 return {code, message:error.message || 'Daily copy status could not be read.'};
}
export const connectionKey = connection => `${connection.projectId}/${connection.pullId}`;
