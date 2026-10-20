import type {Env} from '../../platform/env'
import type {Run} from './types'
import {buildAnonymousEmbedCode} from '../../ui/dashboard/components/widget-settings/code/anonymousEmbedCode'

const steps={
 zendesk:{email:'Zendesk Admin Center → Channels → Talk and email → Email → Manage support addresses',widget:'Remove the Zendesk Web Widget loader from the website or tag manager, and disable automatic Help Center embedding.',alias:'zendesk.com'},
 intercom:{email:'Intercom Settings → Channels → Email → Domains and addresses',widget:'Remove the Intercom Messenger loader and its boot/update calls or website plugin. Hiding the launcher leaves the old Messenger connected.',alias:'intercom-mail.com'},
 helpscout:{email:'Help Scout Settings → Inboxes → your inbox → Connect Email & Social',widget:'Remove the Help Scout Beacon installation code and turn off Enable Beacon in your Docs site settings.',alias:'helpscoutapp.com'},
 freshdesk:{email:'Freshdesk Admin → Channels → Email',widget:'Remove the Freshdesk Help Widget installation code or its website plugin.',alias:'freshdesk.com'},
}

/** Describe changes for the lead to make; this function never changes a channel. */
export async function cutoverChannels(env:Env,run:Run){
 const [email,project]=await Promise.all([
  env.DB.prepare('SELECT inbound_address,is_enabled FROM email_settings WHERE project_id=?').bind(run.project_id).first<{inbound_address:string|null;is_enabled:number}>(),
  env.DB.prepare('SELECT widget_key FROM projects WHERE id=?').bind(run.project_id).first<{widget_key:string}>(),
 ])
 const step=steps[run.vendor],destination=email?.is_enabled&&email.inbound_address?email.inbound_address:null,origin=typeof env.APP_ORIGIN==='string'?env.APP_ORIGIN.replace(/\/$/,''):''
 return [
  {channel:'Email forwarding',instructions:[
   `Open ${step.email} and list every source support address. At your mail provider, replace each company-owned mailbox’s old forwarding destination with ${destination??'the receiving address you must first save and enable in HappyToHelp Settings → Email'}. Keep its existing MX records. HappyToHelp does not supply replacement MX records.`,
   `An address owned by ${step.alias} remains controlled by ${run.vendor}. Keep that vendor account receiving and relaying old-address mail to HappyToHelp; changing your company mailbox’s forwarding does not redirect vendor-owned aliases.`,
   'Preserve Message-ID, In-Reply-To, References and the original subject when forwarding. Reply to a real pre-migration notification and confirm that it reaches its imported ticket before disabling an old receiver.',
   ...(run.vendor==='freshdesk'?['Freshdesk’s documented history API does not expose old RFC Message-IDs. Replies need the preserved [#ticket-number] subject token or other explicit source threading evidence. A reply with only an unavailable old Message-ID cannot be matched from this API import.']:[]),
  ]},
  {channel:'Chat widget',instructions:[step.widget,'Install the snippet below once on each website that used the old widget, then open a visitor conversation and confirm it reaches this workspace.'],...(origin&&project?.widget_key?{snippet:buildAnonymousEmbedCode({widgetKey:project.widget_key,apiOrigin:origin,scriptUrl:`${origin}/widget.js`})}:{})},
  {channel:'Help Center domain',instructions:[
   'For a custom Help Center host, your installation operator must add the host to PUBLIC_HELP_HOSTS for this workspace and configure the new site’s verified custom domain. Copy the DNS target supplied by that hosting provider to replace the old vendor CNAME. Keep the old site available until the new host is verified. No DNS change is needed for a vendor-owned Help Center URL; update links to the new Help Center instead.',
  ]},
 ]
}
