import moment from 'moment';

/** Plain words for the API's values, and the one-line counts each source shows. */
export const sourceNames = { zendesk: 'Zendesk', legacy: 'Legacy HappyToHelp', email: 'Email route', widget: 'Website widget' };
export const stateLabels = { incumbent: 'With the old tool', seed: 'Switched here', retired: 'Old tool retired' };
export const checkLabels = { passed: 'Check passed', failed: 'Check failed', not_run: 'Not checked' };
export const sourceOptions = Object.entries(sourceNames).map(([value, label]) => ({ value, label }));
export const stateOptions = Object.entries(stateLabels).map(([value, label]) => ({ value, label }));
/** While the database is briefly busy (503) the page keeps what it shows and says it will read again by itself. */
export const busyNotice = 'The workspace is busy. Trying again in a few seconds…';
export const checkOptions = [{ value: 'passed', label: 'Passed' }, { value: 'failed', label: 'Failed' }, { value: 'not_run', label: 'Not run' }];

/** The time as the dashboard shows it elsewhere: the day and the minute, with the year only when it is not this one. */
export const timeFormat = iso => moment(iso).isSame(moment(), 'year') ? 'D MMM HH:mm' : 'D MMM YYYY HH:mm';
const count = (n, one, many) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

/** The pieces of a source's counts line: plain text, or text with a time the caller renders in the dashboard's time component. */
export function countsParts(source) {
    const { id, counts } = source;
    if (id === 'zendesk') {
        const { imported, lastPull } = counts;
        return imported || lastPull
            ? [`${count(imported, 'conversation', 'conversations')} imported`, lastPull && { text: 'Last pull', at: lastPull.at, after: `brought ${count(lastPull.tickets, 'ticket', 'tickets')}, ${count(lastPull.replies, 'reply', 'replies')}` }]
            : ['Nothing imported yet'];
    }
    if (id === 'legacy') {
        const { imported, lastSweep } = counts;
        return imported || lastSweep
            ? [`${count(imported, 'conversation', 'conversations')} imported`, lastSweep && { text: 'Last sweep', at: lastSweep.at }]
            : ['Nothing imported yet'];
    }
    const [one, many] = id === 'email' ? ['email', 'emails'] : ['conversation', 'conversations'];
    const { arrivals, since } = counts, lead = arrivals ? count(arrivals, one, many) : `No ${many}`;
    return [since ? { text: `${lead} since`, at: since } : `${lead} so far`];
}
