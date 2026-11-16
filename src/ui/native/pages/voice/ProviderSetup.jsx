import React from 'react';
export default function ProviderSetup({provider}) {
 return <section aria-label="Telephone provider setup"><h3>Before connecting {provider==='twilio'?'Twilio':'Aircall'}</h3>{provider==='twilio'?<ol>
  <li>In the <a href="https://www.twilio.com/docs/usage/requests-to-twilio">Twilio Console dashboard</a>, copy Account SID into Account SID or API ID and reveal Auth Token for Provider auth token. Use the account Auth Token, not an API key.</li>
  <li>Buy or select a voice-capable number in Phone Numbers → Manage → Active numbers. Open it and copy its <a href="https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource">Phone Number SID</a> (the PN identifier) into Provider number ID.</li>
  <li>Set your time zone, human support phone and business hours below, then save. Copy the saved Webhook URL to the number’s Voice configuration, under “A call comes in”: choose Webhook and HTTP POST. See <a href="https://www.twilio.com/docs/voice/tutorials/how-to-respond-to-incoming-phone-calls">Twilio’s incoming-call routing guide</a>.</li>
  <li>The webhook needs a public HTTPS installation reachable by Twilio; localhost cannot receive calls. Complete provider sandbox, emergency number/location and consent qualification before customer use.</li>
 </ol>:<ol>
  <li>In Aircall’s Company Settings → API Keys, choose Add a new API key. Copy API ID into Account SID or API ID and API Token into Provider auth token. Follow <a href="https://developers.aircall.io/api-references">Aircall’s authentication and API guide</a>.</li>
  <li>Buy or select your support number in Aircall. Use the guide’s List all Numbers endpoint with that API ID and token; copy the selected number’s numeric id into Provider number ID. List all Users supplies the teammate id for Aircall teammate ID below.</li>
  <li>Configure the number’s hours, users and call distribution in Aircall. Enter the human support phone and teammate ID below, then save.</li>
  <li>In Aircall’s Webhook integration, add the saved public HTTPS Webhook URL and subscribe to call events. Copy the webhook token issued by Aircall. Back here, choose Edit routing, paste it into Aircall webhook token and save; the tokens must match to receive calls. Follow the guide’s Webhook section. Keep routing, recordings and consent in Aircall; this installation does not import its media. Complete live provider and consent qualification before customer use.</li>
 </ol>}</section>;
}
