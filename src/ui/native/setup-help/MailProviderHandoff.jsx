import React from 'react';
import DeveloperHandoff from './DeveloperHandoff';

export default function MailProviderHandoff({provider}) {
 const google = provider === 'gmail', name = google ? 'Google' : 'Microsoft';
 const steps = google ? `1. In Google Cloud, enable Gmail API. Configure the Google Auth Platform consent screen and the intended mailbox test users where needed.
2. Add gmail.readonly, gmail.send and gmail.settings.basic scopes. Create an OAuth client of type Web application. Register the online installation’s origin followed by /api/management/mailboxes/oauth/gmail/callback as its authorized redirect URI.
3. Save GOOGLE_MAIL_CLIENT_ID and GOOGLE_MAIL_CLIENT_SECRET as private installation inputs. Retain INTEGRATION_ENCRYPTION_KEY. Follow the installation-settings section of the email guide to install them. Never email these secrets.
4. Complete Google’s applicable verification and publishing requirements. Reload Settings → Email, choose Add mailbox → Google Gmail, then authorize the intended account.` : `1. In Microsoft Entra, register a Web application for organizational and personal accounts. Register the online installation’s origin followed by /api/management/mailboxes/oauth/microsoft/callback as its redirect URI.
2. Add delegated User.Read, Mail.Read, Mail.Send and offline_access permissions; obtain administrator consent if required.
3. Save MICROSOFT_MAIL_CLIENT_ID and MICROSOFT_MAIL_CLIENT_SECRET as private installation inputs. Retain INTEGRATION_ENCRYPTION_KEY. Follow the email guide to install them. Never email these secrets.
4. Reload Settings → Email, choose Add mailbox → Microsoft 365, then authorize the intended account.`;
 const guide = `/docs/email#${google ? 'google-gmail-setup' : 'microsoft-365-setup'}`;
 return <DeveloperHandoff what={`A technical person connects your ${name} email service first.`} unlocks="Then you can choose and authorize your support mailbox." subject={`Connect ${name} email to HappyToHelp`} steps={steps}>
  <pre tabIndex={0}>{steps}</pre><p><a href={guide}>Complete {name} setup guide</a></p>
 </DeveloperHandoff>;
}
