#!/usr/bin/env bash

wf="${WF_REF%@*}"; wf="${wf##*/}"

# Only pushes of this workflow from this repository, excluding this run, count.
push_runs() {
  gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs?head_sha=$1&event=push&per_page=100" \
    --paginate --slurp | \
    jq -r "[.[].workflow_runs[] | select(.head_repository.full_name == \"$GITHUB_REPOSITORY\" and .id != $GITHUB_RUN_ID)] | $2" \
    || printf '%s\n' unavailable
}

newest_push() {
  push_runs "$1" 'max_by(.id) | select(. != null) | "\(.status) \(.conclusion)"'
}

newest_branch_push() {
  push_runs "$1" '[.[] | select(.head_branch != "main")] | max_by(.id) | select(. != null) | "\(.status) \(.conclusion)"'
}

green() { [ "$(newest_push "$1")" = 'completed success' ]; }

# A missing run is safe; any unfinished or unsuccessful run blocks parent reuse.
pushes_clear() {
  [ "$(push_runs "$1" 'all(.status == "completed" and .conclusion == "success")')" = true ]
}
