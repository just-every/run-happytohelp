# Connected applications

A connected application is another app you run that may read some of a
HappyToHelp workspace, but only after a person in that workspace approves it.
Today that app is **Slate**, the open-source team wiki made alongside
HappyToHelp ([github.com/just-every/run-slate](https://github.com/just-every/run-slate)).
Connected, a specialist can start an investigation from a conversation, Slate
reads that conversation and your help articles, and it can correct an outdated
help article. Customer replies always stay in HappyToHelp: Slate never answers a
customer.

You do not need this to use HappyToHelp. Set it up only if you run Slate.

## Connect Slate

1. In HappyToHelp, open **Settings → Advanced → Connected applications** for the
   workspace. Owners and admins can register applications.
2. Check the workspace name in the Slate instructions, then open
   **Developer values** and select **Copy**. Paste the three values into Slate's
   settings:

   ```sh
   HAPPYTOHELP_DELEGATION_ORIGIN=https://support.example.com
   HAPPYTOHELP_DELEGATION_ACCOUNT_ID=your-workspace-id
   HAPPYTOHELP_DELEGATION_CLIENT_ID=slate
   ```

   `HAPPYTOHELP_DELEGATION_ORIGIN` is your HappyToHelp address and
   `HAPPYTOHELP_DELEGATION_ACCOUNT_ID` is the exact workspace ID from
   **Developer values**. On your own computer these go in Slate's `.dev.vars` with a `SLATE_` prefix
   (`SLATE_HAPPYTOHELP_DELEGATION_ORIGIN=…`).
3. Register Slate under **Registered applications** with the fields below and
   choose **Register client**.
4. In Slate, start the connection. HappyToHelp opens **Connect to Slate**, which
   lists the records Slate asks for and what it may do with them. Choose
   **Allow selected access**, or **Cancel**.

Access lasts 30 days. It is listed under **Access you have granted**, where
**Revoke** stops it immediately.

## The fields

| Field | What it is | Example |
|---|---|---|
| **Client identifier** | A short name you choose for the application. Slate's `HAPPYTOHELP_DELEGATION_CLIENT_ID` must be the same. | `slate` |
| **Slate origin** | The address you open Slate at, with nothing after the host. | `https://wiki.example.com` |
| **Exact callback URL** | The page HappyToHelp sends you back to after you approve, so Slate learns it may connect. It must be on the address above and match Slate's own setting character for character. For Slate it is the Slate address followed by `/api/connectors/oauth/happytohelp/callback`. | `https://wiki.example.com/api/connectors/oauth/happytohelp/callback` |
| **Allow loopback development** | Accepts plain `http://` addresses on `localhost` and `127.0.0.1`, for trying Slate on the same computer with `rer dev`. Leave it off for a Slate on the internet, which must use `https://`. | `http://127.0.0.1:8787` |

A registered callback address cannot be edited: register the application again
under a new identifier if it changes.

## What Slate may read and change

The approval screen lists the exact conversations and articles a request
covers. The permissions an application can ask for are:

| Permission | Lets the application |
|---|---|
| Read support conversations | read the selected conversations |
| Read help articles | read the selected help articles |
| Edit help articles | change the selected articles |
| Publish help articles | publish those changes |

No connected application can send support replies, change customer accounts or
turn on sign-in services. Owners, admins and agents of the workspace can approve
a request; each approval covers only what it lists.
