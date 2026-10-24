import {defaultText} from './js/context/defaults.js';

// One lead-configured estimate for the notice, header and durable away reply.
export function humanResponseTime(text) {
  return String(text?.ai?.human_response || defaultText.ai.human_response);
}

// When an away team is back, in words: "today at 9:00 AM", "tomorrow at 9:00 AM" or "Monday at 9:00 AM".
// The widget says it in the visitor's own timezone; the away reply says it in the workspace's, with the zone named.
export function backAt(opensAt, {timeZone, now = Date.now(), locale = 'en-US', withZone = false} = {}) {
  if (!opensAt) return '';
  const zone = timeZone ? {timeZone} : {};
  const day = at => new Intl.DateTimeFormat('en-CA', {...zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(at);
  const time = new Intl.DateTimeFormat(locale, {...zone, hour: 'numeric', minute: '2-digit', ...(withZone ? {timeZoneName: 'short'} : {})}).format(opensAt);
  const days = Math.round((Date.parse(day(opensAt)) - Date.parse(day(now))) / 86400000);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? new Intl.DateTimeFormat(locale, {...zone, weekday: 'long'}).format(opensAt) : new Intl.DateTimeFormat(locale, {...zone, weekday: 'long', month: 'long', day: 'numeric'}).format(opensAt);
  return `${when} at ${time}`;
}
