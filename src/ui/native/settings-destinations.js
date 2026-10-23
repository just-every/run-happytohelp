// Everything that configures a project workspace, grouped by topic. On any of these pages the rail becomes the Settings
// menu (SettingsNavigation.jsx) and the Settings row reads as the section. `path` is relative to the project; `alias`
// is a second path that renders the same screen and `within` are pages reached from this one (Move in from Project).
// Connected applications lives outside the project's path and carries the project in its search; Local computers'
// authorize page acts on the session's project without naming it.
export const settingsGroups = [
    { label: null, destinations: [
        { label: 'Setup', path: 'activation' },
    ] },
    { label: 'Workspace', destinations: [
        { label: 'Project', path: 'edit', alias: 'settings', within: ['move-in'] },
        { label: 'Widget', path: 'widget-settings' },
        { label: 'Email', path: 'email-settings' },
        { label: 'Suspended email', path: 'suspended' },
    ] },
    { label: 'Team', destinations: [
        { label: 'Agents', path: 'agents' },
        { label: 'Roles', path: 'roles' },
        { label: 'Security', path: 'security' },
        { label: 'Security log', path: 'security-log' },
    ] },
    { label: 'Support', destinations: [
        { label: 'Tickets', path: 'ticket-settings' },
        { label: 'Saved Replies', path: 'macros' },
    ] },
    { label: 'Automation', destinations: [
        { label: 'AI', path: 'ais' },
        { label: 'Workflows', path: 'workflow-settings' },
        { label: 'Local computers', path: 'local-agent', session: '/local-agent/authorize' },
    ] },
    { label: 'Connections', destinations: [
        { label: 'Business connections', path: 'business-settings' },
        { label: 'Slack', path: 'slack-settings' },
        { label: 'GitHub', path: 'github-settings' },
        { label: 'Webhooks', path: 'webhook-settings' },
        { label: 'API tokens', path: 'api-settings' },
        { label: 'Plugins', path: 'plugins' },
        { label: 'Connected applications', absolute: '/delegation/settings' },
        { label: 'Delivery log', path: 'delivery-log' },
    ] },
];

export const settingsDestinations = settingsGroups.flatMap(group => group.destinations);

export const pathIsWithin = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

export const destinationActive = (pathname, base, destination) => destination.absolute
    ? pathIsWithin(pathname, destination.absolute)
    : pathIsWithin(pathname, destination.session ?? '\0')
        || [destination.path, destination.alias, ...(destination.within ?? [])].some(path => path && pathIsWithin(pathname, `${base}/${path}`));

export const onSettingsDestination = (pathname, base) => settingsDestinations.some(destination => destinationActive(pathname, base, destination));
