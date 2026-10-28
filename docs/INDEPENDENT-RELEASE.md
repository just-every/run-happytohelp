# Updates, backups and recovery

This page is for whoever looks after a HappyToHelp installation. It shows how to
keep a running installation safe: update it, back up and restore its data, build
its release package yourself and share its source.

It also sums up where an installation can run and how HappyToHelp is licensed.

## Each installation stands alone

Every HappyToHelp installation is independent. It does not need:

- a HappyToHelp company account
- a shared database
- a checkout of the original HappyToHelp application's source (this open-source
  project is a new edition of that application)

The company's own service at happytohelp.com is separate from your
installation, and you don't need an account there.

Never copy another installation's secrets, resource names or customer data into
yours.

## Update your installation

Keep these, so you can always rebuild or roll back:

- your fork of the source
- the exact commit and release package (the build **artifact**) you accepted
- your own customizations
- your migration receipts (the record of which database migrations you applied)

For a checkout cloned from the public repository, stop dev or preview and back
up its state and private settings before updating. Keep your own commits and
merge public main into them:

```sh
git fetch origin main
git merge origin/main
pnpm install --frozen-lockfile
pnpm exec rer build
pnpm exec rer deploy --dry-run
```

These commands use Node **22.20.0** and pnpm **10.12.4**. If `origin` is your own
fork, fetch the public repository through your upstream remote and merge that
remote's main instead. Resolve conflicts while retaining your customizations.
The current package-mode instructions require current public source; the
older `v0.4.1` tag does not contain this command-package conversion.

The build and today's deployment dry run preserve local data and private
settings and make no deployment. The dry run validates and builds locally with
zero provider requests, with or without Cloudflare credentials. It explicitly
reports no provider requests, mail or deployment and returns
`providerChecked: false`. Remote resources, credential validity and existing
secret bindings remain unchecked; the dry-run does not establish target
readiness or qualify real provisioning. See
[deployment prerequisites](../OPERATIONS.md#deploy-to-your-cloudflare-account).

NATIVE-001 requires a **zero-outbound dry-run** that explicitly reports no
outbound requests and needs no provider credentials. A separately started
**read-only provider preflight** requires owner consent and the owner's scoped
Cloudflare token, with its own acceptance limited to the account's Workers
subdomain and the Worker's settings and secret names (three GETs for an existing
Worker), no mail and no mutations. Neither step is a mock of the other. The
separate preflight remains unimplemented and unqualified. Remote provisioning
needs separate qualification. Do not reset or replace `.wrangler/state` during an
update.
Run setup with your existing owner and private answers to apply local migrations,
then start `pnpm exec rer dev --foreground`. For a hosted installation, apply the
reviewed update only through the owner-authorized deployment path.
[Upgrade an existing installation](../OPERATIONS.md#upgrade-an-existing-installation)
covers backup and rollback; [Upgrading from 0.3.x](../OPERATIONS.md#upgrading-from-03x)
covers retained owners and settings from the older local installer.

> [!IMPORTANT]
> Never overwrite SQL migrations that have already been applied, and never
> silently change the identities of the Cloudflare resources your installation
> is bound to (its D1 database, R2 bucket and queues).

## Back up your data

For a versioned portable archive containing D1 records, R2 bytes and metadata,
and the lossless conversation-state reconstruction, follow [Portable archive from
a hosted installation](../OPERATIONS.md#portable-archive-from-a-hosted-installation).
Keep every source writer stopped until that command completes. Restore into a
clean installation with `rer import`; sessions, provider credentials and execution
authority are excluded, and interrupted work stays inactive.

The separate SQL recovery procedure below also requires an R2 copy. Your data lives in two places: the D1 database (named `<prefix>-db`, where
`<prefix>` is your resource name) and the R2 file bucket (`<prefix>-files`). To
take a consistent backup:

1. Arrange a maintenance window and stop application traffic, scheduled jobs,
   queue consumers and every other writer, including inbound webhooks, imports
   and connected local agents. HappyToHelp has no built-in hosted pause switch;
   a quiet inbox alone does not stop background work. Keep these stopped until
   the helper has rebuilt search and you have finished the R2 copy below.
2. Export the D1 database with this checkout's helper and pinned Wrangler:

   ```sh
   node scripts/export-d1.mjs --database <prefix>-db --config wrangler.jsonc --remote --output private-backup.sql
   ```

3. For this SQL recovery path, copy every R2 object's metadata and bytes with
   a separate storage tool. A SQL file alone does not contain attachments. The
   portable archive command linked above includes both stores.
4. Write down any call to an outside service whose outcome you're unsure of,
   such as an email or AI reply that may or may not have gone out (HappyToHelp
   marks these as *uncertain*). Before you let HappyToHelp try one again, check
   with the provider what actually happened: restoring an old database must not
   repeat effects that already happened outside HappyToHelp.

Cloudflare [documents that export fails for databases containing virtual tables](https://developers.cloudflare.com/d1/best-practices/import-export-data/#known-limitations)
and recommends dropping them, exporting, then recreating them. It also says a
running export blocks database requests. Use the helper rather than plain
`wrangler d1 export` for this installation.

The helper reads the original `inbox_message_search` definition from
`sqlite_master` and checks that it is an FTS5 table backed by `messages`. Before
changing it, it writes the private recovery file described below. It then runs:

```sql
DROP TABLE IF EXISTS "inbox_message_search";
```

This removes only the derived search table and its FTS shadow tables. Message
rows, business tables and message-maintenance triggers stay in place. Search is
unavailable during the gap, and message writes can fail because those triggers
still reference the missing search table. The entire drop/export/rebuild
sequence spans separate requests; it is not an atomic transaction.

After Wrangler exports the remaining database, the helper recreates the search
table with its saved original `CREATE VIRTUAL TABLE` statement and runs:

```sql
INSERT INTO "inbox_message_search"("inbox_message_search") VALUES('rebuild');
```

The rebuild indexes the retained messages, including historical rows. The helper
attempts this restoration even when export fails. After successful restoration
it removes the recovery file, then appends the same original definition and
rebuild to the SQL backup, after the authoritative data. Accept the backup only
when the command exits successfully and prints **Private SQL backup written**.

For a local backup, first stop dev/preview with `rer dev --stop` or
`rer preview --stop`, then use `--local` in place of `--remote`. The helper
checks local process ownership and holds the checkout's operation lock. An
alternate local state directory can be selected with `--persist-to PATH`.
For a remote backup, the helper cannot enforce the maintenance window or check
that writers are stopped. Keep it in place through recovery if anything fails.

Before removing the cache, the helper writes a private
`private-backup.sql.search-index-recovery.sql` file beside the output. If an
interruption or restoration failure leaves it behind, keep writers stopped and
execute it against the same database and configuration, for example:

```sh
pnpm exec wrangler d1 execute <prefix>-db --config wrangler.jsonc --remote --file private-backup.sql.search-index-recovery.sql
```

The recovery file drops any partially recreated search table, recreates its
original definition and rebuilds it from `messages`. It is safe to rerun while
writers remain stopped. Use `--local` and the same `--persist-to` for local
recovery. After it succeeds, check index consistency against message content:

```sh
pnpm exec wrangler d1 execute <prefix>-db --config wrangler.jsonc --remote --command "INSERT INTO inbox_message_search(inbox_message_search,rank) VALUES('integrity-check',1);"
```

Then remove the recovery file and discard the interrupted SQL backup; export
again to a new filename. If no recovery file remains but export failed, discard
that SQL too: the index may have been restored before backup finalization
failed. Any failed export is incomplete and must not be restored. The helper
reserves new output/recovery files with private permissions and refuses to
overwrite an existing backup.

> [!WARNING]
> A raw D1 export contains credentials. Keep it private: it is not safe to pass
> around as is. Before you give a D1 export to anyone, run the cleaning script in
> [Restore from a backup](#restore-from-a-backup) on it first.

### What a D1 and R2 backup covers

Live conversations use a Cloudflare Durable Object called `ConversationSocket`.
It keeps no application data in Durable Object storage:

- transcripts and the queue of messages waiting to be replayed (the replay
  outbox) live in D1
- each open connection holds only a temporary position marker, so a new
  connection re-checks its access and replays what it missed from D1

A backup of D1 and R2 therefore holds all of your HappyToHelp data. It is not a
complete export of your Cloudflare account.

## Restore from a backup

1. Clean the export. Before importing **any** backup, run this script (it needs
   Python 3 with SQLite FTS5 support):

   ```sh
   python3 scripts/independent/delegation-backup.py private-backup.sql restore.sql
   ```

   Import only the resulting `restore.sql`. It keeps your application records,
   migration history and content-free receipts. It removes the dedicated
   delegation grants, code hashes and consent replay material that let a
   connected application act for a member. It preserves the validated original
   search definition, omits its derived shadow rows and appends the definition
   and rebuild after the retained data. Its SQL has no transaction wrappers,
   as D1 manages the import transaction.

2. Restore into fresh resources that you control. Preserve:
   - the migration history
   - the IDs in D1
   - roles and history
   - the bytes of every object
   - the `INTEGRATION_ENCRYPTION_KEY`, which stored integrations need

   Keep traffic and writers stopped on the destination. Import the cleaned SQL
   with `pnpm exec wrangler d1 execute <restore-db> --config <restore-config> --remote --file restore.sql`
   into an empty database, then restore the matching R2 bytes and metadata.
   Search is derived: the restore must recreate `inbox_message_search` with its
   saved definition and run the `rebuild` statement above after loading messages.
   Check search integrity with the command above against the destination; do
   not restore FTS shadow tables as ordinary application data. Reapplying an
   already recorded migration does not rebuild a missing index.

3. Export the restored data again with `node scripts/export-d1.mjs`, selecting
   the destination database/configuration and a new output filename. Compare
   its records and object hashes with your backup before you let traffic in.

4. Test that:
   - revoked access, and access from another workspace (foreign access), are
     still refused
   - the owner can sign in
   - conversations reload and search finds a known historical message
   - knowledge articles can be published
   - the widget's website origin check still works
   - website preview refuses access it should refuse

5. Keep the old resources until you have accepted the restore.

After a restore, every member who had connected Slate (an outside application
that members can connect under **Settings → Connected applications**) must
give consent again. Otherwise, normal sign-in sessions work as before.

## Where an installation can run

### On your computer

Start it with one line. You need **Node.js 22 or later** (with npm) and Git; check
with `node --version`.

```sh
npx -y @runeditrun/rer dev just-every/run-happytohelp
```

That clones HappyToHelp into `run-happytohelp`, provisions the checkout's own pinned
Node and pnpm, installs dependencies, sets up a local owner and starts the app. To
set it up without starting it, use `npx -y @runeditrun/rer setup just-every/run-happytohelp`.
Without Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp`
brings its own. To start it again later, run `cd run-happytohelp && rer dev`.

Dev uses its local address for the chat widget and generates a private owner
password. Wait for `RER_READY`, then open the `RER_OPEN` address to enter as the
real local owner and reach **Setup**. No private answers, email service or AI
account are needed. Use `rer dev --stop` from the checkout to stop the managed app.

See [Install](INSTALLER.md) for scripted private answers and
[contributor setup](../README.md#contributor-setup) for pnpm commands.

You do not need an email or AI account to set up the owner, hold conversations,
let visitors in through the widget, or answer from knowledge content you supply
yourself. Before you use any feature that needs an outside provider, configure
that provider explicitly (see [Operations](../OPERATIONS.md)). A feature
whose provider is missing returns an error, and the repository's provider tests
do not prove that a real provider works.

To hand support work to your own computer, use the local agent's pairing steps
([Local agent](../local-agent/README.md)).

### On your own Cloudflare account

Use `pnpm exec rer deploy --environment production` with the real
`deploy.json` declaration and private owner-account credentials.
[Deploy to your Cloudflare account](../OPERATIONS.md#deploy-to-your-cloudflare-account)
covers prerequisites, secret custody and health boundaries. Today's
pinned rer 0.2.77 `pnpm exec rer deploy --dry-run` combines local validation/build
with credentialed read-only Cloudflare GETs for the account's Workers subdomain
and the Worker's settings and secret names (three GETs for an existing Worker).
It refuses without Cloudflare credentials, validates supplied private mail inputs
and refuses a required secret neither held nor supplied; it sends no mail and
changes no provider resources. The required zero-outbound dry-run with an explicit
no-outbound report and the separately started, owner-consented read-only preflight
using the owner's scoped token remain an unbuilt, unproved split. The preflight's
own acceptance permits only those three GETs, no mail and no mutations; live
qualification remains separate.

**Website preview** lets owners and admins see their website with the chat
widget on it. It needs its own custom-domain origin (`PREVIEW_ORIGIN`), pointed
at the same Worker but separate from the origin where owners sign in
(`APP_ORIGIN`). Keep the two origins separate, keep the existing access checks
on each preview link (its scoped grant), and never serve previews on the owner
origin.

### Hosted by Run Edit Run

[Run Edit Run](https://runeditrun.com), a separate service, offers hosted
**Assisted** and **Managed** installations of HappyToHelp. If you host
HappyToHelp yourself, you can skip this section. These files describe
HappyToHelp to that service:

- `rer-project.json` is the project descriptor: the source repository, licence,
  deployment target, and the setup, build, verify and artifact commands. It
  deliberately records no revision; the service registers an exact 40-character
  source commit separately.
- `.github/workflows/rer-managed.yml` calls the service's trusted build workflow
  at a pinned commit. HappyToHelp's own commands that this build runs receive
  no deployment credentials; the delivery service does the publishing itself.
- `node scripts/independent/setup-build.mjs` prepares that build: it installs
  pnpm into `.rer-tools`, then the frozen application dependencies and Chromium.
  The trusted build provides Node but no global pnpm, so the build and verify
  commands put `.rer-tools/node_modules/.bin` first on `PATH` before running the
  package scripts.
- `management/` holds the integration profile the service adopts
  ([management/README.md](../management/README.md)).

A hosted installation needs a fresh, private `H2H_SETUP_TOKEN`. `rer deploy` uses it
once to claim the owner named by `OWNER_EMAIL`, then removes it; entering it at
`/setup` is recovery only. Creating the first owner closes setup permanently.

## Build the release package yourself

The **artifact** is the deployable package of your installation. You only need
it if you deliver builds yourself or want to check a published build. To build
it, run `pnpm exec rer build` or `pnpm exec rer verify`. Both run the pinned Base producer
(the packaging step, fixed to an exact upstream version) after Vite.

- The producer writes `delivery-artifact/happytohelp-worker-artifact.json`.
- A normal build first cleans only its own generated `delivery-artifact/`
  output. Run directly (`node scripts/delivery/build.mjs`), the producer
  refuses to overwrite an existing artifact.
- The manifest (schema 2) points to raw sidecar files in `payload/`, each with
  its SHA-256 and byte size. Keep and upload the **whole** directory.
- Private credential files and symlinks make packaging fail.
- Building an artifact does not deploy it.

The artifact carries:

- the exact SQL migrations and their digests
- the Worker modules
- the public assets
- the D1, R2 and queue bindings
- the `ConversationSocket` class and its migration
- the once-a-minute schedule
- the secret declarations
- the health contract

The artifact is byte-reproducible with the Node and pnpm versions declared in
`package.json`. Anyone can build the same commit and compare their SHA-256 with
a published artifact.

To run the artifact locally and check backup and restore, run
`node tests/journeys/restore.mjs` (see
[the export and restore journey](../tests/helpers/recovery/portable-journey.mjs)).

## Share the source without Git history

To give someone a clean copy of the source:

1. Commit the reviewed tree.
2. Run:

   ```sh
   node scripts/independent/source-snapshot.mjs /new/output-directory
   ```

   It writes a tar of the committed tree and a SHA-256 receipt, without `.git`.
3. Unpack the tar into a new directory, initialize a new repository there and
   commit the snapshot.

The maintainer command `pnpm run source:release` keeps history. It is meant for
the maintainers' own trusted release records, not for a clean public snapshot.

## Licence

The root [`LICENSE`](../LICENSE) (MIT) covers the whole repository, including
the homepage drawings and setup artwork. Keep `docs/licenses/` and third-party
package notices with any copy you redistribute; see
[SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md).
