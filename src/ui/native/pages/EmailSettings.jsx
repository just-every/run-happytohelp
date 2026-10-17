import {Link} from '@tanstack/react-router';
import React from 'react';
import OwnerTestMail from '../activation/OwnerTestMail';
import CopyCommand from '../setup-help/CopyCommand';
import SecretSteps from '../setup-help/SecretSteps';
import { Section } from './forms';
import Mailboxes from './email/Mailboxes';

const providers = {resend: 'Resend', sendgrid: 'SendGrid', cloudflare: 'Cloudflare Email Sending'};
const domainOf = address => String(address || '').split('@')[1] || '';

function Sending({sending, installation, role, projectId}) {
 if (sending?.mode === 'local') return <div className="sh-state" data-sending="local"><span className="h2h-chip h2h-chip--muted">Local trial</span><p>Email is not sent from a local trial. Sign-in links, invitations and replies are suppressed, so you can try everything safely. Sending works once you deploy.</p></div>;
 if (sending?.mode === 'remote') return <><div className="sh-state" data-sending="ready"><span className="h2h-chip"><i className="fe fe-check" aria-hidden="true"/>Working</span><p>Sending is set up: mail goes out through {providers[sending.provider] || sending.provider}{sending.from ? <> from <b>{sending.from}</b></> : null}.</p></div>{role === 'owner' && <OwnerTestMail projectId={projectId}/>}</>;
 return <div data-sending="missing">
  <div className="sh-state"><span className="h2h-chip h2h-chip--muted">Not set up</span><p>HappyToHelp needs an email service to send sign-in links, invitations and your replies to customers.</p></div>
  <div className="sh-steps"><ol>
   <li>Make an API key with one of these services: <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">Resend</a>, <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" rel="noreferrer">SendGrid</a> or <a href="/docs/integrations#extra-steps-for-cloudflare-email-sending">Cloudflare Email Sending</a>. Use <code>resend</code>, <code>sendgrid</code> or <code>cloudflare</code> as the provider below.</li>
   <li>Verify the address you send from with that service.</li>
   <li>Add the three values to this installation:</li>
  </ol></div>
  <SecretSteps installation={installation} values={[{name: 'EMAIL_PROVIDER', example: 'resend'}, {name: 'EMAIL_FROM', example: 'support@example.com'}, {name: 'EMAIL_API_KEY', example: 'your-api-key'}]}/>
 </div>;
}

const receivingCopy = (receiving, domain) => ({
 ready: ['Ready', <>Mail to <b>{receiving.address}</b> reaches a mail server. Send it a test email: Setup confirms the first one that arrives.</>],
 no_address: ['Not set up', <>Enter the address customers will write to, then save.</>],
 local: ['Local trial', <>Email can’t be received on your computer. Receiving works on a deployed installation with an address on your own domain.</>],
 no_token: ['Not available', <>This installation has no inbound token (<code>INBOUND_EMAIL_TOKEN</code>), so it can’t accept mail. Run <code>rer setup</code> in your checkout to add it, then <code>rer deploy --environment YOUR-ENVIRONMENT</code>.</>],
 workers_dev: ['Not available', <><b>{receiving.address}</b> can’t receive email: <code>workers.dev</code> addresses have no mail server. Use an address on a domain you own, such as <code>support@in.example.com</code>, then route it as shown below.</>],
 no_mx: ['Not set up', <><b>{receiving.address}</b> can’t receive email yet: <code>{domain}</code> has no mail server (MX record). Route it as shown below.</>],
 dns_unknown: ['Unknown', <>We couldn’t check the mail records for <code>{domain}</code> just now. Reload the page to try again.</>],
})[receiving.reason];

function RoutingSteps({receiving, installation}) {
 // A workers.dev domain can never be routed, so its steps use a domain of your own.
 const domain = receiving.reason !== 'workers_dev' && domainOf(receiving.address) || 'in.yourcompany.com', local = (receiving.address || 'support@').split('@')[0] || 'support';
 const host = installation?.origin ? new URL(installation.origin).host : 'your-happytohelp-address';
 return <details className="sh-guide" open={!['ready', 'local'].includes(receiving.reason)} data-guide="receiving">
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
    <li>In SendGrid, open <b>Settings</b>, <b>Inbound Parse</b>, <b>Add Host &amp; URL</b>. Choose <code>{domain}</code>, leave “POST the raw, full MIME message” unticked, and use this URL with your inbound token in place of <code>TOKEN</code>:<CopyCommand text={`https://hh:TOKEN@${host}/api/integrations/email/sendgrid/inbound`}/></li>
    <li>Your inbound token is the <code>INBOUND_EMAIL_TOKEN</code> line in <code>.dev.vars</code>, in the checkout you {installation?.environment === 'local' ? 'run' : 'deployed'} from{installation?.environment === 'local' ? '' : <>: <code>rer deploy</code> installed that same value here</>}. Run this in that folder to show it:<CopyCommand text="grep INBOUND_EMAIL_TOKEN .dev.vars"/>{installation?.environment !== 'local' && <>No checkout, or not sure it is the one you deployed from? Choose a new token in place of <code>NEW-TOKEN</code> (a long random value, for example from <code>openssl rand -hex 32</code>) and install it, then use it in the URL above:<CopyCommand text={`umask 077 && printf 'INBOUND_EMAIL_TOKEN=%s\n' NEW-TOKEN > private.env\nrer deploy --environment YOUR-ENVIRONMENT --env-file private.env --set-secret INBOUND_EMAIL_TOKEN`}/></>}</li>
   </ol>
   <p className="sh-note">More detail, including your own gateway: <a href="/docs/integrations#receive-email">Receive email</a>.</p>
  </div>
 </details>;
}

/** Settings → Email: what sending and receiving can actually do on this installation, and the steps for each. */
export default function EmailSettings({data, status, field, role, projectId}) {
 const receiving = status?.receiving || {reason: 'no_address', address: null}, domain = domainOf(receiving.address);
 const [chip, copy] = receivingCopy(receiving, domain);
 return <>
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
   {!receiving.ready && <p className="settings-note">Until receiving is ready, emails to customers carry no reply address: they ask the customer to answer in the chat on your website.</p>}
   {receiving.reason !== 'no_token' && <RoutingSteps receiving={receiving} installation={status?.installation}/>}
  </Section>
  <Mailboxes projectId={projectId} role={role}/>
 </>;
}
