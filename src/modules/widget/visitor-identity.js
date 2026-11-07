/** Every widget session this page origin stores starts with this prefix. */
const SESSION_PREFIX = 'rer-widget:';

/**
 * The visitor the host page says is present: its `identifier` (trimmed, exact), else its
 * `email` (trimmed, any letter case), else null for an anonymous visitor. Only the page's
 * `contact` decides this, never details the visitor types into the widget.
 */
export function visitorIdentity(contact) {
  const identifier = contact?.identifier == null ? '' : String(contact.identifier).trim();
  if (identifier) return `id:${identifier}`;
  const email = typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';
  return email ? `email:${email}` : null;
}

export function sessionStorageKey(origin, widgetKey) {
  return `${SESSION_PREFIX}${origin}:${widgetKey}`;
}

/** Sign-out: forget every widget session this page origin stores, so the next load starts fresh. */
export function clearStoredSessions() {
  for (const key of Object.keys(localStorage)) if (key.startsWith(SESSION_PREFIX)) localStorage.removeItem(key);
}
