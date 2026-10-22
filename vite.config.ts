import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { archiveOutputGuard } from '@runeditrun/rer/archive-output'
import { reproducibleOutput } from './scripts/delivery/reproducible-output.ts'
import { workspaceModulePreloads } from './scripts/delivery/module-preloads.ts'
import { replyIconAssets } from './scripts/delivery/reply-icons.ts'
import { buildInputs } from './scripts/delivery/build-inputs.ts'
import { docsSite } from './src/ui/docs/build/plugin.ts'
import {widgetDevAsset} from './scripts/widget-dev-asset'
import { demoSockets } from './src/vendor/base/modules/demo/vite.mjs'

// `rer demo` switches reach only the vite dev entry, never a build.
const local = (name: string) => process.env[name] ? { [name]: process.env[name] } : {}

// Projects and the other signed-in pages already import WorkspacePages. Keep
// that frame with the inbox working set so genuine workspace startup loads it
// once. Page-specific CRUD code, the Markdown editor, transcript UI and timezone
// data stay separate; the manifest preloads each selected page's dependencies.
// DashboardClient is deliberately absent: its current eager route import also
// belongs to the public entry graph and must never bring the inbox with it.
const workspaceCoreModules = new Set([
 'native/WorkspacePages.jsx',
 'dashboard/components/conversation/ai-controls.css',
 'native/InboxPage.jsx',
 'native/Moment.jsx',
 'dashboard/contexts/ChatContext.jsx',
 'dashboard/components/Chat.jsx',
 'dashboard/components/ConversationsList.jsx',
 'dashboard/components/ConversationItem.jsx',
 'dashboard/components/conversationListPagination.jsx',
 'dashboard/components/DelegationPairing.jsx',
 'dashboard/components/DelegationCopyButton.jsx',
 'dashboard/components/DelegationDevices.jsx',
 'dashboard/components/Avatar.jsx',
 'dashboard/components/AgentAvatar.jsx',
 'dashboard/components/ContactAvatar.jsx',
 'dashboard/components/InboxViews.jsx',
 'dashboard/components/includes/TimeFormat.jsx',
 'dashboard/hooks/useInboxRoute.jsx',
 'dashboard/hooks/useLiveInboxLocation.jsx',
 'dashboard/hooks/useScrollEdge.jsx',
 'dashboard/hooks/useInboxRefresh.jsx',
 'dashboard/hooks/useConversationList.jsx',
 'dashboard/hooks/useTranscriptEvents.jsx',
 'dashboard/hooks/usePluginMessageEvent.jsx',
 'dashboard/hooks/replySuggestionLifecycle.jsx',
 'dashboard/utils/inboxRefreshScheduler.js',
 'dashboard/utils/transcriptMessages.js',
 'dashboard/utils/formatCompactCount.js',
 'dashboard/utils/localAgentSetup.js',
 'dashboard/styles/components/Avatar.scss',
 'dashboard/styles/components/ConversationItem.scss',
]);

// Messages, suggestions, events and article previews share this renderer and
// parser dependency graph. Load it with signed-in startup, without bringing in
// the article editor itself. Public Markdown rendering runs on the server and
// is outside this client-only chunk configuration.
const workspaceRichTextPackages = new Set([
 'react-markdown', 'remark-parse', 'remark-rehype', 'remark-gfm', 'remark-external-links',
 'unified', 'vfile', 'vfile-message', 'trough', 'bail',
 'mdast-util-from-markdown', 'mdast-util-to-string', 'mdast-util-to-hast', 'mdast-util-definitions',
 'mdast-util-to-markdown', 'mdast-util-find-and-replace', 'mdast-util-gfm',
 'mdast-util-gfm-autolink-literal', 'mdast-util-gfm-strikethrough',
 'mdast-util-gfm-table', 'mdast-util-gfm-task-list-item',
 'micromark', 'micromark-extension-gfm', 'micromark-extension-gfm-autolink-literal',
 'micromark-extension-gfm-strikethrough', 'micromark-extension-gfm-table',
 'micromark-extension-gfm-tagfilter', 'micromark-extension-gfm-task-list-item',
 'unist-builder', 'unist-util-visit', 'unist-util-visit-parents', 'unist-util-is',
 'unist-util-generated', 'unist-util-position', 'unist-util-stringify-position',
 'parse-entities', 'character-entities', 'character-entities-legacy', 'character-reference-invalid',
 'is-alphanumerical', 'is-alphabetical', 'is-decimal', 'is-hexadecimal', 'is-absolute-url',
 'comma-separated-tokens', 'space-separated-tokens', 'property-information',
 'style-to-object', 'inline-style-parser', 'mdurl', 'markdown-table',
 'ccount', 'longest-streak', 'repeat-string', 'zwitch', 'escape-string-regexp',
 'extend', 'xtend', 'is-buffer', 'is-plain-obj', 'debug', 'ms',
]);

// The transcript body and its static row/group renderers mount together. Keep
// that working set with the detail route instead of a second ConversationBody
// asset; shared avatars, Markdown and date/time libraries keep their own groups.
const conversationBodyModules = new Set([
 'dashboard/components/ConversationBody.jsx',
 'dashboard/components/BucketGroup.jsx',
 'dashboard/components/Bucket.jsx',
 'dashboard/components/TranscriptMessageRun.jsx',
 'dashboard/components/ItemGroup.jsx',
 'dashboard/components/EventGroup.jsx',
 'dashboard/components/EventItem.jsx',
 'dashboard/components/MessageItem.jsx',
 'dashboard/components/MessageTimestamp.jsx',
 'dashboard/components/MessageMailStatus.jsx',
 'dashboard/components/Media.jsx',
 'dashboard/components/LocalAgentBadge.jsx',
 'dashboard/components/LocalAgentAvatar.jsx',
 'dashboard/components/TranscriptEventContent.jsx',
 'dashboard/components/transcriptActorPalette.jsx',
 'dashboard/utils/transcriptGrouping.js',
 'dashboard/utils/transcriptMessageRuns.js',
 'native/MessageCitations.jsx',
]);

// Keep small data/brand helpers separate from signed-in UI. In particular,
// initial-inbox-list imports the pure view definitions, so neither can live in
// workspace-core without making public pages download the signed-in inbox.
const sharedRuntimeModules = new Set([
 'native/initial-inbox-list.js',
 'native/initial-inbox-reads.js',
 'native/initial-workspace-reads.js',
 'dashboard/components/inboxViewDefinitions.jsx',
 'dashboard/components/navigationInboxBadge.jsx',
 'homepage/drawings/Sparks.tsx',
]);

function runtimeModule(moduleId: string) {
 const path = moduleId.replaceAll('\\', '/').split('?')[0];
 // These shared React utilities must not inherit an optional consumer's large
 // icon catalog merely because their automatic chunk has the same consumers.
 return /\/node_modules\/(?:@tanstack\/|react\/|react-dom\/|scheduler\/|prop-types\/|react-is\/)/.test(path)
  || sharedRuntimeModules.has(path.split('/src/ui/')[1]);
}

// Keep a matched route's small wrapper with its page. Start preloads the route
// chunk's direct imports, so this also discovers the page dependencies in HTML.
function workspaceChunk(moduleId: string) {
 const id = moduleId.replaceAll('\\', '/');
 const path = id.split('?')[0];
 if (path === '\0virtual:happytohelp-reply-icons') return 'reply-icons';
 if (path.includes('/src/routes/') && id.includes('tsr-split=')) {
  if (/conversations_\.\$conversationId\.jsx$/.test(path)) return 'conversation';
  if (/conversations\.jsx$/.test(path)) return 'workspace-core';
  if (/\.(?:contacts|macros|agents)\.jsx$/.test(path)) return 'management';
  if (/\.articles\.jsx$/.test(path)) return 'knowledge';
  if (/\.reports\.jsx$/.test(path)) return 'reports';
  if (/\.settings\.jsx$/.test(path)) return 'project-settings';
  if (/\.projects\.jsx$/.test(path)) return 'projects';
 }
 // Preserve the complete catalog for conversations and the lazy article editor,
 // without making inboxes or other pages load its JSON through shared utilities.
 if (/\/src\/ui\/dashboard\/components\/reply-icons\//.test(path)) return 'reply-icons';
 if (workspaceCoreModules.has(path.split('/src/ui/')[1])) return 'workspace-core';
 const packageName = path.split('/node_modules/').at(-1)?.split('/')[0];
 if (packageName && workspaceRichTextPackages.has(packageName)) return 'workspace-core';
 if (/\/src\/ui\/dashboard\/components\/avatar-symbols\//.test(path)) return 'workspace-core';
 // Shared workspace controls, notices and their styles belong to the same
 // signed-in frame. None imports an editor or a complete workspace page.
 if (/\/src\/ui\/(?:native\/(?:PageHeader|pages\/(?:forms|AdminRecords|WorkspaceNotices|AvatarUpload|delete-copy|stack-table)|activation\/(?:ProviderSetupNotice|provider-setup-notice))|dashboard\/components\/(?:dialogTabBoundary|DelegationDeviceSettings))\./.test(path)) return 'workspace-core';
 // These libraries already serve the list's dates, avatars and scrolling. Do
 // not recurse through application imports or include conversation-only tools.
 if (/\/node_modules\/(?:moment|initials|khroma|css-color-names|use-window-focus|react-infinite-scroll-hook|react-intersection-observer-hook|@fortawesome\/(?:fontawesome-svg-core|free-solid-svg-icons|react-fontawesome))\//.test(path)) return 'workspace-core';
 if (conversationBodyModules.has(path.split('/src/ui/')[1])) return 'conversation';
 if (/\/node_modules\/react-scroll-to-bottom\//.test(path)) return 'conversation';
 if (/\/src\/ui\/dashboard\/components\/(?:Conversation\.jsx$|NoteModal\.jsx$|conversation\/)/.test(path)) return 'conversation';
 // These small, scoped transcript styles share the signed-in stylesheet. This
 // avoids a second render-blocking CSS request when opening a conversation.
 if (/\/src\/ui\/dashboard\/styles\/components\/(?:Conversation|ConversationForm|ConversationHeader|MessageItem|Bucket|BucketGroup)\.scss$/.test(path)) return 'workspace-core';
 if (/\/src\/ui\/native\/pages\/(?:KnowledgePage\.jsx$|knowledge\/)/.test(path)) return 'knowledge';
 const page = path.match(/\/src\/ui\/native\/pages\/(ManagementPage|Reports|ProjectSettings|ProjectsPage)\.jsx$/)?.[1];
 return page ? ({ ManagementPage: 'management', Reports: 'reports', ProjectSettings: 'project-settings', ProjectsPage: 'projects' } as Record<string, string>)[page] : null;
}

export default defineConfig(({ command, isPreview }) => {
 const localOrigin = command === 'serve' && !isPreview ? process.env.RER_DEV_ORIGIN : undefined;
 if(localOrigin && (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(localOrigin)))throw Error('Unsafe local development origin');
 return {
 define: { 'import.meta.env.RER_LOCAL_ORIGIN': JSON.stringify(localOrigin) },
 // The runtime and common controls are needed together. Separate tiny helper
 // chunks add network waves to cold signed-in navigation.
 environments: { client: { build: { rolldownOptions: { output: {
  strictExecutionOrder: true,
  codeSplitting: { groups: [
   { name: 'runtime', test: runtimeModule },
   { name: 'controls', test: /node_modules[\/](?:react-bootstrap[\/]|react-transition-group[\/]|dom-helpers[\/]|@restart[\/])/ },
   { name: workspaceChunk, includeDependenciesRecursively: false },
  ] },
 } } } } },
 server: {
  host: '127.0.0.1', allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
  fs: {
   allow: ['src', 'public', 'node_modules', 'package.json', 'local-agent/lib/provider-error.mjs'],
   deny: ['**/.rer/**', '**/.seed/**', '**/exports/**', '**/*.rer'],
  },
 },
 plugins: [demoSockets(),buildInputs(),widgetDevAsset(localOrigin),replyIconAssets(),{
  name: 'connector-download-headers',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] === '/downloads/happytohelp-local-agent.tar.gz') {
        // Vite treats .gz files as HTTP-compressed content. This is a gzip
        // download: preserve its bytes for the connector's tar -xzf command.
        res.setHeader('Content-Type', 'application/gzip')
        res.setHeader('Content-Encoding', 'identity')
      }
      next()
    })
  },
}, cloudflare({ ...(localOrigin?{config:{main:'src/dev/server.ts',vars:{RER_DEV_KEY:process.env.RER_DEV_KEY||'',RER_DEV_IDENTITY:process.env.RER_DEV_IDENTITY||'on',...local('RER_DEMO'),...local('RER_DEMO_EXPIRES')}}}:{}), persistState: { path: process.env.RER_STATE_DIR ?? '.wrangler/state' }, remoteBindings: false, configPath: process.env.H2H_WRANGLER_CONFIG, viteEnvironment: { name: 'ssr' } }), docsSite(), tanstackStart(), react(), workspaceModulePreloads(), reproducibleOutput(), archiveOutputGuard()] };
})
