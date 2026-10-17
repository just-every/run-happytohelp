import moment from 'moment-timezone';
// Enumerate actual offsets so missing and repeated DST wall times are explicit.
export function dueChoices(local, timezone) {
    if (!local || !moment.tz.zone(timezone)) return [];
    const wall = moment.utc(local, 'YYYY-MM-DDTHH:mm', true);
    if (!wall.isValid()) return [];
    return [...new Set(moment.tz.zone(timezone).offsets)].map(offset => wall.valueOf() + offset * 60000)
        .filter(value => moment.tz(value, timezone).format('YYYY-MM-DDTHH:mm') === local)
        .sort((a,b) => a-b).map(value => ({ value: String(value), label: moment.tz(value, timezone).format('YYYY-MM-DD HH:mm Z z'), iso: new Date(value).toISOString() }));
}
export const localDue = (due, zone) => due ? moment.tz(due, zone).format('YYYY-MM-DDTHH:mm') : '';
export const workflowTime = (value, zone) => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',...(zone?{timeZone:zone}:{})}).format(new Date(value)) : 'No deadline';
