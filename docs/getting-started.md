# Get started with HappyToHelp

Paste this line into your terminal to install the latest published HappyToHelp release.

```sh
(repo=https://github.com/just-every/run-happytohelp; tag=$(curl -fsS -o /dev/null -w '%{redirect_url}\n' "$repo/releases/latest" | sed -nE 's|^.*/releases/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$|\1|p'); test -n "$tag" || { echo 'No published HappyToHelp release found with a vX.Y.Z tag.' >&2; exit 1; }; checkout=$(mktemp -d ./.happytohelp-release.XXXXXX) && trap 'rm -rf "$checkout"' EXIT && git -C "$checkout" init -q && git -C "$checkout" remote add origin "$repo" && git -C "$checkout" fetch -q --depth 1 --no-tags origin "refs/tags/${tag}:refs/tags/${tag}" && mkdir run-happytohelp && mv "$checkout/.git" run-happytohelp/.git && git -C run-happytohelp checkout -q --detach "refs/tags/$tag^{commit}") && cd run-happytohelp && curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev
```

macOS, Linux or Windows with WSL2. git is required; rer brings Node and pnpm.

The command gets HappyToHelp, installs its dependencies, prepares its database
and creates your local owner account.
A first local start usually takes about a minute. On a busy computer it can take
longer: `rer dev` prints progress every 20 seconds, with the limit to allow.
Wait for `RER_READY`, then open the `RER_OPEN` link to enter signed in and finish
your workspace setup.

This copy runs on your computer. Nobody else can open it, and it sends no email
until you configure a mail provider. No email or AI account is needed to begin.

## Already have Node?

With Node 22 or later, you can use this alternative:

```sh
(repo=https://github.com/just-every/run-happytohelp; tag=$(curl -fsS -o /dev/null -w '%{redirect_url}\n' "$repo/releases/latest" | sed -nE 's|^.*/releases/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$|\1|p'); test -n "$tag" || { echo 'No published HappyToHelp release found with a vX.Y.Z tag.' >&2; exit 1; }; checkout=$(mktemp -d ./.happytohelp-release.XXXXXX) && trap 'rm -rf "$checkout"' EXIT && git -C "$checkout" init -q && git -C "$checkout" remote add origin "$repo" && git -C "$checkout" fetch -q --depth 1 --no-tags origin "refs/tags/${tag}:refs/tags/${tag}" && mkdir run-happytohelp && mv "$checkout/.git" run-happytohelp/.git && git -C run-happytohelp checkout -q --detach "refs/tags/$tag^{commit}") && cd run-happytohelp && npx -y @runeditrun/rer dev
```

## Next time

Open the `run-happytohelp` checkout and run `rer dev` to reopen your copy.
If your shell can’t find `rer`, use `~/.local/bin/rer dev` from the checkout.
Run `~/.local/bin/rer cli path` for help adding it to your PATH.
If you started with npx, run `npx -y @runeditrun/rer dev` there.

### Restart after changing a local setting

If the start command returned you to the shell, open the `run-happytohelp`
checkout in your terminal and run `rer dev --stop && rer dev`. If you started
the app with `rer dev --foreground`, press Ctrl+C in that terminal, then run
`rer dev --foreground` again. Open the new `RER_OPEN` link after restart.

If the saved port is busy, rerun `rer dev` after that port is free. To move
this checkout to a free port, run `rer setup --port 8788` with a free port. To
move it to another host, run `rer setup --host 127.0.0.1` (or `localhost`, or
`::1`). Either move keeps your data, and plain `rer dev` follows the saved
address, so there is no need to pass `--host` on each start. A passkey belongs to
the host it was made on: after moving hosts, add a new one. See the
[local command reference](../RUN-LOCALLY.md).

Continue with [first-run setup](SETUP-WORKFLOW.md) to connect your website and
try the customer widget. The [local command reference](../RUN-LOCALLY.md) covers
preview, export and recovery. For private setup answers and contributor options,
use the [advanced installation reference](INSTALLER.md#private-setup-answers).

For help getting started, use **Contact support in chat** in the app’s Help Center.
