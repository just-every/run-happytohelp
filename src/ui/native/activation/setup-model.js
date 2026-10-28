// Turns the activation snapshot into what the Setup list shows. Pure: no requests, no wording decided by the server.
// Open = steps the server places in `needs_you`, less the AI service once a key is installed, unless the provider
// rejected the key or refused to let us check it (see modelKeyState). An open step is Needs you, or Optional: the AI
// service while it has no key, and the widget until the owner gives a website of their own. Skipped = the same steps
// once the owner chose to leave them for now (placement `skipped`); an observation always wins, so a skipped step later
// seen is just a row; What we've set = every other visible step plus the facts that have no observation of their own
// (workspace, colour, starter assistant). Every row says what is true of its state: installed is not confirmed, off is
// not waiting.
export const needOrder = ['widget_seen', 'model_key', 'sender_dns'];

// The settings page each row's Change link opens, and how that page is named in the link's accessible label.
export const pages = {
 workspace: ['settings', 'Settings'], widget: ['widget-settings', 'Widget settings'], email: ['email-settings', 'Email settings'],
 ai: ['ais', 'AI settings'],
};
const rowPage = {workspace: 'workspace', widget_origin: 'widget', colour: 'widget', widget_seen: 'widget', owner_mail: 'email', inbound_address: 'email', sender_dns: 'email', spend_ceilings: 'ai', starter_assistant: 'ai', model_key: 'ai'};
const rowOrder = ['workspace', 'widget_origin', 'colour', 'widget_seen', 'owner_mail', 'sender_dns', 'inbound_address', 'model_key', 'spend_ceilings', 'starter_assistant'];
export const rowLabels = {
 workspace: 'Workspace', widget_origin: 'Website', colour: 'Colour', widget_seen: 'Widget', owner_mail: 'Email to you', sender_dns: 'Sending address',
 inbound_address: 'Replies by email', model_key: 'AI service', spend_ceilings: 'AI limits', starter_assistant: 'Starter assistant',
};
const stateLabels = {confirmed: 'Confirmed', set: 'Set', waiting: 'Waiting', checking: 'Checking', unknown: 'Unknown', off: 'Off', unchecked: 'Not checked', problem: 'Problem', unavailable: 'Not available'};

const step = (data, id) => data.steps.find(item => item.id === id);
// `CONFIGURATION_REQUIRED: NAME and NAME. ...` is how an observation names what the installation lacks (never values).
const requiredNames = detail => (String(detail || '').match(/^CONFIGURATION_REQUIRED:\s*([^.]*)\./) || [])[1] || '';
export const hostOf = value => { try { return new URL(value).host; } catch { return String(value || ''); } };
export const utc = iso => {
 const date = new Date(iso);
 if (Number.isNaN(date.getTime())) return '';
 const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
 return date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) ? time : `${date.getUTCDate()} ${date.toLocaleString('en-GB', {month: 'short', timeZone: 'UTC'})}, ${time}`;
};

const sentence = text => /[.!?]$/.test(text) ? text : `${text}.`;

/** The last time the server looked at anything: the snapshot's own time, else the newest step observation. */
export function lastLooked(data) {
 const times = [data.checkedAt, ...data.steps.map(item => item.checkedAt)].filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite);
 return times.length ? new Date(Math.max(...times)).toISOString() : '';
}

/** How the AI service stands, from what is installed and what the last observation said:
 *  confirmed (the provider vouched for the key), problem (the provider rejected it), missing (no key for the starter
 *  assistant's provider: the owner must add one), blocked (the provider can check keys but refused this one the
 *  read it needs, such as HTTP 403: the owner can grant it), unchecked (the key's provider has no automatic check,
 *  `facts.ai.checkable`, so it is installed but never confirmed), unassigned (a key is installed, but no enabled default
 *  assistant uses it), unknown (a check ran, or its result expired, without an answer; the next automatic check tries
 *  again) or checking (a key is installed and its check has not run yet or is running now). `missing`, `problem` and
 *  `blocked` need the owner. */
export function modelKeyState(data) {
 const own = step(data, 'model_key'), ai = data.facts?.ai;
 if (!own) return 'missing';
 if (own.state === 'done') return 'confirmed';
 if (own.state === 'failed') return 'problem';
 if (!ai?.keyInstalled) return 'missing';
 if (own.state === 'pending') return 'unassigned';
 if (own.state === 'unavailable' && (/^CONFIGURATION_REQUIRED:/.test(own.detail || '') || !ai.secretName)) return 'missing';
 // The server leaves a step out of the count only when its provider's key is installed and can never be confirmed.
 if (!ai.checkable && !own.applicable) return 'unchecked';
 if (own.state === 'unavailable') return 'blocked';
 return own.state === 'unknown' ? 'unknown' : 'checking';
}

/** `waiting|checking|problem|review` plus the words shown beside it, for one needs-you step. */
export function needStatus(data, item) {
 const {id, state, detail} = item, facts = data.facts || {};
 if (state === 'failed') return {status: 'problem', text: detail};
 if (state === 'checking') return {status: 'checking', text: 'Checking now'};
 if (id === 'model_key') return modelKeyState(data) === 'blocked' ? {status: 'waiting', text: sentence(detail)} : {status: 'waiting', text: facts.ai?.keyInstalled && facts.ai.secretName ? `Waiting for ${facts.ai.secretName}` : 'Waiting for a key'};
 if (id === 'widget_seen') return {status: 'waiting', text: 'Waiting for the first visit. We’ll spot it.'};
 if (id === 'sender_dns') return state === 'unavailable' ? {status: 'waiting', text: 'Waiting for an email key'} : (facts.senderRecords || []).length ? {status: 'waiting', text: 'Waiting for DNS records'} : {status: 'waiting', text: 'Waiting for the sending domain'};
 return {status: 'waiting', text: 'Waiting'};
}

// A step is the owner's to do (now or once they get to it) unless it is already a row. The AI service stops being the
// owner's once a key is installed and nothing is wrong with it.
const ownerStep = (data, item) => item.id !== 'model_key' || ['missing', 'problem', 'blocked'].includes(modelKeyState(data));
const asksOwner = (data, item) => item.placement === 'needs_you' && ownerStep(data, item);
const leftForNow = (data, item) => item.placement === 'skipped' && ownerStep(data, item);
const inNeedOrder = (a, b) => needOrder.indexOf(a.id) - needOrder.indexOf(b.id);
/** Whether the widget answers on a website of the owner's own, rather than nowhere yet or only on this app's address. */
const siteGiven = data => Boolean(data.facts?.website) && hostOf(data.facts.website) !== hostOf(data.facts?.widget?.apiOrigin);
// AI is optional, so the AI service waits under Optional while it has no key (a rejected or refused key is a problem,
// which needs the owner); so does the widget, until there is a website of the owner's own to put it on.
const optionalStep = (data, item) => item.id === 'model_key' ? modelKeyState(data) === 'missing' : item.id === 'widget_seen' && !siteGiven(data);
/** Every step still open to the owner, needed or optional, in need order: the heading stays at "Nearly ready" while any is. */
export const open = data => data.steps.filter(item => asksOwner(data, item)).sort(inNeedOrder);
export const needs = data => open(data).filter(item => !optionalStep(data, item));
/** What the owner can do whenever they want: shown apart from Needs you and never counted as needing them. */
export const optional = data => open(data).filter(item => optionalStep(data, item));
/** What the owner chose to leave for now, in need order. Never counted and never shown as confirmed. */
export const skipped = data => data.steps.filter(item => leftForNow(data, item)).sort(inNeedOrder);
/** A local trial whose widget and AI key are both still open, with no key yet: one action leaves both for now. */
export const localTrial = data => data.environment === 'local' && modelKeyState(data) === 'missing' && ['widget_seen', 'model_key'].every(id => open(data).some(item => item.id === id));

function ceilingsValue(data) {
 const limits = data.facts?.ceilings;
 if (limits && limits.spendUsdPerProject != null && limits.repliesPerProject != null) {
  return `Up to $${limits.spendUsdPerProject} and ${limits.repliesPerProject} AI replies a day for this workspace${limits.repliesPerInstallation != null ? `, ${Number(limits.repliesPerInstallation).toLocaleString('en-US')} across the installation` : ''}. Resets at 00:00 UTC.`;
 }
 return null;
}

function rowFor(data, id) {
 const facts = data.facts || {}, local = data.environment === 'local', own = step(data, id);
 const observed = own?.state === 'done', problem = own?.state === 'failed';
 const base = {id, label: rowLabels[id], change: pages[rowPage[id]], state: 'set', value: ''};
 const withObservation = (fallback, value) => ({...base, value, state: observed ? 'confirmed' : problem ? 'problem' : own?.state === 'unavailable' ? 'unavailable' : own?.state === 'pending' || own?.state === 'checking' || own?.state === 'unknown' ? 'waiting' : fallback});
 switch (id) {
  case 'workspace': return facts.workspaceName ? {...base, value: facts.workspaceNamed === false ? `${facts.workspaceName}. We chose this name; change it to your business name, which your help centre and emails show.` : facts.workspaceName} : null;
  case 'colour': return facts.colour?.hex ? {...base, value: facts.colour.source === 'site' ? `Picked from ${hostOf(facts.website)}` : 'Your workspace colour', swatch: facts.colour.hex} : null;
  case 'starter_assistant': return facts.starterAssistant ? {...base, value: `${facts.starterAssistant.name}. ${['confirmed', 'unchecked', 'checking', 'unknown', 'blocked'].includes(modelKeyState(data)) ? 'Answers visitors by itself, within your daily limits.' : 'Answers visitors by itself once AI is connected, within your daily limits.'}`} : null;
  case 'widget_origin': {
   // A first deploy sets the website to the app's own address, which is right only for a test: say so, as the widget need does.
   const app = hostOf(facts.widget?.apiOrigin), testing = Boolean(facts.website) && hostOf(facts.website) === app;
   return {...withObservation('set', !facts.website ? sentence(own?.detail || '') : testing ? `${facts.website}. This is HappyToHelp’s own address, so the widget answers only here, which suits a test. Enter your website’s address to use it there.` : `${facts.website}. Your widget works only here.`), change: [...pages.widget, 'settings']};
  }
  case 'owner_mail': {
   if(facts.mail?.managed&&!observed)return {...base,state:facts.mail.managed.error?'problem':'set',value:facts.mail.managed.error|| (facts.mail.managed.lastOutboundAcceptanceAt?'The provider accepted an email for you. Use an emailed sign-in link to confirm it arrived.':'Your assigned address sends account and support email once Run Edit Run activates it.')};
   if (facts.mail?.mode === 'unavailable') {
    const names = own?.state === 'unavailable' ? requiredNames(own.detail) : '';
    return {...base, state: 'unavailable', value: `Email isn’t configured, so we can’t email you.${names ? ` It needs ${names}.` : ''}`};
   }
   return withObservation('set', facts.mail?.mode === 'local' ? 'Email is suppressed during local development. No email is sent.' : observed ? `${/delivered/i.test(own.receiptRef || '') ? 'Delivered' : 'Received'}. ${own.checkedAt ? `Confirmed ${utc(own.checkedAt)}.` : ''}`.trim() : 'Not confirmed yet. Signing in with an emailed link, or the test on the Email page, confirms it.');
  }
  case 'inbound_address': {
   if(facts.mail?.managed){const m=facts.mail.managed;return {...base,state:m.error?'problem':m.observed?'confirmed':'set',value:`${m.address||'Your managed address'}. ${m.error|| (m.observed?'Email has arrived here.':m.routeActive?'Route active; waiting for the first email.':'Run Edit Run is activating the route. No email setup is needed.')}`};}
   // Replies by email: customers answer an emailed reply by pressing Reply. Each reason says what is true and where to act.
   const mailbox = facts.inboundAddress, lead = mailbox ? `${mailbox}. ` : '', reason = facts.inbound?.receiving;
   if (reason === 'workers_dev' || facts.inbound?.customDomainRequired) return {...base, state: 'unavailable', value: `${lead}This address can’t receive email: workers.dev addresses have no mail server. Customers answer in the chat for now. To let them reply by email, use an address on your own domain; the Email page shows how.`};
   if (own && own.applicable === false) return {...base, state: 'unavailable', value: `${lead}${local ? 'Email can’t be received on a local trial. It works once you deploy with your own domain.' : 'Replies by email are not available with this mail provider.'}`};
   if (facts.inbound && !facts.inbound.gateway) return {...base, state: 'unavailable', value: `${lead}This installation has no inbound token, so it can’t receive email. Run rer setup in your checkout, then deploy again.`};
   if (!mailbox) return {...base, state: 'unavailable', value: 'Customers answer your emails in the chat for now. To let them reply by email, set a receiving address on the Email page.'};
   if (facts.inbound && !facts.inbound.enabled) return {...base, state: 'off', value: `${lead}Conversation email is off. Turn it on in Email settings.`};
   if (reason === 'no_mx' && !observed) return {...base, state: 'waiting', value: `${lead}Not receiving yet: its domain has no mail server (MX record). The Email page has the routing steps.`};
   return withObservation('set', `${lead}${observed ? 'Replies arrive here.' : 'Waiting for the first email. Send one to this address to confirm it arrives.'}`);
  }
  case 'spend_ceilings': return withObservation('set', ceilingsValue(data) || sentence(own?.detail || ''));
  case 'model_key': {
   const mode = modelKeyState(data);
   if (mode === 'unchecked') return {...base, state: 'unchecked', value: `${facts.ai.secretName} is installed. It can’t be checked automatically for this provider, so it stays unconfirmed.`};
   if (mode === 'unassigned') return {...base, state: 'waiting', value: sentence(own?.detail || '')};
   if (mode === 'unknown') return {...base, state: 'unknown', value: `A key is installed, but right now we can’t tell whether the provider accepts it. We’ll try again on our own.${own.detail ? ` ${sentence(own.detail)}` : ''}`};
   if (mode === 'checking') return {...base, state: 'checking', value: 'A key is installed. Checking it with the provider now.'};
   return withObservation('set', observed ? `Connected. ${facts.starterAssistant?.model ? `Your starter assistant uses ${facts.starterAssistant.model}.` : ''}`.trim() : sentence(own?.detail || ''));
  }
  case 'widget_seen': return withObservation('set', observed ? `Seen on ${hostOf(facts.website)}${own.checkedAt ? `, ${utc(own.checkedAt)}` : ''}.` : sentence(own?.detail || ''));
  case 'sender_dns': if(facts.mail?.managed)return {...base,state:facts.mail.managed.configured?'set':'waiting',value:facts.mail.managed.address?`${facts.mail.managed.address}. Provided by Run Edit Run.`:'Run Edit Run is assigning your email address.'};return withObservation('set', observed ? 'Your sending address is verified.' : own?.state === 'unavailable' ? 'Cannot be checked automatically for this provider.' : sentence(own?.detail || ''));
  default: return null;
 }
}

/** Rows under "What we've set", in reading order: the facts, then any need that has been resolved. */
export function setRows(data) {
 const visible = new Set(data.steps.filter(item => item.placement === 'set' || (['needs_you', 'skipped'].includes(item.placement) && !ownerStep(data, item))).map(item => item.id));
 return rowOrder.filter(id => ['workspace', 'colour', 'starter_assistant'].includes(id) || visible.has(id)).map(id => rowFor(data, id)).filter(Boolean).map(row => ({...row, stateLabel: stateLabels[row.state]}));
}
