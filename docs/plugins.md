# Plugins

A plugin is a small web page of your own that HappyToHelp shows in the side
panel of every conversation, as its own section of the **Ticket** tab after **Customer**. Use one to show what
your other systems know about the customer (orders, plan, account status) next
to the chat, or to give your team buttons that write a reply for them.

## Add a plugin

1. Put your plugin page on any web host, for example
   `https://tools.example.com/happytohelp-plugin.html`. The example below is a
   complete page to start from.
2. In HappyToHelp open **Settings → Plugins** and choose **Add Custom Plugin**.
3. **Name** is the heading of the plugin's panel, for example `Order lookup`.
   **URL** is your page's address. Use `https://`; plain `http://` works only
   for a page on your own computer (`localhost` or `127.0.0.1`).
4. Choose **Add**, then open any conversation: your page loads in its side
   panel. A plugin sees the open conversation and its customer, so adding one,
   changing its URL or turning it back on asks you to
   [confirm it is you](account-security.md#confirming-it-is-you) if you have not
   in the last 15 minutes. **Move Up** and **Move Down** on the Plugins list set the order of
   several plugins.

Your page's server must allow being shown in a frame on your HappyToHelp
address: do not send `X-Frame-Options: DENY`, or a `Content-Security-Policy`
`frame-ancestors` that leaves your HappyToHelp address out. The frame allows
scripts, forms and your page's own cookies, so a page that needs your team to
sign in to your own system works as usual.

## How your page and HappyToHelp talk

They exchange browser messages (`postMessage`). Every message is an object
`{happytohelp: true, type, payload}`. Send yours to `window.parent` with your
HappyToHelp address as the target origin, and accept only messages whose
`event.origin` is that address.

Your page can send:

| `type` | `payload` | What happens |
|---|---|---|
| `getConversation` | none | HappyToHelp answers with `setConversation`. |
| `setMessageContent` | the reply text (up to 100,000 characters) | The text replaces what is in the reply box. Nothing reaches the customer until an agent presses Send. |
| `resolveConversation` | the open conversation's `id` | The conversation is closed, as if the agent chose Close. Only the conversation on screen can be closed. |
| `setHeight` | a number of pixels up to 4000, or a string such as `"240px"` | The panel takes that height (500 pixels until then). |

HappyToHelp sends:

| `type` | `payload` | When |
|---|---|---|
| `setConversation` | the open conversation as the inbox holds it, including its `id`, `project_id`, `resolved_at` and its `contact` (`name`, `email`, `metadata` and the customer's other details) | When your page asks, and each time the open conversation or its messages change. |
| `resolveConversation` | the closed conversation | After a conversation is closed. |
| `error` | `{command, message}` | When a command was refused, for example closing a conversation that is not on screen. |

## Example

Change `HAPPYTOHELP` to your HappyToHelp address (Settings → Plugins shows this
example with your address filled in), save it as an `.html` file on your host
and add its address as a plugin.

```html
<!doctype html>
<meta charset="utf-8">
<title>Order lookup</title>
<p id="who">Waiting for a conversation…</p>
<button id="reply">Suggest a reply</button>
<script>
const HAPPYTOHELP = 'https://support.example.com';
const send = (type, payload) => parent.postMessage({happytohelp: true, type, payload}, HAPPYTOHELP);
addEventListener('message', event => {
  if (event.origin !== HAPPYTOHELP || event.data?.happytohelp !== true) return;
  if (event.data.type === 'setConversation') {
    const contact = event.data.payload?.contact;
    document.getElementById('who').textContent = contact ? 'Talking with ' + (contact.name || contact.email || 'a visitor') : 'No conversation open';
  }
});
document.getElementById('reply').onclick = () => send('setMessageContent', 'Thanks for waiting! Your order is on its way.');
send('setHeight', 120);
send('getConversation');
</script>
```

The page shows who the open conversation is with, and its button puts a reply
in the reply box. From here, look the customer up in your own system with
`contact.email` and show what you find.

## What a plugin can and cannot do

A plugin sees the conversation on the agent's screen and acts only through the
four messages above, in that agent's browser. It gets no HappyToHelp
credentials and cannot send a message to the customer by itself. Anyone who can
open the conversation sees the plugin, so show only what every agent may see.
Removing a plugin from Settings → Plugins removes it from every conversation at
once.
