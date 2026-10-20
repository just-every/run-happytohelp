# Intelligent triage

Triage reads each new customer message and records its intent, sentiment and
language. Open **Settings → Workflows → Triage** to enable it. The workspace's
selected AI service supplies the model; triage shares the daily automatic AI
request and spend ceilings. The starter intents cover refunds, shipping, billing,
bug reports and how-to questions. Rename them, add intents or turn off Active to
retire an intent while keeping its history.

A ticket is saved before any model request starts. Its **Intelligent triage**
panel shows each prediction, its confidence and the exact customer words used as
evidence. A missing service key, failed request or invalid evidence leaves the
fields empty and shows why. Interrupted paid requests are never repeated.
A new customer message clears the previous fields while its classification is
pending. Historical imports do not start model requests.

Set a confidence threshold and a default queue. When triage finishes below the
threshold or cannot run, a ticket that no teammate or rule has assigned or queued
moves to that queue once. A teammate's later queue or assignee choice is kept.
Routing rules that do not use a triage field run as soon as the ticket arrives,
whatever the model is doing. A rule that uses a triage field acts only on a
confident prediction for the latest customer message, and is checked again when
triage finishes. A retired intent cannot route new tickets. Triage starts with
intent routing off.

Operators use **Operator correction** in the ticket panel to label intent,
sentiment or language. A confirmation can use the same value as the prediction.
Every label records the teammate and time; the original prediction stays visible.
The accuracy table compares the latest intent label for each prediction with the
original model result. It shows correct and total labels for each labeled intent;
an intent without labels has no measured accuracy. These measurements describe
your labeled examples, not every ticket or independently qualified model quality.

Before enabling **Use predictions for routing**, a lead must have intent labels,
review this table and explicitly confirm the review. Create an assignment rule in
**Workflows → Rules** using the **Intent** ticket field. The same fields can filter
saved views and reports. For a priority rule that responds when triage finishes,
use a **Changed** event with the **Triage sentiment** field. Confidence and quoted
evidence are also available as ticket fields. The intent field stores stable
intent IDs, so renaming an intent keeps existing rules and history connected.

Owners and admins with settings permission manage triage. The collaborator role
can read it but cannot change settings or correct predictions. Contact erasure
removes predictions, quotes, labels and queued work. `rer export` and import carry
triage settings, predictions and labels; restored model work is marked unavailable
and intent routing is turned off until a lead enables it again. The security log
records settings, routing approval, classification and corrections without copying
customer words into the log.
