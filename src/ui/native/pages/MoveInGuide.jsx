import React from 'react';
import CopyCommand from '../setup-help/CopyCommand';
import {freshdeskScript,helpScoutScript,intercomApiScript,intercomContactsScript,zendeskScript} from './move-in-guides';

const tools = <>Open Terminal on a Mac (or a shell on Linux), make a folder for the files with <code>mkdir move-in && cd move-in</code>, then paste the script and press Return. It works in the Mac’s standard shell (zsh) and in bash. It needs <code>curl</code> and <code>jq</code>: a Mac from macOS 15 has both; otherwise run <code>brew install jq</code>. It asks for each value in turn and does not show or save the secret.</>;
const link = (href, text) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;

/** How to produce the file Move in accepts, step by step, from each vendor's own export or API. */
export const vendorGuides = {
 zendesk: {label: 'Zendesk', accept: '.json,.jsonl,.ndjson,.zip', guide: <>
  <ol>
   <li>In Zendesk Admin Center, open <b>Apps and integrations</b>, <b>APIs</b>, <b>API tokens</b>, and add a token. Copy it.</li>
   <li>Copy this script and run it. {tools} It asks for your Zendesk address, the admin’s email and the token.<CopyCommand text={zendeskScript}/></li>
   <li>It writes <code>zendesk-move-in-1.ndjson</code>, <code>-2</code> and so on: 50 tickets each, with every comment and the people in them. Upload them one at a time below.</li>
  </ol>
  <p className="sh-note">Saved replies (macros) and Help Center articles are optional extras, each a line like <code>{'{"macro":{...}}'}</code>; the <a href="/docs/moving-in#zendesk">Zendesk section of the Move in guide</a> shows a complete example of each. To copy only your help articles, use Knowledge, Import instead.</p>
 </>},
 intercom: {label: 'Intercom', accept: '.json,.jsonl,.zip', guide: <>
  <p>Intercom’s own API gives everything Move in needs. You need an Intercom admin account; nothing else to set up.</p>
  <ol>
   <li>In Intercom, open {link('https://app.intercom.com/a/apps/_/developer-hub', 'Developer Hub')}, choose <b>New app</b> (any name, for example <i>HappyToHelp move</i>, for your own workspace), then open its <b>Authentication</b> page and copy the <b>Access token</b>. It only reads: conversations and the users (contacts) in them.</li>
   <li>Copy this script and run it. {tools} It asks for the token, reads every conversation with its replies, notes and customers, and writes <code>intercom-move-in-1.jsonl</code>, <code>-2</code> and so on, 25 conversations each:<CopyCommand text={intercomApiScript}/></li>
   <li>Upload the files one at a time below.</li>
  </ol>
  <details className="sh-note">
   <summary>Already export conversations to Amazon S3, or tens of thousands of them?</summary>
   <p>Intercom can also write its conversation export to an Amazon S3 bucket of yours (Intercom only writes to it; it cannot read or delete).</p>
   <ol>
    <li>In the {link('https://console.aws.amazon.com/s3/', 'AWS S3 console')}, choose <b>Create bucket</b>, give it a name such as <code>yourcompany-intercom-export</code>, keep <b>Block all public access</b> on and create it. Then follow {link('https://www.intercom.com/help/en/articles/6845086-create-an-amazon-s3-bucket-for-conversations-data-export', 'Intercom’s bucket steps')} (sign in to Intercom to open them) to give Intercom permission to write there. Storing a few gigabytes costs a few cents a month.</li>
    <li>In Intercom, open {link('https://app.intercom.com/a/apps/_/settings/data/imports-exports?tab=export-data', 'Settings, Data, Imports & exports, Export data')} and choose <b>New data export</b>: <b>Data API version</b> <b>2.16</b>, <b>Output format</b> JSON or JSONL, destination <b>AWS S3</b> with your bucket. Choose <b>Test</b>; a file named <code>intercom-data-export-test-file.json</code> appears in the bucket. Switch on <b>Export historical data for the last two years</b>, choose <b>Start data export</b> and confirm the email Intercom sends.</li>
    <li>When the export shows done, download its files from the bucket into a folder named <code>intercom-export</code> (in the S3 console select the files and choose <b>Download</b>; with the AWS command line: <code>aws s3 cp s3://yourcompany-intercom-export intercom-export --recursive</code>).</li>
    <li>The export holds conversations but not the people in them. With the access token from step 1 above, run this in the folder that holds <code>intercom-export</code>. It fetches each contact and packs everything into <code>intercom-move-in.zip</code>:<CopyCommand text={intercomContactsScript}/></li>
    <li>Upload <code>intercom-move-in.zip</code> below. Over 2 MiB? Split the exported files across several folders and run the script once for each.</li>
   </ol>
  </details>
  <p className="sh-note">Saved replies and articles: see <a href="/docs/moving-in#intercom">Intercom in the Move in guide</a>.</p>
 </>},
 helpscout: {label: 'Help Scout', accept: '.json,.jsonl,.zip', guide: <>
  <ol>
   <li>In Help Scout, open <b>Your Profile</b>, <b>My Apps</b>, <b>Create My App</b> (any redirect URL works), and copy its App ID and App Secret.</li>
   <li>Open the mailbox you are moving and note the number in its web address.</li>
   <li>Copy this script and run it. {tools} It asks for the App ID, the App Secret and the mailbox number.<CopyCommand text={helpScoutScript}/></li>
   <li>It writes <code>helpscout-move-in-1.jsonl</code>, <code>-2</code> and so on: 25 conversations each, with every thread page and customer. Upload them one at a time below.</li>
  </ol>
  <p className="sh-note">Docs articles: see <a href="/docs/moving-in#help-scout-inbox-v2-and-docs-v1">Help Scout in the Move in guide</a>.</p>
 </>},
 freshdesk: {label: 'Freshdesk', accept: '.json,.jsonl,.ndjson,.zip', guide: <>
  <ol>
   <li>In Freshdesk, open your profile picture, <b>Profile settings</b>, and copy <b>Your API Key</b> from the right of the page.</li>
   <li>Copy this script and run it. {tools} It asks for your Freshdesk address and API key.<CopyCommand text={freshdeskScript}/></li>
   <li>It writes <code>freshdesk-move-in-1.ndjson</code>, <code>-2</code> and so on: 50 tickets each, with every reply and note and the people in them. It also writes <code>freshdesk-move-in-saved-replies.ndjson</code> with your canned responses. Upload them one at a time below.</li>
  </ol>
  <p className="sh-note">This script keeps attachment metadata only. You can explicitly supply bounded attachment bytes as described in the guide. Help articles come across with Knowledge, Import, Freshdesk. Details: <a href="/docs/moving-in#freshdesk">Freshdesk in the Move in guide</a>.</p>
 </>},
 happytohelp: {label: 'HappyToHelp (the original service)', guide: <>
  <p>History from the original HappyToHelp service moves in with a command run on your computer, not an upload here. Follow <a href="/docs/operations#import-data-from-the-original-happytohelp-service">Import data from the original HappyToHelp service</a>.</p>
 </>},
};
