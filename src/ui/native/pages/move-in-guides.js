// The scripts Move in shows for producing each accepted file from a vendor's own API or export.
// Each writes files under the 2 MiB upload limit, one page of history at a time.
//
// They are pasted into Terminal, so each must run the same in macOS's default zsh and in bash:
// - the whole script is one `( ... )` group, so a paste is read in full before anything runs (a prompt
//   never swallows the next pasted line) and `exit` leaves only the group, never the Terminal window;
// - every value is asked for, so nothing has to be edited first, and there are no `#` comments
//   (interactive zsh runs them as commands unless INTERACTIVE_COMMENTS is set);
// - a secret is read with `stty -echo` and plain `read -r` (bash's `read -s -p` is a zsh error);
// - a glob is used only once a file is known to exist (zsh stops on a pattern with no match).
import {prompt, secret, required} from './terminal-prompts';

export const helpScoutScript = `(
${prompt('HS_APP_ID', 'Help Scout App ID')}
${secret('HS_SECRET', 'Help Scout App Secret')}
${prompt('MAILBOX', 'Mailbox number, from the mailbox web address')}
${required('HS_APP_ID', 'HS_SECRET', 'MAILBOX')}
TOKEN=$(curl -fsS -X POST https://api.helpscout.net/v2/oauth2/token -d grant_type=client_credentials -d client_id="$HS_APP_ID" -d client_secret="$HS_SECRET" | jq -r .access_token)
[ -n "$TOKEN" ] || { echo 'Help Scout refused the App ID and Secret.'; exit 1; }
api() { curl -fsS -H "Authorization: Bearer $TOKEN" "$1" | jq -c .; }
url="https://api.helpscout.net/v2/conversations?status=all&mailbox=$MAILBOX"; : > ids.txt
while [ -n "$url" ]; do
  api "$url" > list.json || { echo 'Help Scout refused the request: check the mailbox number.'; exit 1; }
  jq -r '._embedded.conversations[]?.id' list.json >> ids.txt; url=$(jq -r '._links.next.href // empty' list.json)
done
[ -s ids.txt ] || { echo 'No conversations found in that mailbox.'; exit 1; }
split -l 25 ids.txt batch-; n=1
for batch in batch-*; do
  out="helpscout-move-in-$n.jsonl"; : > "$out"; : > customers.txt
  for id in $(cat "$batch"); do
    api "https://api.helpscout.net/v2/conversations/$id" | tee -a "$out" | jq -r '.primaryCustomer.id' >> customers.txt
    page="https://api.helpscout.net/v2/conversations/$id/threads"
    while [ -n "$page" ]; do api "$page" | tee -a "$out" > threads.json; page=$(jq -r '._links.next.href // empty' threads.json); done
  done
  for c in $(sort -u customers.txt); do api "https://api.helpscout.net/v2/customers/$c" >> "$out"; done
  n=$((n+1))
done
rm -f ids.txt list.json threads.json customers.txt batch-*; ls helpscout-move-in-*.jsonl
)`;

export const intercomApiScript = `(
${secret('IC_TOKEN', 'Intercom access token')}
${required('IC_TOKEN')}
api() { curl -fsS -H "Authorization: Bearer $IC_TOKEN" -H 'Intercom-Version: 2.16' -H 'Accept: application/json' "https://api.intercom.io/$1"; }
: > ids.txt; next=''
while :; do
  api "conversations?per_page=150\${next:+&starting_after=$next}" > list.json || { echo 'Intercom refused the request: check the access token.'; exit 1; }
  jq -r '.conversations[].id' list.json >> ids.txt
  next=$(jq -r '.pages.next.starting_after // empty' list.json); [ -n "$next" ] || break
done
[ -s ids.txt ] || { echo 'No conversations found.'; exit 1; }
split -l 25 ids.txt batch-; n=1
for batch in batch-*; do
  for id in $(cat "$batch"); do api "conversations/$id"; echo; done > conversations.jsonl
  jq -r '.contacts.contacts[].id' conversations.jsonl | sort -u | while read -r c; do api "contacts/$c"; echo; done > contacts.jsonl
  cat contacts.jsonl conversations.jsonl | jq -c . > "intercom-move-in-$n.jsonl"
  n=$((n+1))
done
rm -f ids.txt list.json conversations.jsonl contacts.jsonl batch-*; ls intercom-move-in-*.jsonl
)`;

export const intercomContactsScript = `(
${secret('IC_TOKEN', 'Intercom access token')}
${required('IC_TOKEN')}
[ -d intercom-export ] || { echo 'Run this in the folder that holds intercom-export.'; exit 1; }
find intercom-export -name '*.json*' -exec jq -r '.. | objects | select(.type? == "contact") | .id' {} + | sort -u | while read -r id; do
  curl -fsS -H "Authorization: Bearer $IC_TOKEN" -H 'Intercom-Version: 2.16' "https://api.intercom.io/contacts/$id"; echo
done | jq -sc '{contacts: .}' > intercom-contacts.json
find intercom-export -name '*.json*' -exec zip -qj intercom-move-in.zip {} + && zip -qj intercom-move-in.zip intercom-contacts.json && ls -l intercom-move-in.zip
)`;

export const freshdeskScript = `(
${prompt('FD', 'Freshdesk address, the yourcompany in yourcompany.freshdesk.com')}
${secret('FD_KEY', 'Freshdesk API key')}
${required('FD', 'FD_KEY')}
api() { curl -gfsS --retry 5 --retry-delay 20 -u "$FD_KEY:X" "https://$FD.freshdesk.com/api/v2/$1"; }
all() { p=1; q='?per_page=100&page='; [[ $1 == *\\?* ]] && q='&per_page=100&page='
  while r=$(api "$1$q$p"); do jq -c '.[]' <<<"$r"; [ "$(jq length <<<"$r")" -lt 100 ] && return; p=$((p+1)); done; }
api agents/me > /dev/null || { echo 'Freshdesk refused the request: check the address and API key.'; exit 1; }
CLEAN='def clean: walk(if type == "object" then del(.attachment_url, .thumb_url, .avatar, .to_emails, .cc_emails, .bcc_emails, .fwd_emails, .reply_cc_emails, .ticket_cc_emails, .from_email, .support_email) | (if (.custom_fields | type) == "object" then .custom_fields |= with_entries(select(.value != null)) else . end) | (if .custom_fields == {} then del(.custom_fields) else . end) else . end);'
all agents | jq -c "$CLEAN {agent: clean}" > agents.ndjson; jq -r .agent.id agents.ndjson | sort > agent-ids.txt
all 'tickets?updated_since=2000-01-01T00:00:00Z&order_by=created_at&order_type=asc' | jq -r .id > ids.txt
[ -s ids.txt ] || { echo 'No tickets found.'; exit 1; }
split -l 50 ids.txt batch-; n=1
for batch in batch-*; do
  : > tickets.ndjson
  for id in $(cat "$batch"); do
    t=$(api "tickets/$id?include=stats") && all "tickets/$id/conversations" | jq -sc --argjson t "$t" "$CLEAN {ticket: (\\$t + {conversations: .}) | clean}" >> tickets.ndjson
  done
  jq -r '.ticket | .requester_id, .conversations[].user_id' tickets.ndjson | sort -u | comm -23 - agent-ids.txt > people.txt
  { cat agents.ndjson; for c in $(cat people.txt); do api "contacts/$c" | jq -c "$CLEAN {contact: clean}"; done; cat tickets.ndjson; } > "freshdesk-move-in-$n.ndjson"
  n=$((n+1))
done
for f in $(api canned_response_folders | jq -r '.[].id'); do for r in $(api "canned_response_folders/$f/responses" | jq -r '.[].id'); do
  api "canned_responses/$r" | jq -c "$CLEAN {canned_response: clean}"; done; done > freshdesk-move-in-saved-replies.ndjson
rm -f ids.txt agent-ids.txt agents.ndjson tickets.ndjson people.txt batch-*; ls freshdesk-move-in-*.ndjson
)`;
