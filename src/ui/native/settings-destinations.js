// The fifteen Settings destinations of a project workspace: the sidebar's one Settings row is current on every one of them
// and the Settings menu (SettingsMenu.jsx) lists them. `path` is relative to the project; `alias` is a second path that
// renders the same screen. Connected applications lives outside the project's path and carries the project in its search.
export const settingsDestinations = [
    { label: 'Project', path: 'edit', alias: 'settings' },
    { label: 'Agents', path: 'agents' },
    { label: 'Email', path: 'email-settings' },
    { label: 'Suspended email', path: 'suspended' },
    { label: 'Widget', path: 'widget-settings' },
    { label: 'Tickets', path: 'ticket-settings' },
    { label: 'Saved Replies', path: 'macros' },
    { label: 'API tokens', path: 'api-settings' },
    { label: 'Webhooks', path: 'webhook-settings' },
    { label: 'Slack', path: 'slack-settings' },
    { label: 'Delivery log', path: 'delivery-log' },
    { label: 'Plugins', path: 'plugins' },
    { label: 'GitHub', path: 'github-settings' },
    { label: 'Roles', path: 'roles' },
    { label: 'Security', path: 'security' },
    { label: 'Security log', path: 'security-log' },
    { label: 'Connected applications', absolute: '/delegation/settings' },
];

// The first five are always listed; the rest sit behind the menu's "More".
export const settingsMenuHeadCount = 6;

export const pathIsWithin = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

export const destinationActive = (pathname, base, destination) => destination.absolute
    ? pathIsWithin(pathname, destination.absolute)
    : [destination.path, destination.alias].some(path => path && pathIsWithin(pathname, `${base}/${path}`));

export const onSettingsDestination = (pathname, base) => settingsDestinations.some(destination => destinationActive(pathname, base, destination));
