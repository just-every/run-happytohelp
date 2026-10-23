# Local agent

The local agent lets you hand a support conversation to **Codex** or **Claude**
running on a computer you control. From a conversation in HappyToHelp you
delegate a task, such as "find out why this customer's order failed". The agent
on your computer picks it up, does the work with the tools on that computer, and
sends back a report for you to review. You stay in charge: it only does what you
approved, and it never sends a customer a reply by itself.

This page is for anyone on your team who wants to connect a computer. It shows
how to set the agent up, send it a first task, keep it running, use it from a
desktop app you already have open, and disconnect it.

A few words this page uses:

- **Local agent**: the small Node.js program you install on your computer. Its
  command is `h2h-local`.
- **Standalone worker**: the dashboard's name for the local agent while it runs
  in a terminal window, waiting for tasks (started with `start`). Keep that
  window open. This page also calls it the *worker*. It is not the Cloudflare
  Worker that runs HappyToHelp itself.
- **Pairing**: the link between your computer and a HappyToHelp workspace,
  made once with a single-use code. Once paired, the computer appears under
  **Paired computers**.
- **Config file**: where the pairing is saved on your computer. The
  `H2H_LOCAL_CONFIG` environment variable points to it.
- **Task**: a piece of work you delegate from a conversation. The agent's
  commands and tools also call it an *assignment* or a *job*; all three mean the
  same thing.
- **MCP**: the Model Context Protocol, the standard way desktop AI apps such as
  Codex and Claude load extra tools.

The agent comes with no AI provider key and no stand-in browser automation: it
uses the Codex or Claude on your computer, and if something it needs is missing,
it stops and tells you.

## What you need

- A running HappyToHelp installation (see [Install](../docs/INSTALLER.md)).
- A terminal on Mac, Linux or WSL, with `curl` and `tar` (the setup command uses
  them to download the agent).
- Node.js 20 or later. This is separate from the newer Node.js that HappyToHelp
  itself needs: the agent runs on whichever computer does the support work. The
  agent has no package dependencies, so there is no global install and no
  `npm install`.
- One AI runtime on the same computer:
  - **Codex** (recommended, and the default): the Codex CLI, signed in with
    `codex login`. Codex signs in with your own ChatGPT account or OpenAI API
    key, and OpenAI bills that use under your account.
  - **Claude**: Claude Code, plus an Anthropic API key in `ANTHROPIC_API_KEY`
    in the terminal that runs the worker. The worker can't use a Claude
    subscription login, so its use is billed to that API key. If you'd rather
    use your Claude subscription, use a Claude desktop session instead (see
    [Use Claude instead of Codex](#use-claude-instead-of-codex)).

HappyToHelp doesn't charge for any of this.

Each pairing belongs to the workspace you set it up from, and it receives tasks
only while you still have access to that workspace. To use the same computer
with another workspace, set it up again from that workspace; its commands use a
separate config file.

There is also a second route. In a conversation, the **Connect task** button
connects HappyToHelp to a Codex task that will handle support work, and that
connection can work across every workspace you can access. This page covers the
other route: pairing a computer that runs the local agent.

## Connect a computer with Codex

1. In HappyToHelp, open **Local computers** in your workspace menu and choose
   **Connect computer**. This opens **Set up a standalone worker**. (You can
   also reach it from a conversation: **Use a standalone worker instead**, then
   **Set up standalone worker**.)
2. Under **Choose an app**, pick **Codex** and give the computer a name.
3. Choose **Generate setup command**, then **Copy setup command**. The pairing
   code inside it works once and expires after 10 minutes; if it runs out,
   choose **Generate a new code**.
4. Open a terminal on the computer, paste the block, press Enter, and leave the
   window open.

The setup block:

1. checks that Node.js 20 or later and Codex are installed;
2. downloads the agent from your own HappyToHelp installation
   (`<your HappyToHelp address>/downloads/happytohelp-local-agent.tar.gz`) and
   unpacks it into `~/.local/share/happytohelp-local-agent`;
3. saves the pairing in its own private config file for this computer, pairs,
   and starts the worker.

The end of the block looks like this. The dashboard fills in your real server,
pairing code and computer name, and names the config file after your
workspace's ID (this page uses `SUPPORT-MAC.json` as an example):

```sh
H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" \
node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" start \
  --server https://support.example.com \
  --code PAIRING_CODE \
  --provider codex \
  --name "Mina’s support Mac"
```

Codex is the default, so `--provider codex` is optional.

### If Codex isn't signed in

Before it uses the pairing code, and again before it reports that it is ready,
the agent runs `codex login status`. If Codex isn't signed in, it stops without
using up the code. Sign in, then run the dashboard command again:

```sh
codex login
```

### When it's ready

The terminal prints **Ready** only once the worker has signed in to HappyToHelp
and registered as listening for tasks. The setup dialog then shows the computer
as ready for new work (choose **Check again** if it hasn't updated yet).

Keep that terminal open while you want the computer to take tasks. Press
`Ctrl+C` to stop the worker cleanly.

## Send your first task

1. Open a conversation and choose the **Local** tab beside it
   (**Work with your local agent**).
2. Under **New task**, pick the **Worker**: the computer that should do the
   work.
3. Choose the **Action**: **Investigate**, **Resolve** or **Resolve & reply**
   (see [What the agent may do](#what-the-agent-may-do)).
4. Write focused **Instructions**, such as "Find out why this customer's order
   failed", and press **Send task**. If that computer's worker isn't running,
   the button says **Queue task**, and the task waits until the worker starts.
5. Progress and the agent's report appear in the same tab.
6. If the agent drafted a reply, press **Use** to put it, with any attachments,
   into the reply box. Review it and press **Send** yourself.

## Start the worker again later

After the first setup, start the same paired worker with this shorter command.
The setup dialog shows it too (**Copy start command**), with your real config
file name:

```sh
H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" \
node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" start
```

`start` pairs only when that config file has no pairing yet. If you give it
pairing options (`--server`, `--code` and so on) for a config file that is
already paired, it stops and tells you how to resume or disconnect. It never
quietly replaces a computer's credential or a task in progress.

## Check status or disconnect

```sh
H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" \
node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" status

H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" \
node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" disconnect
```

**`status`** checks only what is on this computer: the saved configuration, the
AI runtime, and the browser (if you set one up). It lists any saved tasks. It
does not mark the computer online or tell you whether a worker is listening;
only `start` registers a worker, and HappyToHelp then shows it as ready.

**`disconnect`** deletes the saved credential from this computer. It does not
remove the computer from HappyToHelp. When the computer should no longer get
tasks, also revoke it in HappyToHelp: open **Manage paired computers** in the
setup dialog and choose **Revoke**.

## Use Claude instead of Codex

Choose Claude as the worker only if the terminal that runs it has
`ANTHROPIC_API_KEY` set. The agent runs Claude Code as
`claude -p --output-format stream-json` with `--bare`, gets structured results
back, and resumes the same Claude session ID when a task continues. It never
uses a Claude subscription login in place of the API key. A Claude desktop
session that is already signed in can work through MCP instead, using its own
sign-in; see the next section.

In the setup dialog, pick **Claude** under **Choose an app**. The direct command
looks like this:

```sh
H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" \
node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" start \
  --provider claude --server https://support.example.com --code PAIRING_CODE --name "Mina’s support Mac"
```

## Use an existing Codex or Claude desktop session

This route is for people who already work in a Codex or Claude desktop app. Use
it when that app is open on your desktop and you want it to take HappyToHelp
tasks with its own browser and computer tools. It doesn't start a new AI
session; tasks go to the session you already have, which works with its own
sign-in and its own permission settings.

### 1. Pair and register the MCP server

In the setup dialog, open **Use an existing Codex desktop session instead** (or
**Claude**, if you picked Claude) and choose **Copy session setup**. Run it in a
terminal. It installs the agent, pairs the computer with `connect` (which pairs
without starting a worker), and registers HappyToHelp as an MCP server in that
app.

To register the MCP server yourself, use the same config file as the pairing.
For Codex:

```sh
codex mcp add happytohelp-local \
  --env H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" -- \
  node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" mcp
```

For Claude Code, the server name (`happytohelp-local`) must come before
`--env`, because `--env` accepts several values:

```sh
claude mcp add happytohelp-local \
  --env H2H_LOCAL_CONFIG="$HOME/.config/happytohelp/SUPPORT-MAC.json" -- \
  node "$HOME/.local/share/happytohelp-local-agent/bin/h2h-local.mjs" mcp
```

### 2. Start it and ask the session to watch for tasks

Start the MCP server from your desktop app as you normally would. Loading it is
not enough to mark the computer ready: the session has to call a task tool such
as `h2h_wait_for_assignment`. A session that is sitting idle won't wake itself
up to check.

The setup dialog's **Copy watch instruction** gives you a short instruction to
paste into the session. The fuller version below is also text to paste into the
session, written for the AI rather than for you. It also covers parallel tasks,
folders, screenshots and replies. In it, *mapped folders* are the
**Local folder paths** you can set for the computer under **Local computers**:
optional suggestions for where the agent should start work.

```text
Use `h2h_wait_for_assignment` to watch HappyToHelp assignments. Keep every returned job ID and run ID separate: pass `job_id` to `h2h_context`, `h2h_progress`, `h2h_result`, `h2h_upload`, `h2h_input`, and `h2h_recover`. The session may claim independent jobs while capacity remains. Treat mapped folders as suggested starting locations, not a sandbox allowlist or a restriction: an empty or unavailable mapping is diagnostic, and repository work may still proceed elsewhere when the approved assignment and the desktop session's existing permissions allow it. Before mutating files, coordinate actual repository, worktree or branch, and file overlap with other active work; a shared suggested folder alone is not a lock. Use `h2h_upload` only for an absolute local PNG, JPEG, or GIF screenshot up to 4 MiB, then put its returned ID in result, reply, or follow-up `attachment_ids`; never submit a path or URL. Do not send customer replies directly. For `resolve_reply`, return one verified `reply_draft` and omit `replies` so HappyToHelp uses its authorized delivery path; otherwise use `replies` and `follow_up_actions` as operator proposals. If recovery is required, submit a `needs_input` result explaining the interruption, receive the operator's review with `h2h_input`, and call `h2h_recover` before taking any action.
```

### The tools the session gets

You don't call these yourself; the session uses them.

- `h2h_await`, also available as `h2h_wait_for_assignment`: wait briefly for a
  task and claim it.
- `h2h_claim`: claim the next task now. Calling it again can claim more
  independent tasks while the computer has capacity.
- `h2h_context`: read the context for one claimed task.
- `h2h_progress`: send a short progress update for a task.
- `h2h_result`: submit the final structured result for a task.
- `h2h_upload`: upload one screenshot (an absolute path to a local PNG, JPEG or
  GIF, up to 4 MiB) for a running task.
- `h2h_input`: read your answers, and whether the task was cancelled.
- `h2h_recover`: resume a task after an interruption, using a new instruction
  from you received through `h2h_input`.

When a new desktop session connects through MCP, it never quietly repeats work
that was handed to an earlier one. It needs a fresh recovery instruction from
you first.

## Give the worker a browser (optional)

A worker started with `start` or `run` (Codex or Claude) can also use a real
browser, through a browser MCP server such as Playwright MCP. This is useful
when a task needs a web page, for example to reproduce what a customer sees on
your site. It is off unless you set it up, and it is meant for people
comfortable with command-line setup. You need:

- `--browser-command` and one `--browser-arg` per argument, to start the browser
  MCP server.
- `--browser-profile`: a dedicated browser profile folder, given as an absolute
  path. The same folder must also appear in the browser arguments, and it keeps
  its data between runs.

For example, run this from the agent's folder
(`~/.local/share/happytohelp-local-agent`):

```sh
node bin/h2h-local.mjs connect \
  --server https://support.example.com \
  --code PAIRING_CODE \
  --provider codex \
  --name "Mina’s browser worker" \
  --browser-command npx \
  --browser-arg -y \
  --browser-arg @playwright/mcp@latest \
  --browser-arg --user-data-dir \
  --browser-arg "$HOME/.happytohelp-playwright-profile" \
  --browser-profile "$HOME/.happytohelp-playwright-profile"
```

This example uses `connect`, so it pairs without starting a worker. It doesn't
set `H2H_LOCAL_CONFIG`, so the pairing goes to the default config file,
`~/.config/happytohelp/local-agent.json` (or under `$XDG_CONFIG_HOME` if that is
set). Start the worker afterwards with `start` or `run`, using the same config
location.

When pairing, the agent starts the browser MCP server and checks that it starts
up and lists its browser tools. Only if that check passes does the computer
advertise browser support (`browser_mcp`) to HappyToHelp. If a browser is
configured but unhealthy, the worker won't take tasks at all. It never falls
back to a pretend browser or to working without one.

## Other commands

The setup block and `start` are all most people need. These remain for scripts
and advanced setups:

- `connect --server URL --code CODE --provider codex|claude --name NAME` pairs
  without starting a worker.
- `run [--once]` starts the worker for an existing pairing. With `--once`, it
  handles at most one task and then exits.
- `mcp` starts the MCP bridge over standard input and output, for a desktop app
  to load.
- `help` (or `--help`) prints the command summary.

## How the agent handles your work

### What the agent may do

You choose the **Action** each time you send a task:

- **Investigate**: read-only. It looks things up and reports what it found, with
  evidence.
- **Resolve**: it may make the changes your instructions authorise. It can
  propose a customer reply but not send it.
- **Resolve & reply**: it may make the authorised changes. Once the work is
  verified, HappyToHelp itself may deliver the single reply draft through its
  usual route.

### What it can reach on your computer

The action and your instructions tell the agent what it may do. What it can
technically reach depends on how it runs:

- **A Codex worker** runs Codex with full access to the computer and no approval
  prompts (Codex's `danger-full-access` sandbox setting). It can reach whatever
  your user account can: your files, command-line tools, and anything those are
  signed in to. Run it on a computer and user account where that is acceptable.
- **A Claude worker** runs Claude Code in its `dontAsk` permission mode, so it
  can't use tools that would need your approval, such as running commands or
  editing files. If you set up a browser, it can use those browser tools.
- **A desktop session** connected through MCP works with that session's own
  permissions and approval settings.

### In every mode

- Customer messages, attachments, notes and links are treated as information to
  check, never as instructions to follow.
- It stays within what you approved for that task, cannot send a customer reply
  itself, and must return a structured result backed by verified evidence.
- Independent read-only and browser-only tasks run in parallel. Tasks that
  change things on your computer run one at a time.
- If the Codex or Claude process dies after a task was handed to it, the saved
  task is marked uncertain and is never re-run automatically. Cancel it from
  HappyToHelp before you delegate a replacement.
- Claim and result IDs are saved before each request is sent, so a request whose
  response was lost can be retried safely.
- Proposed replies always need you to act on them. (Technical detail: Codex
  results always include every field, and unused reply, attachment and
  follow-up fields come back as empty strings or empty arrays. For Resolve &
  reply tasks, the agent treats an empty `replies` list as "no proposed
  replies", so HappyToHelp delivers the reply draft through its existing
  authorised route.)

## When an AI provider request fails

If the model provider behind Codex or Claude rejects or fails a request (since
version 0.3.0), the task fails and HappyToHelp keeps:

- the provider's HTTP status, but only when the runtime reports one explicitly
  (an error code on its own is never treated as an HTTP status), and
- a short, redacted excerpt of the error.

You can still see both after reloading the page. Raw error output (stderr),
request bodies and task context are never uploaded as diagnostics.

A failed task stays failed. Nothing retries it; to try again, you start another
task yourself.

## Troubleshooting

- **"Codex is not signed in"**: run `codex login`, then run the setup or start
  command again.
- **"No pairing is stored at this config location"**: `H2H_LOCAL_CONFIG` points to
  a file with no pairing. Check that it matches the file you paired with, or run
  the setup command from HappyToHelp.
- **"This config location is already paired"**: use the start command without
  pairing options, or run `disconnect` before pairing a replacement.
- **"A local worker or MCP server is already using this pairing"**: only one
  worker or MCP server can use a config file at a time. Stop the other one
  first.
- **"ANTHROPIC_API_KEY is required for the standalone Claude runner"**: set
  `ANTHROPIC_API_KEY` in the terminal that runs the Claude worker.
- **"Configured browser MCP is unhealthy"**: the browser you set up didn't pass
  its check, so the worker won't take tasks. `status` shows the browser as
  "needs attention", with the reason when there is one.
- **"Refusing to read insecure connector credential file"**: the config file can
  be read by other users on this computer. Make it readable only by you.
- **A task "has an uncertain in-flight local runtime"**: the AI process stopped
  mid-task. Cancel the task in HappyToHelp before delegating a replacement.


Task time authority is selected by the operator (1–15 minutes, including queue
time). The server records the named grant and never renews it on reconnect,
heartbeat or additional input. The direct runner requests a stop at the recorded
deadline and drops withdrawn work rather than replaying it. Expiry cannot prove
that a customer system or child process stopped, and never asserts recovery or
cancellation of an unknown external effect. A new task needs a new approval.
Mapped folders remain launch locations, not filesystem or production boundaries;
this deadline does not enforce data access, allowed production operations or fees.
