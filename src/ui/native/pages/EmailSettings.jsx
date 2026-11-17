import ManagedEmail from './email/ManagedEmail';
import {Link} from '@tanstack/react-router';
import React from 'react';
import OwnerTestMail from '../activation/OwnerTestMail';
import { Section } from './forms';
import Mailboxes from './email/Mailboxes';
import DeveloperHandoff from '../setup-help/DeveloperHandoff';
import LocalMailBanner from '../setup-help/LocalMailBanner';

const providers = {rer:'Run Edit Run',resend: 'Resend', sendgrid: 'SendGrid', cloudflare: 'Cloudflare Email Sending', mailgun: 'Mailgun'};
const domainOf = address => String(address || '').split('@')[1] || '';

function Sending({sending, installation, role, projectId}) {
 if (sending?.mode === 'local') return null;
 if (sending?.mode === 'remote') return <><div className="sh-state" data-sending="ready"><span className="h2h-chip"><i className="fe fe-check" aria-hidden="true"/>Working</span><p>Sending is set up: mail goes out through {providers[sending.provider] || sending.provider}{sending.from ? <> from <b>{sending.from}</b></> : null}.</p></div>{role === 'owner' && <OwnerTestMail projectId={projectId}/>}</>;
 return <p data-sending="missing">Sending email is off. Ask your technical person to connect your email service.</p>;

}

const receivingCopy = (receiving, domain) => ({
 ready: ['Mail server found', <>Mail to <b>{receiving.address}</b> reaches a mail server. Send it a test email: Setup confirms the first one that arrives.</>],
 no_address: ['Not set up', <>Enter the address customers will write to. Changes save automatically.</>],
 local: ['Local trial', null],
 no_token: ['Not available', <>This installation has no receiving credential. Ask the person running it to finish email setup.</>],
 workers_dev: ['Not available', <><b>{receiving.address}</b> can’t receive email: <code>workers.dev</code> addresses have no mail server. Use an address on a domain you own, such as <code>support@in.example.com</code>, then route it as shown below.</>],
 no_mx: ['Not set up', <><b>{receiving.address}</b> can’t receive email yet: <code>{domain}</code> has no mail server (MX record). Route it as shown below.</>],
 dns_unknown: ['Unknown', <>We couldn’t check the mail records for <code>{domain}</code> just now. Reload the page to try again.</>],
})[receiving.reason] || ['Waiting', 'The receiving route is being activated.'];

function RoutingSteps({receiving, installation, localTrial}) {
 if (localTrial || receiving.reason === 'local') return <details className="sh-guide" data-guide="receiving">
  <summary>How to receive email</summary>
  <div className="sh-steps">
   <p>A local trial cannot receive or send email. Use the website chat to try conversations on this computer.</p>
   <p>When you are ready, follow the <a href="/docs/email#hosted-installation">hosted email setup guide</a> to deploy HappyToHelp and connect a real mailbox or a receiving address on a domain you own.</p>
  </div>
 </details>;
 // A workers.dev domain can never be routed, so its steps use a domain of your own.
 const domain = receiving.reason !== 'workers_dev' && domainOf(receiving.address) || 'in.yourcompany.com', local = (receiving.address || 'support@').split('@')[0] || 'support';
 return <details className="sh-guide" data-guide="receiving">
  <summary>How to receive email</summary>
  <div className="sh-steps">
   <p>Mail reaches HappyToHelp through the receiving domain’s MX records. Use a subdomain such as <code>in.yourcompany.com</code> so your main mail is untouched. Pick one way:</p>
   <p><b>Cloudflare Email Routing</b> (the domain’s DNS is on Cloudflare)</p>
   <ol>
    <li>In Cloudflare, open the domain, then <b>Email</b>, <b>Email Routing</b>, and turn it on for <code>{domain}</code>. Cloudflare adds the MX records.</li>
    <li>Under <b>Routing rules</b>, add the custom address <code>{local}</code> (or a catch-all) with the action <b>Send to a Worker</b>, and choose {installation?.worker ? <code>{installation.worker}</code> : 'your HappyToHelp Worker'}.</li>
    <li>Save the receiving address above and send it a test email.</li>
   </ol>
   <p><b>SendGrid Inbound Parse</b> (any DNS provider)</p>
   <ol>
    <li>At your DNS provider, add an MX record: name <code>{domain}</code>, value <code>mx.sendgrid.net</code>, priority <code>10</code>.</li>
    <li>In SendGrid, open <b>Settings</b>, <b>Inbound Parse</b>, and configure authenticated forwarding to this installation. The <a href="/docs/integrations#receive-email">receiving setup guide</a> has the endpoint and private-credential steps.</li>
   </ol>
   <p className="sh-note">More detail, including your own gateway: <a href="/docs/integrations#receive-email">Receive email</a>.</p>
  </div>
 </details>;
}

/** Settings → Email: what sending and receiving can actually do on this installation, and the steps for each. */
export default function EmailSettings({data, status, field, role, projectId,onRefresh}) {
 if(status?.managed)return <ManagedEmail managed={status.managed} {...{field,role,projectId,onRefresh}}/>;
 const receiving = status?.receiving || {reason: 'no_address', address: null}, domain = domainOf(receiving.address);
 const [chip, copy] = receivingCopy(receiving, domain), localTrial = status?.sending?.mode === 'local' || receiving.reason === 'local';
 const steps = `1. Put this installation online before connecting email. Use an address on a domain you control, never a local-trial domain.
2. Choose an email provider in installation setup, verify your sending domain and install its private credentials. Publish the configuration; saving a workspace address alone does not enable email.
3. For Cloudflare Email Routing, enable Email Routing on the receiving domain and add the MX records it supplies. Under Routing rules, route the support address to this HappyToHelp Worker. Save that address in Settings → Email.
4. Alternatively, configure SendGrid Inbound Parse with an MX record pointing to mx.sendgrid.net (priority 10) and authenticated forwarding as described in the email guide. Do not replace existing mail records without checking the current mail service.
5. For Gmail or Microsoft, use Add mailbox and send the provider’s setup steps to the person managing that account. After configuration, authorize the mailbox and test sending and receiving.`;
 return <>
  {localTrial && <LocalMailBanner/>}
  <p>Customers can already chat with you. To also get emails at {receiving.address && !localTrial ? <b>{receiving.address}</b> : 'your support address'}, a technical person sets up your domain’s email.</p>
  <DeveloperHandoff what="Your domain’s email needs to be connected." unlocks="This lets customers write to your support address." subject="Connect our support email to HappyToHelp" steps={steps}>
   <pre tabIndex={0}>{steps}</pre><p><a href="/docs/email#hosted-installation">Complete email setup guide</a></p>
   {!localTrial && <RoutingSteps receiving={receiving} installation={status?.installation} localTrial={false}/>}
  </DeveloperHandoff>
  <Section title="Send Email">
   <Sending sending={status?.sending} installation={status?.installation} role={role} projectId={projectId}/>
   <div className="settings-grid">{field('email_from_address', 'Support Email From Address', 'email')}{field('email_from_name', 'Support Email From Name')}</div>
   <div className="mt-3">{field('is_enabled', 'Email customers and your team about conversations', 'checkbox')}</div>
   <p className="settings-note">On: customers who leave an email get your replies by email, and teammates get alerts. Off also stops receiving.</p>
   <p className="settings-note">Who gets alerts: the person a conversation is assigned to, when the customer writes and they have not read it. Unassigned conversations alert only people who turned on <b>Notify on unassigned conversation activity</b>, each set under <Link to={`/projects/${projectId}/agents`}>Agents</Link> (open a person, including yourself). It is on for the owner who created the workspace, so a team of one hears about every new conversation; turn it on for whoever else should, or off for anyone who should not.</p>
  </Section>
  <Section title="Receive Email">
   {field('inbound_address', 'Receiving address', 'email')}
   <div className="sh-state" data-receiving={receiving.reason}><span className={`h2h-chip${receiving.ready ? '' : ' h2h-chip--muted'}`}>{receiving.ready && <i className="fe fe-check" aria-hidden="true"/>}{chip}</span><p>{copy}</p></div>
   {!receiving.ready && !localTrial && <p className="settings-note">Until receiving is ready, emails to customers carry no reply address: they ask the customer to answer in the chat on your website.</p>}
   {localTrial && <RoutingSteps receiving={receiving} installation={status?.installation} localTrial/>}
  </Section>
  <Mailboxes projectId={projectId} role={role}/>
 </>;
}
