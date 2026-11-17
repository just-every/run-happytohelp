import test from 'node:test'
const root='file:///workspace/run-happytohelp/';
const {slaFieldAccessJourney}=await import(root+'tests/helpers/workflows/sla-field-access.mjs');
const {newTicketConfigurationBrowser}=await import(root+'tests/helpers/inbox/new-ticket-configuration.mjs');
const {macroHandoffBrowser,formFieldBrowser}=await import(root+'tests/helpers/stranger11-browser.mjs');
test('SLA field access',slaFieldAccessJourney);
test('inbox new ticket configuration, 1440 assertions and 1440/390 proof',newTicketConfigurationBrowser);
test('repaired macro handoff journey, 1440/390 proof',macroHandoffBrowser);
test('repaired form field journey, 1440/390 proof',formFieldBrowser);
