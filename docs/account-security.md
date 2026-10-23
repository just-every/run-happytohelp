# Account security

HappyToHelp keeps customer conversations, so every account can add a second step
to signing in, sensitive actions ask you to confirm it is you, each teammate gets
only the access their role needs, and every security-relevant action is written to
a log you can read and export.

## Two-factor sign-in

After your password, you confirm with something only you have:

- **An authenticator app** such as Google Authenticator, 1Password, Authy or
  Microsoft Authenticator. It shows a new six-digit code every 30 seconds.
- **A passkey or security key**: Touch ID, Windows Hello, your phone, or a
  hardware key such as a YubiKey.

### Turn it on

1. Open your profile (your name at the bottom of the sidebar, then **Profile**) and
   choose the **Security** tab.
2. Choose **Add an authenticator app**, scan the QR code (or type the key), and
   enter the code the app shows. Or choose **Add a passkey or security key** and
   follow your browser.
3. Save the **ten recovery codes** that appear. Each one signs you in once if you
   lose your phone or key. They are shown only this once; **Copy codes** and
   **Download .txt** help you keep them.

You can add several apps and passkeys, remove one, or generate a fresh set of
recovery codes from the same tab. Adding a factor ends your other sessions that
never used one.

### Signing in

After your password (or an emailed sign-in link), HappyToHelp asks for the code
from your app, your passkey, or a recovery code. A wrong code, a code that was
already used, or a used recovery code is refused. After five wrong answers in
fifteen minutes you have to wait. Each refusal is written to the security log.

## Require it for your team

An owner can require two-factor sign-in by role:

1. Open **Settings → Security**.
2. Tick the roles that must use it: owners, admins, agents and collaborators.
3. Choose **Save policy**. HappyToHelp asks you to confirm with your own second
   factor first.

Teammates in those roles who have not set it up are signed out at once. At their
next sign-in they set it up before they can see anything. The **Teammates** table
shows who has it on.

**Reset a teammate's two-factor** (owners only), for example when they lose their
phone: **Settings → Security**, then **Reset two-factor** on their row. It needs
your own recent second factor. Their apps, passkeys and recovery codes are
removed, they are signed out everywhere and emailed, and the reset is logged.

## Confirming it is you

Exports, contact erasure, role changes, inviting an admin or owner (and copying or
resending their invitation link), installing integrations and credentials (API
tokens, webhooks, Slack, GitHub, paired computers, connected applications, side
panel plugins, a two-factor app or passkey, including your first, and setting a
password on an account that has none), changing your sign-in email,
deleting a workspace and changing the two-factor policy ask you to confirm it is
you if you have not done so in the last 15 minutes. With two-factor on, you
confirm with your app, passkey or a recovery code; without it, with your
password. Accounts without a second factor also see **Email me a sign-in link**
in the dialog, beside the password when one exists. Open it in the same browser, press **Sign in**, then return to the
original tab and press **Continue**. Each link works once, expires after 15
minutes and proves only its account in the fresh sign-in session. Requests are
rate-limited and logged; requesting mail supplies no proof. An enrolled second
factor is still required.

On **Profile → Security**, an account without a password sees **Set a password**,
with no current-password field. An existing account can choose **Confirm by email
to set a password**; after recent mailbox confirmation, it shows **Set a new
password** without the old password. This covers older email claims and passwords
a teammate never chose, while preserving every existing credential until its
owner replaces it. Saving requires recent mailbox or factor proof
and signs out the account’s sessions. Five wrong answers in 15 minutes, whether a
code or a password (also when changing your password), lock that check for the
rest of the 15 minutes.
Refund and billing approvals will ask the same when they arrive.

## Roles

**Settings → Roles** lists what each role may do.

| Role | Can |
| --- | --- |
| Owner | Everything, including managing owners and admins, the two-factor policy, retention and legal holds |
| Admin | Everything except what only owners do |
| Agent | Reply, add notes, follow, assign and resolve conversations, edit contacts, write and publish help articles, view reports |
| Collaborator | Read conversations, add internal notes and follow conversations. Cannot reply to customers, change conversations, read reports or change anything else |

Invite someone as a **Collaborator** from **Settings → Agents → Invite Agent**.
They see a conversation with an **Add internal note** button where the reply box
would be. Email they send to the support address never posts as a reply.
Conversations are not assigned to collaborators.

### Custom roles

A custom role starts from Agent, Collaborator or Admin and leaves out what that
teammate should not do, for example an agent who must not publish help articles
or export data:

1. **Settings → Roles → New role**.
2. Name it, choose what it is based on, and untick what it should not do.
3. **Create role**, then give it to a teammate on **Settings → Agents** (open the
   teammate and choose the role).

A custom role can never do more than the role it is based on. Changes apply on the
teammate's next click. A refused action tells them which permission they lack, and
the refusal is logged.

## Security log

**Settings → Security log** (owners and admins) lists sign-ins and refusals,
two-factor changes, role and member changes, invitations, imports, exports,
erasure, assignments and approvals, with who did it, through which door, when
and the result. Entries cannot be edited.

- **Filter** by kind and dates, and **Export CSV** or **Export JSON**. An export
  asks you to confirm it is you and is itself logged.
- **Retention**: an owner chooses how long entries are kept (90 days to 7 years,
  or forever, the default). Older entries are removed once a day, and each removal
  is logged with how many were removed.
- **Legal holds**: an owner can hold every entry in a period, whatever the
  retention, until they release the hold. Held entries are marked in the list.

Names are shown as they are now. A person whose account is gone shows as a
former teammate; the entry itself stays.

## Owner recovery

An owner who loses every factor and every recovery code recovers through the
installation, never by email alone:

- **Your own computer:** `rer dev` signs the owner in directly. Remove the old
  factors from the **Security** tab and add new ones.
- **A deployed installation:** whoever deployed it sets a one-time recovery key of
  at least 32 characters, then the owner opens `/owner-recovery`:

  ```sh
  H2H_OWNER_RECOVERY_KEY=<a long random value> rer deploy --environment production --set-secret H2H_OWNER_RECOVERY_KEY
  ```

  On `/owner-recovery`, enter the owner email, password and that key. The owner's
  factors and recovery codes are removed, every session ends, and you are signed
  in to set up a new factor. Each key value works once; set a new one for another
  recovery. The recovery is logged in every workspace the owner belongs to.

Notes-only collaborators cannot open native knowledge management, source text,
search, draft or translation/history endpoints. These reads require knowledge
editing permission for a custom role. Published help remains available through
its ordinary audience-controlled help-center doors. This conservative default
keeps restricted knowledge out of notes-only seats while separate knowledge
reading permissions remain undefined. It does not supply enterprise SSO or SCIM.
