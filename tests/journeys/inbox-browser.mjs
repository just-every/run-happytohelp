import test from 'node:test'
import {outboundEntryBrowser,accountFormBrowser} from '../helpers/inbox/campaign-entry-browser.mjs'
import {ticketsBrowser} from '../helpers/inbox/tickets-browser.mjs'
import {inboxConversation} from '../helpers/inbox/inbox-conversation-browser.mjs'
import {inboxDefault} from '../helpers/inbox/inbox-default-browser.mjs'
import {mobileInbox} from '../helpers/inbox/mobile-inbox-browser.mjs'
import {navigation} from '../helpers/inbox/navigation-browser.mjs'
import {workspaceShell} from '../helpers/inbox/workspace-shell-browser.mjs'
import {managementLibrary} from '../helpers/inbox/management-library-browser.mjs'
import {pluginFrame} from '../helpers/inbox/plugin-frame-browser.mjs'
import {appearanceBrowser} from '../helpers/inbox/appearance-browser.mjs'
import {visualEdit} from '../helpers/inbox/visual-edit-browser.mjs'
import {visualHydration} from '../helpers/inbox/visual-hydration-browser.mjs'
import {noteBusyFocus} from '../helpers/inbox/note-busy-focus-browser.mjs'
import {panelResize} from '../helpers/inbox/conversation-panel-resize-browser.mjs'
import {uiBrowser} from '../helpers/inbox/ui-browser.mjs'
import {startMenu} from '../helpers/inbox/start-menu-browser.mjs'

// The operator dashboard in Chromium against the emitted Worker; each case starts its own installation.

test('a conversation in the inbox: live visitor messages, notes private to operators, typing, Markdown, media, drafts, participants and contact details at desktop and phone widths',inboxConversation)

test('the inbox opens on the right default view with status and assignment filters at 1440 and 390, and the phone inbox moves between list, conversation and panels',async()=>{await inboxDefault();await mobileInbox()})

test('navigation and the workspace shell: every destination, Settings menu and page heading, keyboard and phone navigation, and workspace switching',async()=>{await navigation();await workspaceShell()})

test('the management libraries: contacts, saved replies, assistants, plugins and members are listed, edited, validated and removed, with notification preferences, accessibly; a configured plugin frame commands only its own conversation from its own origin',async()=>{await managementLibrary();await pluginFrame()})

test('appearance settings save, reload, preview and publish into the widget and help center, and visual edits and hydration keep the application intact',async()=>{await appearanceBrowser();await visualEdit();await visualHydration()})

test('a busy internal note keeps focus and its draft, and the conversation panel resizes and remembers its width',async()=>{await noteBusyFocus();await panelResize()})

test('the dashboard reads and writes through the native transport with readiness, reply tools and dialogs at desktop and phone widths',uiBrowser)

test('ticket settings and ticket fields save through the dashboard at desktop and phone widths',ticketsBrowser)

test('operators configure private and public tickets and review service-notice outcomes at desktop and phone widths',outboundEntryBrowser)

test('account request forms keep anonymous choices private and prefill verified memberships at desktop and phone widths',accountFormBrowser)

test('the reply card\'s "+" start menu reaches every ticket action its role allows at 1440 and 390: an owner opens each dialog, a role without ticket management never sees Merge or Snooze, a collaborator sees only notes and follow, and a CC set there shows as a chip in the card',startMenu)
