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
