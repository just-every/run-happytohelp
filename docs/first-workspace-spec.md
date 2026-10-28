# First workspace rules

First-run setup is one screen: the
owner's email, a password, the website and, only where the server requires one,
the private setup token. Missing names and colors are derived and every derived
value can be changed. A completed installation leads the owner to a workspace that
is already set up, whose Setup page lists only what cannot be done for them (an
AI service key, the widget on their website and, with a hosted email provider, a
verified sending domain), leads with the widget, lets the owner skip any of
them for now, and shows everything else under "What we've set". Every workspace created by first-owner setup, signed-in
workspace creation or email-verified registration, and never a demo workspace,
is provisioned in one step: a starter
assistant as its default visitor assistant, a reply-by-email mailbox when the
installation holds `INBOUND_EMAIL_TOKEN`, and mail sent from the installation
sender until the workspace's own domain is verified. The starter assistant answers
visitors by itself once a provider key exists, within the daily AI ceilings; with
no key no assistant is assigned to a new conversation, it stays with the team and
the AI page and Setup say a key is missing. The first-run Create workspace action
may send one welcome email to the owner; an uncertain send is never replayed.
Ordinary workspace creation leads with the widget snippet; Advanced retains the
server secret and verification examples. Empty inboxes offer installation, a link to
Setup and a demo. Workspace headers follow workspace switching.
Visitor headers retain the operator's display name.
