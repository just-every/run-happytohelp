# When your team is away

Outside your opening hours, when you turn off new conversations for a while, or
when nobody on your team is online, the chat widget tells visitors the truth:
your team is away. It shows the expected reply time, asks for an email so your
answer reaches them, and keeps their conversation in your inbox for when you
return.

## What visitors see

- **An away notice** at the top of the chat: "We're away right now", when you
  are back when a reopening is known (for example "We're back Monday at
  8:00 AM.", in the visitor's own time), and where your answer will reach them.
- **An expected reply time** next to your team's name in the chat header: for
  example, "Away until Monday at 8:00 AM" when a reopening is known.
- When no reopening is known, the notice, header and away message use your
  **Human response time** from **Settings → Widget** instead.
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

## What decides availability

1. **Accept new conversations** off always makes the widget away, regardless
   of hours, live presence or an enabled visitor assistant.
2. With acceptance on, the first active matching ordinary widget SLA policy
   with an active business-hours calendar supplies the hours, holidays, closed
   dates and timezone. Policies are checked in their configured order.
3. If no matching SLA policy has an active calendar, the widget uses its own
   opening hours and the workspace timezone.
4. While those hours are open (or no hours are configured), live presence
   decides availability when **Show away when no teammate is online** is on.
   An enabled visitor assistant with its provider key installed keeps the
   widget available when nobody is online.

A holiday or closed date in the governing SLA calendar therefore makes the
widget away even when its own opening hours are open. See
[Business hours and ticket workflows](workflows.md) to configure the calendar
and policy.

## When nobody is online

While acceptance is on and the governing hours are open, the
widget also checks whether anyone is actually there. A teammate who can reply
to customers counts as online while they have HappyToHelp open in a browser and
have used it recently. Collaborators, who only add internal notes, do not count.

When nobody is online, visitors see the same away notice and email field as
outside your hours. The notice, header and one away message show your
**Human response time**, since there is no known reopening. As soon as a
teammate opens HappyToHelp again, the widget shows your team as available
while acceptance is on and the governing hours are open.

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
online**. Leave it empty for a standard message with your **Human response
time**. The **Right now** line lists who is online, uses the same availability
as the server and widget, and identifies the governing SLA calendar when
there is one. Turning it on or off, or changing the idle time, is recorded in
**Settings → Security log**.

## Set your hours

1. Open **Settings → Project**, **Availability** tab.
2. Turn on **Use opening hours**, tick your days and set the opening and
   closing time.
3. Check the timezone: these fallback hours use the workspace timezone, set
   on the **General** tab. A matching SLA calendar uses its own timezone and
   hours instead. The **Right now** line shows the current server and widget
   availability and identifies the governing SLA calendar.
4. Optionally write an **Away message outside hours**. Leave it empty for a
   standard one, for example: "Thanks for your message. Acme is away right now
   and back Monday at 9:00 AM EDT. We'll reply here and by email."
5. Choose **Update**.

When acceptance is on, an away reply for a closed SLA calendar uses **Away
message outside hours** too. If that field is empty, it uses the standard
message; it never uses **Away message while new conversations are off**. The
notice, header and reply show the next reopening when known, otherwise your
**Human response time**.

A widget left open notices when you open or close and updates itself.

## Close for a while

Turn off **Accept new conversations** when nobody can answer, for example
during a team offsite. This switch is independent of opening hours and always
wins over schedules and presence. Visitors are told you are away with your
**Human response time**, and new conversations still arrive. Write an **Away
message while new conversations are off**, or leave it empty for a standard
one. Turn acceptance back on when you return; the governing hours and live
presence then decide availability.

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
