import React from 'react';
import {Link} from '@tanstack/react-router';
import {buildAnonymousEmbedCode} from '../../dashboard/components/widget-settings/code/anonymousEmbedCode';
import CopyCommand from '../setup-help/CopyCommand';
import AiKeyHandoff from '../setup-help/AiKeyHandoff';
import {aiBilling} from '../setup-help/ai-billing';
import {hostOf, modelKeyState} from './setup-model';
// Serves a test page on a port nothing else is using, and prints its address.
const testPageCommand=`PORT=\$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
echo "Test page: http://127.0.0.1:\$PORT"
python3 -m http.server "\$PORT" --bind 127.0.0.1`;

/** This installation, for steps that say exactly where a value goes. */
export function installationOf(data) {
 const origin = data.facts?.widget?.apiOrigin || '', host = hostOf(origin);
 return {environment: data.environment === 'local' ? 'local' : 'hosted', origin, worker: host.endsWith('.workers.dev') ? host.split('.')[0] : null};
}
function aiNeed({data}) {
 const blocked = modelKeyState(data) === 'blocked';
 return {
  title: blocked ? 'Let us check your AI key' : 'Connect an AI service',
  copy: <>{blocked ? 'Your AI provider refused the key check. Ask your technical person to review its access.' : 'Without a key, every conversation stays with your team.'} {aiBilling}</>,
  actions: [{kind: 'how'}],
  how: <AiKeyHandoff secretName={data.facts?.ai?.secretName} installation={installationOf(data)}/>,
 };
}

function widgetNeed({data, projectId}) {
 const host = data.facts?.website ? hostOf(data.facts.website) : '';
 const {key, scriptUrl, apiOrigin} = data.facts?.widget || {};
 // A first deploy defaults the website to the app itself: only right for a test.
 const own = Boolean(host) && host === hostOf(apiOrigin);
 const addressSettings = <Link to={`/projects/${projectId}/widget-settings`} hash="settings">Your website address</Link>;
 const allowed = data.facts?.widget?.hasAdditionalAddresses ? 'Chat also works on your other allowed addresses.' : 'This is the only website address you’ve allowed.';
 const snippet = key ? buildAnonymousEmbedCode({widgetKey: key, scriptUrl, apiOrigin}) : '';
 return {
  title: 'Add the widget to your website',
  copy: <>Paste this before the closing body tag of every page on your own website, the one your customers visit. We can’t edit your site, so this one is yours.{host && <> The main address is <b>{host}</b>{own && ' (this HappyToHelp installation)'}. {allowed} You can change the main address under {addressSettings}.</>}</>,
  how: <><p><b>Try it on your computer first:</b> save the snippet in a file named <code>test.html</code> inside <code>&lt;html&gt;&lt;body&gt; … &lt;/body&gt;&lt;/html&gt;</code>, then run this in that folder. It picks a free port and prints the address:</p><CopyCommand text={testPageCommand}/><p>Open that address with <code>/test.html</code> on the end. For that test, set {addressSettings} in Chat widget settings to the printed address, and set it back to your real site when you’re done.</p></>,
  snippet,
  actions: snippet ? [{kind: 'copy', text: snippet}, {kind: 'mailto', text: snippet, host: own ? '' : host}, {kind: 'how'}] : [],
 };
}

function senderNeed({data, item, projectId}) {
 const records = data.facts?.senderRecords || [];
 return {
  title: 'Connect your email service',
  copy: <>So replies and invitations leave from your own address. Choose an email provider in installation settings and verify your sender with that service.</>,
  actions: [{kind: 'how'}],
  how: <>
   {item.state === 'unavailable' && <p>In this installation’s <b>Settings → App settings</b> or native setup, choose <b>Your email provider</b>, select the service, and add its credentials and sender address. Publish the configuration to turn email on; saved keys alone leave Off unchanged. Mailgun also needs its sending domain and region, and its separate webhook signing key to receive mail. The <a href="/docs/email">email setup guide</a> lists every input.</p>}
   {item.state !== 'unavailable' && !records.length && <p>Add your sending domain in your email service. Its DNS records will be listed here as soon as it exists.</p>}
   {records.length > 0 && <><p>Add these DNS records at your domain registrar. We’ll watch for them.</p>
    <ul className="sl-records">{records.map((record, index) => <li key={`${record.type}-${record.name}-${index}`}><code>{record.type}</code> <code>{record.name}</code> <code>{record.value}</code> <span>{record.status}</span></li>)}</ul></>}
  </>,
 };
}

const builders = {model_key: aiNeed, widget_seen: widgetNeed, sender_dns: senderNeed};
export const needContent = args => builders[args.item.id]?.(args);
