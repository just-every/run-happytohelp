# When your team is away

Outside your opening hours, when you turn off new conversations for a while, or
when nobody on your team is online, the chat widget tells visitors the truth:
nobody is there right now. It says when you are back, asks for an email so your
answer reaches them, and keeps their conversation in your inbox for when you
return.

## What visitors see

- **An away notice** at the top of the chat: "We're away right now", when you
  are back (for example "We're back Monday at 8:00 AM.", in the visitor's own
  time), and where your answer will reach them.
- **"Away until Monday at 8:00 AM"** next to your team's name in the chat
  header, instead of the usual reply time.
- **An email field before they write**, with "We'll email our reply to this
  address." A visitor who already gave an email is told you will reply there.
  Leaving an email is optional; the visitor can just write.
- **One away message** in the conversation, posted after their first message.
  It is posted once per conversation, however many messages they send.

Their conversation reaches your inbox like any other. The away message shows
there with an **automatic** label. When you reply, your answer appears in the
chat and is emailed to the address they left.

If one of your AI assistants answers the conversation, it keeps answering after
hours, and no away message is posted.

## When nobody is online

During your hours (or, without hours, while you accept new conversations) the
widget also checks whether anyone is actually there. A teammate who can reply
to customers counts as online while they have HappyToHelp open in a browser and
have used it recently. Collaborators, who only add internal notes, do not count.

When nobody is online, visitors see the same away notice and email field as
outside your hours, without a time ("We'll reply as soon as we're back."), and
one away message is posted in their conversation. As soon as a teammate opens
HappyToHelp again, the widget shows your team as available.

- Closing HappyToHelp counts as away within about 10 seconds; a lost connection
  or a server restart within 90 seconds. A teammate who has not used
  HappyToHelp for the idle time you choose (15 minutes unless you change it)
  counts as away until they use it again.
- An open chat widget checks again every 30 seconds, and whenever the visitor
  opens it.
- If your visitor AI assistant answers visitors (it is on and its provider key
  is installed), the widget stays available when nobody is online.

To change it, open **Settings → Project**, **Availability** tab, **When nobody
is online**: turn **Show away when no teammate is online** off or on (it is on
for every workspace until you turn it off), choose after how long without use a
teammate counts as away, and optionally write an **Away message when nobody is
online**. Leave it empty for a standard one, for example: "Thanks for your
message. Acme is away right now. We'll reply here and by email." The **Right
now** line lists who is online. Turning it on or off, or changing the idle
time, is recorded in **Settings → Security log**.

## Set your hours

1. Open **Settings → Project**, **Availability** tab.
2. Turn on **Use opening hours**, tick your days and set the opening and
   closing time.
3. Check the timezone: hours are in the workspace timezone, set on the
   **General** tab. The **Right now** line shows what visitors see at this
   moment, before you save.
4. Optionally write an **Away message outside hours**. Leave it empty for a
   standard one, for example: "Thanks for your message. Acme is away right now
   and back Monday at 9:00 AM EDT. We'll reply here and by email."
5. Choose **Update**.

A widget left open notices when you open or close and updates itself.

## Close for a while without hours

Under **Without opening hours**, turn off **Accept new conversations** when
nobody can answer, for example during a team offsite. Visitors are told you are
away, without a time, and new conversations still arrive. Write an **Away
message while new conversations are off**, or leave it empty for a standard
one. Turn it back on when you return.

## Good to know

- The away message is never emailed, never earns an AI reply, and is not a
  reply: response times in **Reports** still run until a person or an
  assistant answers, a conversation an assistant resolves still counts as
  resolved by AI, and automations for an operator reply wait for a teammate.
- The widget asks for an email only when this installation can send email.
- You can change the away texts, for example to translate them, in
  **Settings → Widget → Texts**, under **When your team is away**.
- New-conversation emails: whoever creates a workspace has **Notify on
  unassigned conversation activity** on, so a team of one hears about every new
  conversation. Each teammate can turn it on or off under **Agents**.
