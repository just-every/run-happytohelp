import React from 'react';
import {Link} from '@tanstack/react-router';
import {buildAnonymousEmbedCode} from '../../dashboard/components/widget-settings/code/anonymousEmbedCode';
import CopyCommand from '../setup-help/CopyCommand';
import SecretSteps from '../setup-help/SecretSteps';
import {hostOf, modelKeyState} from './setup-model';
// Serves a test page on a port nothing else is using, and prints its address.
const testPageCommand=`PORT=\$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
echo "Test page: http://127.0.0.1:\$PORT"
python3 -m http.server "\$PORT" --bind 127.0.0.1`;

// The words and actions of each thing that needs the owner. Local and hosted copy is chosen here, never hidden by CSS.
const keyPages = {
 OPENAI_API_KEY: ['OpenAI', 'https://platform.openai.com/api-keys'], ANTHROPIC_API_KEY: ['Anthropic', 'https://console.anthropic.com/settings/keys'],
 GOOGLE_API_KEY: ['Google AI Studio', 'https://aistudio.google.com/app/apikey'], DEEPSEEK_API_KEY: ['DeepSeek', 'https://platform.deepseek.com/api_keys'],
 XAI_API_KEY: ['xAI', 'https://console.x.ai'], OPENROUTER_API_KEY: ['OpenRouter', 'https://openrouter.ai/settings/keys'],
};
const keyLink = name => <a href={keyPages[name][1]} target="_blank" rel="noreferrer">{keyPages[name][0]}</a>;
/** This installation, for steps that say exactly where a value goes. */
export function installationOf(data) {
 const origin = data.facts?.widget?.apiOrigin || '', host = hostOf(origin);
 return {environment: data.environment === 'local' ? 'local' : 'hosted', origin, worker: host.endsWith('.workers.dev') ? host.split('.')[0] : null};
}
const where = (data, name) => <SecretSteps installation={installationOf(data)} values={[{name, example: 'your-api-key'}]}/>;

function aiNeed({data}) {
 const name = data.facts?.ai?.secretName;
 // Workspaces made before the starter assistant existed have none: say only what is true of the assistant they do have.
 const starter = Boolean(data.facts?.starterAssistant), hasDefault = Boolean(data.facts?.ai?.assistantId);
 const whose = starter ? 'your starter assistant' : hasDefault ? 'your default assistant' : 'an assistant';
 // A provider that checks keys refused this one the read it needs (for example HTTP 403): the key is there, so ask
 // for the access, not for a key.
 if (modelKeyState(data) === 'blocked') return {
  title: 'Let us check your AI key',
  copy: <><code>{name}</code> is installed, but the provider refused our read-only check, so we can’t confirm {whose} can answer with it.</>,
  actions: [{kind: 'how'}],
  how: <><p>In your AI provider’s dashboard, give this key permission to read models. Or make a key that has it and replace <code>{name}</code>. We’ll check again on our own.</p>{where(data, name)}</>,
 };
 return {
  title: 'Connect an AI service',
  copy: starter
   ? <>Your starter assistant will answer visitors from what you publish and from your website, within your daily limits. It needs a key from OpenAI, Anthropic, Google or a similar service.</>
   : <>Once a key is in, {hasDefault ? 'your default assistant' : 'an assistant'} can answer visitors from what you publish and from your website, within your daily limits. It needs a key from OpenAI, Anthropic, Google or a similar service.</>,
  actions: [{kind: 'how'}],
  how: <>
   <p><b>What it’s for:</b> the AI suggests replies for your team and {starter ? 'lets your starter assistant answer' : 'lets an assistant answer'} visitors when no one is around, using only what you publish and your website. Without a key, every conversation stays with your team.</p>
   <p><b>1. Get an API key.</b> {name && keyPages[name] ? <>{whose[0].toUpperCase() + whose.slice(1)} uses {/^[AEIOU]/.test(keyPages[name][0]) ? 'an' : 'a'} {keyPages[name][0]} model, so make a key at {keyLink(name)}. Using another service instead? Add its key and choose one of its models on the AI page.</> : <>Make one with any of {Object.keys(keyPages).map((key, index, all) => <React.Fragment key={key}>{index ? index === all.length - 1 ? ' or ' : ', ' : ''}{keyLink(key)}</React.Fragment>)}. Its name is <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>GOOGLE_API_KEY</code>, <code>DEEPSEEK_API_KEY</code>, <code>XAI_API_KEY</code> or <code>OPENROUTER_API_KEY</code>.</>}</p>
   <p><b>2. Add it to this installation{name ? <> as <code>{name}</code></> : null}.</b> We’ll notice as soon as it’s there.</p>
   {where(data, name || 'OPENAI_API_KEY')}
  </>,
 };
}

function widgetNeed({data, projectId}) {
 const host = data.facts?.website ? hostOf(data.facts.website) : '';
 const {key, scriptUrl, apiOrigin} = data.facts?.widget || {};
 // A first deploy defaults the website to the app itself: only right for a test.
 const own = Boolean(host) && host === hostOf(apiOrigin);
 const snippet = key ? buildAnonymousEmbedCode({widgetKey: key, scriptUrl, apiOrigin}) : '';
 return {
  title: 'Add the widget to your website',
  copy: <>Paste this before the closing body tag of every page on your own website, the one your customers visit. We can’t edit your site, so this one is yours.{own ? <> The widget is set to answer only on this HappyToHelp address (<b>{host}</b>), which is not your website: first enter your website’s address in <Link to={`/projects/${projectId}/widget-settings`} hash="settings">Widget settings</Link> under Website.</> : host ? <> The widget answers only on <b>{host}</b>; if your site has another address, change it in <Link to={`/projects/${projectId}/widget-settings`} hash="settings">Widget settings</Link>.</> : null}</>,
  how: <><p><b>Try it on your computer first:</b> save the snippet in a file named <code>test.html</code> inside <code>&lt;html&gt;&lt;body&gt; … &lt;/body&gt;&lt;/html&gt;</code>, then run this in that folder. It picks a free port and prints the address:</p><CopyCommand text={testPageCommand}/><p>Open that address with <code>/test.html</code> on the end. For that test, set the Website in Widget settings to the printed address, and set it back to your real site when you’re done.</p></>,
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
