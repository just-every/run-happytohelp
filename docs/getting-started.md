# Get started with HappyToHelp

Paste this line into your terminal:

<!-- rer:start -->
```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp
```
<!-- /rer:start -->

<!-- rer:requirements -->
macOS, Linux or Windows with WSL2. git is required; rer brings Node and pnpm.
<!-- /rer:requirements -->

The command gets HappyToHelp, installs its dependencies, prepares its database
and creates your local owner account. The first start takes a few minutes.
Wait for `RER_READY`, then open the `RER_OPEN` link to enter signed in and finish
your workspace setup.

This copy runs on your computer. Nobody else can open it, and it sends no email
until you configure a mail provider. No email or AI account is needed to begin.

## Already have Node?

With Node 22 or later, you can use this alternative:

<!-- rer:alternative -->
```sh
npx -y @runeditrun/rer dev just-every/run-happytohelp
```
<!-- /rer:alternative -->

## Next time

Run the same start line from the same folder to reopen your copy. For a server
you can stop with Ctrl+C, use `rer dev --foreground` from the checkout.

Continue with [first-run setup](SETUP-WORKFLOW.md) to connect your website and
try the customer widget. The [local command reference](../RUN-LOCALLY.md) covers
preview, export and recovery. For private setup answers and contributor options,
use the [advanced installation reference](INSTALLER.md#private-setup-answers).
