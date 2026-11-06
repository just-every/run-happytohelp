import React from 'react';

const link = (href, text) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;

/** What each help-center import needs, in the provider's own words for where to find it. */
export const importGuides = {
 // Zendesk articles come in with the rest of the account through Move in, where restricted articles are held back.
 zendesk: {
  intro: 'Zendesk Help Center articles import through Move in: connect Zendesk there and pull. Published articles stay published, drafts stay drafts, and articles for restricted audiences are held back.',
  moveIn: true,
 },
 intercom: {
  intro: 'Copies your Intercom Help Center collections, sections and articles. Published articles stay published and drafts stay drafts.',
  subdomain: null,
  secrets: [
   {name: 'INTERCOM_TOKEN', example: 'your-intercom-access-token', what: 'an Intercom access token that can read articles.', how: <>In Intercom, open {link('https://app.intercom.com/a/apps/_/developer-hub', 'Developer Hub')}, create an app (or open yours), then <b>Authentication</b>, and copy the <b>Access token</b>.</>},
  ],
 },
 freshdesk: {
  intro: 'Copies your Freshdesk Solutions categories, folders and articles. Published articles stay published and drafts stay drafts.',
  subdomain: 'The first part of your Freshdesk address: acme for acme.freshdesk.com.',
  secrets: [
   {name: 'FRESHDESK_TOKEN', example: 'your-freshdesk-api-key', what: 'your Freshdesk API key.', how: <>In Freshdesk, choose your profile picture, then <b>Profile settings</b>, and choose <b>View API key</b> ({link('https://support.freshdesk.com/support/solutions/articles/215517', 'Freshdesk’s guide')}).</>},
  ],
 },
};
