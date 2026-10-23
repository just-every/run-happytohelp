# Help before they ask

When a visitor seems stuck on your website, for example going back and forth
between the same steps or meeting the same error, the chat widget offers a hand:
a small card beside the chat button with a suggestion. The visitor can open it
as a chat or dismiss it. It is off until you turn it on.

## What it needs

- **The widget on your website.** Setup's "Add the widget to your website"
  shows the code.
- **An AI key.** An AI assistant reads the visitor's recent activity to decide
  whether to offer help, and each check is one request to your AI service. Add a
  key in **Setup → Connect an AI service**. Without one nothing is offered, even
  with the setting on.
- **A default visitor assistant.** New workspaces already have one, the starter
  assistant; it is set on the **AI** page.

## Turn it on

1. Open **Settings → Project**, **General** tab, and find **Help before they
   ask**. Setup links to it.
2. Turn on **Track contact page views with widget** and **Offer proactive help
   after visitor consent**.
3. Choose **Update**.

To make the chat button glow when a card appears, turn on **Glow effects → On
insight** in **Settings → Widget → Settings**.

## When it fires

1. The widget asks each visitor first: "Share your page activity with our AI
   assistant for help before you ask?" with **Allow proactive help** and **No
   thanks**. Nothing is collected from a visitor who says no. A visitor who
   allows it can choose **Stop sharing activity** in the widget at any time.
2. The widget records that visitor's page views, clicks and form steps, with
   the values typed into fields removed.
3. After the first 6 of those actions, and then after every 6 to 20 more (the
   gap grows the longer a visit goes without an offer), your assistant looks at
   the recent activity. It offers help only when the activity shows a concrete
   sign of being stuck; steady progress and ordinary browsing get nothing, so
   most visits never see a card.
4. A visitor who dismisses a card is not offered another for a day, then a
   week after a second dismissal, a month after a third and six months after
   that.

## Cost and privacy

Each check is one AI request on your account. The installation caps how many
checks each workspace makes a day; see [Limits and AI ceilings](PUBLIC-LIMITS.md). Activity is kept with the visitor's contact record
in your workspace and is never shown to other visitors. See
[Personal data](PRIVACY.md) for what is stored and how to erase it.

## Configured campaigns

For a message you write yourself, open **Settings → Widget → Campaigns** and
choose **New campaign**. These cards use no model requests and need no AI key.
Both Project switches above and the visitor's consent are still required.

Set the campaign's sender and brand names, plain-text message and website URL
path prefix (for example `/checkout`, without query strings or fragments).
Choose a page, time-on-page, scroll-depth, exit-intent, saved contact-attribute,
returning-visit or cart-value trigger and an all, new or returning audience.
Attributes compare saved contact metadata; cart value must be supplied explicitly
by your website, for example `h2h('settings', {campaignContext: {cartValue: 100}})`.
Campaigns never scrape cart contents or form values. Exit intent uses a pointer
leaving the top edge, so it has no touch-only equivalent.

A checkout example uses **Time on page: 20**, **Minimum time on page: 20** and
**Maximum cards per visitor per day: 1**. Quiet hours and the daily boundary use
the campaign's IANA timezone, including daylight-saving changes. Quiet hours
include their start and exclude their end; overnight ranges work, and equal
bounds silence the entire day. Campaigns begin disabled. Enable and save when
ready; edit and disable an existing campaign to stop future offers. Only owners
and admins can save, every save is audited, and stale edits are refused.

A browser visit keeps its identity in tab session storage. A returning visitor
has an earlier consented visit under the same widget identity. Clearing browser
storage starts a new identity. Caps persist on the server across tabs, reloads
and restarts; reserved cards use capacity even if navigation prevents display.
The widget shows at most one configured card per mount. Opening it opens an
empty composer: no visitor message or personal data is submitted on their behalf.
The visitor must write and send their own message. Dismiss closes the card.
Stopping page activity sharing removes that visitor's campaign attribution and
visit history; the native contact erasure also removes them.

**Reports → Proactive campaigns** lists displayed impressions, opens, dismissals,
resulting conversations and resolutions for the selected impression date range.
A reservation alone is not an impression. Opens and dismissals are deduplicated
per card. A resulting conversation needs a real visitor message after opening;
opening an empty composer is not a conversation. Each conversation counts once
per campaign, and resolutions count those conversations currently resolved.
Different campaigns may receive credit for the same conversation. Historical
campaign rows remain after disabling a campaign. Consent revocation or contact
erasure removes the visitor's history from these counts. Campaign event and visit records
expire from reports after 30 days. Scheduled cleanup deletes expired records in
bounded pages using spare invocation capacity; report reads also clean their
workspace. Revocation and erasure delete them immediately. The 30-day retention
is a conservative default pending an installation-specific policy ruling.
