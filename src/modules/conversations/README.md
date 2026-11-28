# Conversation source

The native admission writer and Durable Object socket are reusable source. A
consumer supplies its actor/project identity and persistent conversation/message
schema, then integrates its own authorization and reply policy. All writers use
conditional revision/frontier admission; retry identity includes immutable intent.
Persistent outbox/replay separates message commits from socket delivery.

Carry this directory, migrations0002/0004/0007 and its conversation tests as listed
in module.json. HTTP routes additionally import the edition's platform auth and
environment interfaces. Copying those routes without an equivalent integration is
not a complete adoption. Widget and autonomous AI reply policy are separate sources;
reviewed-send consumers keep their own mandatory approval rules.

Finalized AI messages carry server-resolved citations in `messages.citations_json`.
The model selects only public references issued to its generation. Admission
rechecks current publication identity and project visibility inside the same
atomic message/outbox/generation batch. Repeated commands return the committed
message, including after later source changes; they never regenerate it. REST
and socket replay read the same stored metadata. Widget/inbox anchors use only
that durable metadata, suppress provisional and erased links, and set noopener.

The operator project stream also carries workspace presence: a dashboard's `{type:'presence',idleMs}` reports are
folded per teammate into `operator_presence` (see `src/modules/management/README.md`); conversation streams keep their
per-conversation viewing and typing presence.

The built Worker serves compiled files from the asset binding and forwards application requests to a pool of
`http:<shard>` objects of the existing ConversationSocket class. The objects store no application state.
Each runs the full HTTP entry with the original URL, method, headers and body. Native admission, session checks,
help-host policy and rendering all execute there. The widget script also uses this path to produce its
installation-specific bytes and validator. Project and conversation sockets still terminate on their owning
objects; the Worker forwards them there directly, except on a configured custom help host, whose host policy runs
first in a pool object. Vite dev, the build renderer and a demo visitor's copy run the HTTP entry directly.

The minute Cron tick asks the `scheduled:pass` object of this class to run its due work
(`src/platform/scheduled-door.ts`), and the Queue consumer asks a `job:<type>:<id>` object to run each message's job
(`src/platform/job-door.ts`), for the same reason: the pass and a job cost more CPU than a Cron invocation or a Queue
delivery holds on Workers Free. Those objects also store nothing and hold no sockets.
