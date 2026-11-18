// Settings destinations use the existing workspace pages and preserve deep links.
export const settingsGroups = [
 {label: null, destinations: [
  {label: 'Business hours', path: 'business-hours'},
  {label: 'Team', path: 'agents'},
  {label: 'Chat widget', path: 'widget-settings'},
  {label: 'Email', path: 'email-settings'},
  {label: 'Saved replies', path: 'macros'},
  {label: 'AI', path: 'ais'},
  {label: 'Help center', path: 'help-center-settings'},
 ]},
 {label: null, destinations: [
  {label: 'Workspace', path: 'edit', alias: 'settings', within: ['move-in']},
  {label: 'Setup', path: 'activation'},
 ]},
 {label: 'Advanced', collapsed: true, destinations: [
  {label: 'Webhooks', path: 'webhook-settings'},
  {label: 'API tokens', path: 'api-settings'},
  {label: 'Plugins', path: 'plugins'},
  {label: 'Connected applications', absolute: '/delegation/settings'},
  {label: 'Delivery log', path: 'delivery-log'},
  {label: 'Security log', path: 'security-log'},
  {label: 'Local computers', path: 'local-agent', session: '/local-agent/authorize'},
  {label: 'Procedures', path: 'procedures'},
  {label: 'Suspended email', path: 'suspended'},
  {label: 'Regulated deployment', path: 'assurance'},
  {label: 'Cutover', path: 'cutover'},
  {label: 'Roles', path: 'roles'},
  {label: 'Security', path: 'security'},
  {label: 'Tickets', path: 'ticket-settings'},
  {label: 'Workflows', path: 'workflow-settings'},
  {label: 'Support channels', path: 'support-channels'},
  {label: 'Slack', path: 'slack-settings'},
  {label: 'HubSpot', path: 'hubspot-settings'},
  {label: 'GitHub', path: 'github-settings'},
 ]},
];
export const settingsDestinations = settingsGroups.flatMap(group => group.destinations);
export const pathIsWithin = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);
export const destinationActive = (pathname, base, destination) => destination.absolute
 ? pathIsWithin(pathname, destination.absolute)
 : pathIsWithin(pathname, destination.session ?? '\0')
  || [destination.path, destination.alias, ...(destination.within ?? [])].some(path => path && pathIsWithin(pathname, `${base}/${path}`));
export const onSettingsDestination = (pathname, base) => settingsDestinations.some(destination => destinationActive(pathname, base, destination));
