# Source structure and contact erasure

The identity index covers understood structural identities, not arbitrary text.
Every supplied field in a supported record is checked against the same finite
shape definitions used by review diagnostics. An unrecognized field at any
depth, an opaque value, a malformed type or an exhausted audit bound makes the
whole upload's identity index incomplete. Rejected records still participate
in this custody decision.

Before any contact erasure, incomplete uploads can be reviewed with explicit
omissions or rejections. At upload, every key and scalar value in the parts the
readers do not interpret is hashed whole, as an email (trimmed, lower case), an
external ID and a source ID, into a private index stored beside the original.
Erasing a contact removes an incomplete upload's private originals, extracted
files, plans and journals when its understood identities or that index hold
one of the erased contact's identities or known aliases. Other people's
uploads keep their custody. An incomplete upload without an index (older
custody, or an upload interrupted before its index was stored) is still fenced
by any erasure in its workspace. After any contact erasure, incomplete new
uploads are refused before private bytes are admitted. Matching is by whole
value only: the importer does not search inside text for email addresses,
whether in uninterpreted fields or in message, article, saved-reply, title or
name strings. Understood primitive text retains the documented mapping and
erasure behavior.

## Understood shapes

IDs use the vendor's reader constraints: Zendesk positive integer or canonical
positive decimal string; Intercom nonempty string up to 512 characters or a
nonnegative safe integer. Unix times must be nonnegative safe integers; ISO
times must be valid calendar timestamps with an explicit offset. Counts must
be nonnegative safe integers. Known type, role, channel and state fields must use
the supported structural values. Arrays are checked item by item. An object is
never accepted as a string through coercion.

| Record or container | Structural checks |
| --- | --- |
| All supported records | Source ID, type/kind strings and original timestamps; every additional field is classified. |
| Zendesk users | Name/email/external ID strings, role string, string tag array; custom fields are opaque. |
| Intercom contacts | Optional name/email/external ID strings; tag list object and each tag's ID/name/type; custom fields are opaque. A supplied non-null name of another type rejects contact mapping. |
| Zendesk tickets | Requester and optional assignee IDs, status/subject, string tag array, comments array, optional via object. |
| Zendesk comments | ID, author ID, explicit boolean visibility, original timestamp and string body/plain body. Attachment and metadata values are opaque. |
| Zendesk via | Channel string; source routing metadata is opaque. A malformed channel rejects conversation mapping. |
| Intercom conversations | Channel object, contact-list object and every participant, source object, parts-list object and every part, tag-list object, optional assignment IDs, state/title/subject. |
| Intercom source/parts | IDs, type/part-type strings, string bodies/subjects, part timestamps, author objects; attachments are opaque. Unknown fields on the source, part or list container are independently reported. |
| Recorded Intercom people | ID, optional type/name/email/external ID strings for participants and source/part authors, including historical staff. Known email and external aliases are linked to the source ID even if mapping rejects the conversation. |
| Zendesk macros | Title, timestamps, action array and each action's field/value. Reply values must be strings. Public-mode values must be booleans or the strings `true`/`false`. Other workflow action values and restrictions are opaque and never activated. |
| Intercom macros | Name, string HTML/plain body representations, ISO timestamps, visibility string, string channel array. Dynamic content remains rejected. |
| Articles | Title/body/publication values and timestamps; Zendesk audience-ID arrays check each ID. Intercom Markdown alternatives are string typed. Audience rules, translations, article tag/availability/scheduling metadata are opaque. Section/parent IDs are checked as IDs. |
| Derived tags | String names and understood common fields. Standalone vendor tag inventories remain unsupported. |
| Intercom envelopes | Known record collections, list-type string and numeric total count. Empty/null pagination objects contain no identity; nonempty pagination and malformed metadata become located unsupported decisions. |

Null is accepted only where explicitly nullable: optional contact or embedded
person name/email/external ID; body alternatives; ticket business type; optional subjects and tag
lists; optional assignment/section/parent/audience IDs; opaque optional fields;
and optional pagination. Required objects and arrays, their items and supplied
counts cannot be null. Mapping requirements still apply: for example, a null
email cannot create a contact, and Zendesk contact names are required. Missing
required identity containers make custody incomplete. A complete identity index
does not mean the record meets all mapping requirements.

## Records and document envelopes

Review and admission use the same document and record classification. An explicit
Intercom `type` or `kind` identifying a record takes precedence over sibling
collection names, regardless of their values or property order. This also applies
to unsupported record kinds: their whole record becomes a located omission. A
collection-shaped unknown field cannot turn a contact, conversation, macro or
article into an envelope or remove its understood identities.

Both supplied discriminators must be nonempty strings and must agree. Conflicting
or malformed discriminators are refused before private custody, with the exact
source line and JSON pointer. A list discriminator with a source `id` is ambiguous
and is refused. True list envelopes and untyped convenience collections accept
arrays; a null, scalar or object in a collection position is refused. JSONL lines
use the same lowering as JSON documents. Arrays and envelopes contain records,
not nested envelopes. Unknown envelope siblings retain their located omissions;
explicit typed records in those siblings keep their original kind, ID, payload and
native mapping as well as their known aliases. The unsupported parent receives
a located warning without adding a rejected input or a fabricated vendor ID.
Untyped envelope values receive a reasoned source-only decision only after a
bounded structural check finds no nested `type` or `kind` discriminator. If an
unknown object or array wraps an explicit record at any deeper level, the whole
upload is refused at that container with `unsupported_nested_envelope`. Unwrap
the records into a documented collection before uploading. This check does not
search string values for identities and never traverses an identified record
payload as if its authors, parts or other fields were independent records. It
uses at most 4,096 nodes per opaque position and 200,000 per upload, independently
of source-position, identity-extraction and diagnostic budgets. Exhaustion
refuses the upload. The same lowering also checks saved offsets on queue resume.
This applies equally to singular fields and array items, including unknown
names and escaped JSON pointer characters.

Zendesk retains Lily's one singular wrapper per physical line, including in ZIP
members. Arrays, plural API envelopes, malformed wrappers and mixed wrappers are
refused before custody. The wrapper determines the record kind; payload fields
cannot override it. An unsupported wrapper needs a valid original source ID;
a wrapper without one is refused before it can hide nested records under an
invented outer identity. A ticket's `type` is ordinary nullable business metadata
(`problem`, `incident`, `question` or `task`). No ambiguous document can enter custody with only the
identities of one interpretation retained. These refusals also apply when the
pre-audit recovery step reindexes an old original; an unprocessable old original
therefore establishes the documented workspace/vendor fence before erasure.

## Opaque and unsupported values

Opaque fields are explicitly retained-only: `custom_attributes`, `user_fields`,
attachment metadata, Zendesk comment metadata/routing source, restrictions,
unknown workflow action values, translations and article audience/availability
metadata. Every non-null opaque value makes the index incomplete, including
strings, numbers, empty arrays and empty objects. Its contents are not mapped;
its keys and scalar values are hashed whole into the erasure index described
above. Unknown fields make the index incomplete even when their value is null. Unsupported record kinds, semantic mapping errors
and unsupported envelope collections also make the index incomplete. Unprocessable
syntax and structural limits refuse the entire upload before custody. Duplicate
JSON members (including escaped spellings of the same key) are rejected at their
source path, so ordinary JSON parsing cannot hide an earlier identity-bearing
value. Structural scanning has a maximum depth of 128.

The review reports `unsupported_source_field`, `opaque_source_field`,
`malformed_source_field` or `source_shape_limit`, with a source filename,
physical record line and a JSON pointer to the field or item. Zendesk pointers
include the singular wrapper name; JSON envelope pointers include the collection
and record index. The physical line is the beginning of the source record;
the pointer identifies a field inside a multiline record. Rejected records
retain these diagnostics too. Unrecognized or opaque values have no invented
native effect, and the private original retains their exact bytes until contact
erasure supersedes that custody.

The audit follows a fixed, acyclic schema, stops at 4,096 visited nodes per
record; exceeding that budget refuses admission. It retains at most 128 field
diagnostics plus a truncation notice, while continuing to extract every understood
identity. A presentation limit cannot hide later people or references. It
does not recurse through unknown or opaque subtrees; the erasure index hashes
their values without interpreting them. Those limits supplement
the 2 MiB upload/expanded-byte, 5,000 source-position and 128 KiB record bounds.

The upgrade migration conservatively clears completeness claims saved by earlier
reader versions. It preserves original files, native rows and all other journal
fields. Those existing uploads remain incomplete and gain an additive audit-status column.
Before erasure, the actual old originals are reindexed in bounded groups of two.
Known aliases are retained before any original is deleted. Native erasure still
removes unprocessable old custody; its missing aliases make future imports of
that vendor in the same workspace unsafe, so those imports are explicitly refused.
New uploads must complete the current structural audit before custody.

The temporary structural index is bounded separately from the remaining source
record count. Fields and array values within a typed record do not consume extra
source positions when that record is the final member of a multi-file export.
The complete export still refuses any position beyond its 5,000-record bound.

## Archive custody

Every physical ZIP member consumes an extraction position, including an empty
directory. ZIP32 stored and deflated files are supported, with optional checked
32-bit data descriptors (with or without their signature). Each member must have
matching central/local names, flags, compression, timestamps and size/CRC fields;
its decompressed size and CRC are checked before its body can be omitted. A
directory must have zero expanded bytes and a valid empty-body checksum. The
reader checks header ranges, descriptors, body ranges and nonoverlap for every
member, and decompression remains bounded by the declared and upload limits.

Encrypted, multidisk, ZIP64, unsupported compression/flags/entry types, unsafe
paths, opaque extra fields/comments and bytes outside described members are
refused with their archive or member location. Repackage source files without
extra metadata if necessary. These bytes cannot be silently retained under a
complete identity claim. Upload admission finishes all physical chunks before
R2/D1 custody or queue publication. Queue extraction uses the same validated
physical cursor on resume; directories cannot alter file identity or reuse a
previous chunk's storage keys. Pre-audit originals that fail these checks use
the documented workspace/vendor erasure fence.

## Help Scout response custody

Inbox v2 `_embedded` list envelopes, direct customer/conversation objects,
per-conversation thread pages and Docs v1 `items`/`article` envelopes use a
separate shape reader. The shared strict JSON scanner validates their original
syntax before extraction, including escaped duplicate member names. List
receipts remain source records and are reconciled before native mapping; embedded
chat/thread arrays do not replace per-conversation page receipts. Customer
`_embedded.emails[].value`, primary customers and thread customer/creator IDs are
indexed before private custody, including records later rejected at review.
A thread customer may have no `type`; the documented `type:customer` thread
itself determines the incoming customer role. Unread or unsupported content is
retained with source-located diagnostics and participates in the conservative
whole-value erasure index. See [Help Scout inputs](moving-in.md#help-scout-inbox-v2-and-docs-v1)
for exact grouping, pagination and publication rules.

## Company relationships

Move in reads Zendesk `organization` wrappers and users' `organization_id`,
Freshdesk `company` wrappers and contacts' `company_id`, Intercom 2.16 typed
company records and contacts' embedded `companies` relationship, and Help Scout
organization wrappers or complete `_embedded.organizations` list responses with
customers' `organizationId`. Include those unmodified company responses alongside
the existing history export. A company name alone never creates a relationship.

Company names and explicit Zendesk/Freshdesk/Help Scout domain lists map to native
companies. Intercom's website is not a domain membership claim. Source company
IDs remain namespaced, contacts stay unverified, and company-wide portal access
stays off. Duplicate domains or a domain already owned by another native company
are review conflicts; import never merges accounts. Unsupported attributes,
sharing and routing settings are named in the review and retained in the private
original. Help Scout's checked organization shape has no source timestamps;
native creation time records the import and the omission is explicit.

Native contacts currently have one company. Zendesk's explicit default and
Freshdesk's primary company map with an omission for additional memberships;
Help Scout maps its explicit organization ID. Intercom maps only a complete
single-company relationship (`has_more: false`, matching distinct `total_count`);
multiple or incomplete relationships remain unlinked with an explicit reason.
Importing company data grants no company-wide customer history access. Later
native company or membership edits prevent whole-import undo from deleting them.
