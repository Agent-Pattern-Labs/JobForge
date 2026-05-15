#!/usr/bin/env bash
set -euo pipefail

# job-forge batch runner — standalone orchestrator for headless AI CLI workers
# Reads batch-input.tsv, delegates each offer to a worker CLI invocation,
# tracks state in batch-state.tsv for resumability.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${JOB_FORGE_PROJECT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Default path: delegate to the durable Node orchestrator. Keep the legacy
# shell implementation below as an escape hatch while the new runner settles.
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  SOURCE_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$SOURCE_DIR/$SOURCE"
done
HARNESS_BATCH_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
HARNESS_DIR="$(cd "$HARNESS_BATCH_DIR/.." && pwd)"
if [[ "${JOBFORGE_LEGACY_BATCH_RUNNER:-}" != "1" && -f "$HARNESS_DIR/scripts/batch-orchestrator.mjs" ]]; then
  export JOB_FORGE_PROJECT="$PROJECT_DIR"
  exec node "$HARNESS_DIR/scripts/batch-orchestrator.mjs" "$@"
fi

BATCH_DIR="$PROJECT_DIR/batch"
INPUT_FILE="$BATCH_DIR/batch-input.tsv"
STATE_FILE="$BATCH_DIR/batch-state.tsv"
PROMPT_FILE="$BATCH_DIR/batch-prompt.md"
LOGS_DIR="$BATCH_DIR/logs"
TRACKER_DIR="$BATCH_DIR/tracker-additions"
REPORTS_DIR="$PROJECT_DIR/reports"
APPLICATIONS_FILE="$PROJECT_DIR/data/applications.md"
LOCK_FILE="$BATCH_DIR/batch-runner.pid"

# Defaults
PARALLEL=1
DRY_RUN=false
RETRY_FAILED=false
START_FROM=0
MAX_RETRIES=2
# Bundle size: each worker processes N offers sequentially in one opencode run.
# Amortizes the ~10K-token system prompt + tool schema prefix across N offers
# instead of paying it per-offer. Set to 1 for legacy per-offer mode.
BUNDLE_SIZE=5

usage() {
  cat <<'USAGE'
job-forge batch runner — process job offers in batch via opencode run workers
Uses your default opencode model.

Usage: batch-runner.sh [OPTIONS]

Options:
  --parallel N         Number of parallel workers (default: 1)
  --bundle-size N      Offers per worker invocation (default: 5, use 1 for
                       legacy per-offer mode). Each worker processes N
                       offers sequentially, amortizing the system prompt.
  --dry-run            Show what would be processed, don't execute
  --retry-failed       Only retry offers marked as "failed" in state
  --start-from N       Start from offer ID N (skip earlier IDs)
  --max-retries N      Max retry attempts per offer (default: 2)
  -h, --help           Show this help

Files:
  batch-input.tsv      Input offers (id, url, source, notes)
  batch-state.tsv      Processing state (auto-managed)
  batch-prompt.md      Prompt template for workers
  logs/                Per-offer logs
  tracker-additions/   Tracker lines for post-batch merge

Examples:
  # Dry run to see pending offers
  ./batch-runner.sh --dry-run

  # Process all pending
  ./batch-runner.sh

  # Retry only failed offers
  ./batch-runner.sh --retry-failed

  # Process 2 at a time starting from ID 10
  ./batch-runner.sh --parallel 2 --start-from 10
USAGE
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel) PARALLEL="$2"; shift 2 ;;
    --bundle-size) BUNDLE_SIZE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --retry-failed) RETRY_FAILED=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# Lock file to prevent double execution
acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local old_pid
    old_pid=$(cat "$LOCK_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "ERROR: Another batch-runner is already running (PID $old_pid)"
      echo "If this is stale, remove $LOCK_FILE"
      exit 1
    else
      echo "WARN: Stale lock file found (PID $old_pid not running). Removing."
      rm -f "$LOCK_FILE"
    fi
  fi
  echo $$ > "$LOCK_FILE"
}

release_lock() {
  rm -f "$LOCK_FILE"
}

trap release_lock EXIT

# Validate prerequisites
check_prerequisites() {
  if [[ ! -f "$INPUT_FILE" ]]; then
    echo "ERROR: $INPUT_FILE not found. Add offers first."
    exit 1
  fi

  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "ERROR: $PROMPT_FILE not found."
    exit 1
  fi

  if ! command -v opencode &>/dev/null; then
    echo "ERROR: 'opencode' CLI not found in PATH."
    exit 1
  fi

  mkdir -p "$LOGS_DIR" "$TRACKER_DIR" "$REPORTS_DIR"
}

# Initialize state file if it doesn't exist
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    printf 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' > "$STATE_FILE"
  fi
}

# Get status of an offer from state file
get_status() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "none"
    return
  fi
  local status
  status=$(awk -F'\t' -v id="$id" '$1 == id { print $3 }' "$STATE_FILE")
  echo "${status:-none}"
}

# Get retry count for an offer
get_retries() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "0"
    return
  fi
  local retries
  retries=$(awk -F'\t' -v id="$id" '$1 == id { print $9 }' "$STATE_FILE")
  echo "${retries:-0}"
}

# Calculate next report number
next_report_num() {
  local max_num=0
  if [[ -d "$REPORTS_DIR" ]]; then
    for f in "$REPORTS_DIR"/*.md; do
      [[ -f "$f" ]] || continue
      local basename
      basename=$(basename "$f")
      local num="${basename%%-*}"
      num=$((10#$num)) # Remove leading zeros for arithmetic
      if (( num > max_num )); then
        max_num=$num
      fi
    done
  fi
  # Also check state file for assigned report numbers
  if [[ -f "$STATE_FILE" ]]; then
    while IFS=$'\t' read -r _ _ _ _ _ rnum _ _ _; do
      [[ "$rnum" == "report_num" || "$rnum" == "-" || -z "$rnum" ]] && continue
      local n=$((10#$rnum))
      if (( n > max_num )); then
        max_num=$n
      fi
    done < "$STATE_FILE"
  fi
  printf '%03d' $((max_num + 1))
}

# Update or insert state for an offer
update_state() {
  local id="$1" url="$2" status="$3" started="$4" completed="$5" report_num="$6" score="$7" error="$8" retries="$9"

  if [[ ! -f "$STATE_FILE" ]]; then
    init_state
  fi

  local tmp="$STATE_FILE.tmp"
  local found=false

  # Write header
  head -1 "$STATE_FILE" > "$tmp"

  # Process existing lines
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries; do
    [[ "$sid" == "id" ]] && continue  # skip header
    if [[ "$sid" == "$id" ]]; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" >> "$tmp"
      found=true
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$sid" "$surl" "$sstatus" "$sstarted" "$scompleted" "$sreport" "$sscore" "$serror" "$sretries" >> "$tmp"
    fi
  done < "$STATE_FILE"

  if [[ "$found" == "false" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" >> "$tmp"
  fi

  mv "$tmp" "$STATE_FILE"
}

# Process a single offer
process_offer() {
  local id="$1" url="$2" source="$3" notes="$4"

  local report_num
  report_num=$(next_report_num)
  local date
  date=$(date +%Y-%m-%d)
  local started_at
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local retries
  retries=$(get_retries "$id")
  local jd_file="/tmp/batch-jd-${id}.txt"

  echo "--- Processing offer #$id: $url (report $report_num, attempt $((retries + 1)))"

  # Mark as in-progress
  update_state "$id" "$url" "processing" "$started_at" "-" "$report_num" "-" "-" "$retries"

  # Build the prompt with placeholders replaced
  local prompt
  prompt="Process this job offer. Execute the full pipeline: A-F evaluation + report .md + PDF + tracker line."
  prompt="$prompt URL: $url"
  prompt="$prompt JD file: $jd_file"
  prompt="$prompt Report number: $report_num"
  prompt="$prompt Date: $date"
  prompt="$prompt Batch ID: $id"

  local log_file="$LOGS_DIR/${report_num}-${id}.log"

  # Launch opencode run worker (uses default model).
  # Pass batch-prompt.md unmodified so every worker shares a byte-identical
  # system prompt — otherwise sed-substituted per-job values would bust the
  # opencode prompt cache on every run. Per-job values (URL, JD file, report
  # num, date, batch ID) are in the user message; the worker resolves the
  # {{...}} placeholders itself by reading them from there.
  local exit_code=0
  opencode run \
    --dangerously-skip-permissions \
    --file "$PROMPT_FILE" \
    "$prompt" \
    > "$log_file" 2>&1 || exit_code=$?

  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [[ $exit_code -eq 0 ]]; then
    # Try to extract score from worker output
    local score="-"
    local score_match
    score_match=$(grep -oP '"score":\s*[\d.]+' "$log_file" 2>/dev/null | head -1 | grep -oP '[\d.]+' || true)
    if [[ -n "$score_match" ]]; then
      score="$score_match"
    fi

    update_state "$id" "$url" "completed" "$started_at" "$completed_at" "$report_num" "$score" "-" "$retries"
    echo "    ✅ Completed (score: $score, report: $report_num)"
  else
    retries=$((retries + 1))
    local error_msg
    error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "Unknown error (exit code $exit_code)")
    update_state "$id" "$url" "failed" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries"
    echo "    ❌ Failed (attempt $retries, exit code $exit_code)"
  fi
}

# Process a BUNDLE of offers in one opencode run.
# Amortizes the ~10K-token system prompt across N offers instead of paying
# it per-offer.  Args: space-separated list of offer IDs.
process_bundle() {
  local -a bundle_ids=("$@")
  local count=${#bundle_ids[@]}
  if (( count == 0 )); then return 0; fi
  if (( count == 1 )); then
    # Single-offer bundle is just legacy behavior — use the existing per-offer path
    local id="${bundle_ids[0]}"
    local row
    row=$(awk -F'\t' -v id="$id" '$1 == id { print $0; exit }' "$INPUT_FILE")
    IFS=$'\t' read -r _id url source notes <<< "$row"
    process_offer "$id" "$url" "$source" "$notes"
    return
  fi

  local date
  date=$(date +%Y-%m-%d)
  local started_at
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Build per-offer spec array
  local spec_json="["
  local first=true
  local -a assigned_report_nums=()
  local next_num
  next_num=$(next_report_num)
  local n=$((10#$next_num))

  for id in "${bundle_ids[@]}"; do
    local row
    row=$(awk -F'\t' -v id="$id" '$1 == id { print $0; exit }' "$INPUT_FILE")
    IFS=$'\t' read -r _id url source notes <<< "$row"
    local report_num
    report_num=$(printf '%03d' "$n")
    n=$((n + 1))
    assigned_report_nums+=("$report_num")
    local jd_file="/tmp/batch-jd-${id}.txt"
    local retries
    retries=$(get_retries "$id")

    update_state "$id" "$url" "processing" "$started_at" "-" "$report_num" "-" "-" "$retries"

    if [[ "$first" == "true" ]]; then first=false; else spec_json+=","; fi
    spec_json+=$(printf '{"id":"%s","url":"%s","jd_file":"%s","report_num":"%s","date":"%s"}' \
      "$id" "$url" "$jd_file" "$report_num" "$date")
  done
  spec_json+="]"

  local bundle_tag
  bundle_tag="bundle-$(IFS='_'; echo "${bundle_ids[*]}")"
  local log_file="$LOGS_DIR/${bundle_tag}.log"
  echo "--- Processing bundle of $count offers: ${bundle_ids[*]}"

  local prompt
  prompt=$(cat <<EOF
Process these $count offers sequentially using the full pipeline in batch-prompt.md
(Step 1 JD retrieval → Steps 2-6 evaluate/report/PDF/tracker line).  **Do each
offer fully before starting the next.**  Continue to the next offer even if one
fails.  After each offer, emit ONE single-line JSON on its own line with this
exact shape (no extra prose, no code fences around it):

{"id":"<id>","status":"completed|failed","report_num":"<num>","company":"...","role":"...","score":<num-or-null>,"pdf":"<path-or-null>","report":"<path-or-null>","error":"<msg-or-null>"}

The orchestrator parses these lines to update state — anything between status
JSONs is fine but do NOT omit or reorder the required keys.

Offers:
$spec_json
EOF
)

  local exit_code=0
  opencode run \
    --dangerously-skip-permissions \
    --file "$PROMPT_FILE" \
    "$prompt" \
    > "$log_file" 2>&1 || exit_code=$?

  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Parse per-offer status JSONs from the log. One per line, matching the
  # shape above. Missing entries mean the worker didn't reach that offer —
  # mark them as failed.
  local -A seen=()
  while IFS= read -r json_line; do
    [[ "$json_line" =~ \"id\":\"([^\"]+)\" ]] || continue
    local id="${BASH_REMATCH[1]}"
    [[ -n "${seen[$id]:-}" ]] && continue
    seen[$id]=1
    local status="failed"
    [[ "$json_line" =~ \"status\":\"completed\" ]] && status="completed"
    local score="-"
    if [[ "$json_line" =~ \"score\":([0-9.]+) ]]; then score="${BASH_REMATCH[1]}"; fi
    local report_num="-"
    if [[ "$json_line" =~ \"report_num\":\"([^\"]+)\" ]]; then report_num="${BASH_REMATCH[1]}"; fi
    local error_msg="-"
    if [[ "$json_line" =~ \"error\":\"([^\"]+)\" ]]; then error_msg="${BASH_REMATCH[1]}"; fi
    local url
    url=$(awk -F'\t' -v id="$id" '$1 == id { print $2; exit }' "$INPUT_FILE")
    local retries
    retries=$(get_retries "$id")
    if [[ "$status" == "failed" ]]; then retries=$((retries + 1)); fi
    update_state "$id" "$url" "$status" "$started_at" "$completed_at" "$report_num" "$score" "$error_msg" "$retries"
    echo "    $([ "$status" == "completed" ] && echo ✅ || echo ❌) #${id} (status=$status, score=$score, report=$report_num)"
  done < "$log_file"

  # Any offer in the bundle not seen in the output → mark failed
  for id in "${bundle_ids[@]}"; do
    if [[ -z "${seen[$id]:-}" ]]; then
      local url
      url=$(awk -F'\t' -v id="$id" '$1 == id { print $2; exit }' "$INPUT_FILE")
      local retries
      retries=$(get_retries "$id")
      retries=$((retries + 1))
      update_state "$id" "$url" "failed" "$started_at" "$completed_at" "-" "-" \
        "Worker finished without emitting status JSON for this offer" "$retries"
      echo "    ❌ #${id} (no status emitted — worker may have stopped early)"
    fi
  done

  if [[ $exit_code -ne 0 ]]; then
    echo "    ⚠️  Worker exit code $exit_code — see $log_file"
  fi
}

# Merge tracker additions into applications.md
merge_tracker() {
  echo ""
  echo "=== Merging tracker additions ==="
  node "$PROJECT_DIR/merge-tracker.mjs"
  echo ""
  echo "=== Verifying pipeline integrity ==="
  node "$PROJECT_DIR/verify-pipeline.mjs" || echo "⚠️  Verification found issues (see above)"
}

# Log per-session token usage and warn on expensive sessions
# (Opencode has no SessionEnd hook; this is the closest substitute for batch runs.)
cost_report() {
  # Only look at sessions started after this batch began. Uses --since-minutes
  # with a generous floor so long batches are still covered.
  local since=${1:-120}
  echo ""
  echo "=== Token usage (last ${since} min, warn at \$1.00) ==="
  if command -v npx &>/dev/null; then
    npx --no-install job-forge session-report --since-minutes "$since" --log --warn-at 1.00 \
      || echo "(session-report unavailable; run 'job-forge session-report' manually)"
  fi
}

# Print summary
print_summary() {
  echo ""
  echo "=== Batch Summary ==="

  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found."
    return
  fi

  local total=0 completed=0 failed=0 pending=0
  local score_sum=0 score_count=0

  while IFS=$'\t' read -r sid _ sstatus _ _ _ sscore _ _; do
    [[ "$sid" == "id" ]] && continue
    total=$((total + 1))
    case "$sstatus" in
      completed) completed=$((completed + 1))
        if [[ "$sscore" != "-" && -n "$sscore" ]]; then
          score_sum=$(echo "$score_sum + $sscore" | bc 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      failed) failed=$((failed + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < "$STATE_FILE"

  echo "Total: $total | Completed: $completed | Failed: $failed | Pending: $pending"

  if (( score_count > 0 )); then
    local avg
    avg=$(echo "scale=1; $score_sum / $score_count" | bc 2>/dev/null || echo "N/A")
    echo "Average score: $avg/5 ($score_count scored)"
  fi
}

# Main
main() {
  check_prerequisites

  if [[ "$DRY_RUN" == "false" ]]; then
    acquire_lock
  fi

  init_state

  # Count input offers (skip header, ignore blank lines)
  local total_input
  total_input=$(tail -n +2 "$INPUT_FILE" | grep -c '[^[:space:]]' 2>/dev/null || true)
  total_input="${total_input:-0}"

  if (( total_input == 0 )); then
    echo "No offers in $INPUT_FILE. Add offers first."
    exit 0
  fi

  echo "=== job-forge batch runner ==="
  echo "Parallel: $PARALLEL | Max retries: $MAX_RETRIES"
  echo "Input: $total_input offers"
  echo ""

  # Build list of offers to process
  local -a pending_ids=()
  local -a pending_urls=()
  local -a pending_sources=()
  local -a pending_notes=()

  while IFS=$'\t' read -r id url source notes; do
    [[ "$id" == "id" ]] && continue  # skip header
    [[ -z "$id" || -z "$url" ]] && continue

    # Skip if before start-from
    if (( id < START_FROM )); then
      continue
    fi

    local status
    status=$(get_status "$id")

    if [[ "$RETRY_FAILED" == "true" ]]; then
      # Only process failed offers
      if [[ "$status" != "failed" ]]; then
        continue
      fi
      # Check retry limit
      local retries
      retries=$(get_retries "$id")
      if (( retries >= MAX_RETRIES )); then
        echo "SKIP #$id: max retries ($MAX_RETRIES) reached"
        continue
      fi
    else
      # Skip completed offers
      if [[ "$status" == "completed" ]]; then
        continue
      fi
      # Skip failed offers that hit retry limit (unless --retry-failed)
      if [[ "$status" == "failed" ]]; then
        local retries
        retries=$(get_retries "$id")
        if (( retries >= MAX_RETRIES )); then
          echo "SKIP #$id: failed and max retries reached (use --retry-failed to force)"
          continue
        fi
      fi
    fi

    pending_ids+=("$id")
    pending_urls+=("$url")
    pending_sources+=("$source")
    pending_notes+=("$notes")
  done < "$INPUT_FILE"

  local pending_count=${#pending_ids[@]}

  if (( pending_count == 0 )); then
    echo "No offers to process."
    print_summary
    exit 0
  fi

  echo "Pending: $pending_count offers"
  echo ""

  # Dry run: just list
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN (no processing) ==="
    for i in "${!pending_ids[@]}"; do
      local status
      status=$(get_status "${pending_ids[$i]}")
      echo "  #${pending_ids[$i]}: ${pending_urls[$i]} [${pending_sources[$i]}] (status: $status)"
    done
    echo ""
    echo "Would process $pending_count offers"
    exit 0
  fi

  # Partition pending into bundles of BUNDLE_SIZE
  local -a bundles=()
  local b_current=""
  local b_count=0
  for id in "${pending_ids[@]}"; do
    if [[ -z "$b_current" ]]; then
      b_current="$id"
    else
      b_current+=" $id"
    fi
    b_count=$((b_count + 1))
    if (( b_count >= BUNDLE_SIZE )); then
      bundles+=("$b_current")
      b_current=""
      b_count=0
    fi
  done
  if [[ -n "$b_current" ]]; then bundles+=("$b_current"); fi
  local bundle_count=${#bundles[@]}
  echo "Partitioned into $bundle_count bundle(s) of up to $BUNDLE_SIZE offer(s) each"

  # Process bundles
  if (( PARALLEL <= 1 )); then
    # Sequential processing (one bundle at a time)
    for b in "${bundles[@]}"; do
      # shellcheck disable=SC2206
      local -a ids_in_bundle=($b)
      process_bundle "${ids_in_bundle[@]}"
    done
  else
    # Prime the opencode prompt cache with the first bundle alone so its
    # ~10K-token system prompt is written to cache, then remaining parallel
    # bundles read from cache instead of each writing their own copy.
    local start_idx=0
    if (( bundle_count > 1 )); then
      echo "Priming prompt cache with first bundle: ${bundles[0]}"
      # shellcheck disable=SC2206
      local -a prime_ids=(${bundles[0]})
      process_bundle "${prime_ids[@]}"
      start_idx=1
    fi

    # Parallel processing with job control
    local running=0
    local -a pids=()
    local -a pid_ids=()

    for i in "${!bundles[@]}"; do
      if (( i < start_idx )); then
        continue
      fi
      # Wait if we're at parallel limit
      while (( running >= PARALLEL )); do
        # Wait for any child to finish
        for j in "${!pids[@]}"; do
          if ! kill -0 "${pids[$j]}" 2>/dev/null; then
            wait "${pids[$j]}" 2>/dev/null || true
            unset 'pids[j]'
            unset 'pid_ids[j]'
            running=$((running - 1))
          fi
        done
        # Compact arrays
        pids=("${pids[@]}")
        pid_ids=("${pid_ids[@]}")
        sleep 1
      done

      # Launch a bundle worker in background
      # shellcheck disable=SC2206
      local -a ids_in_bundle=(${bundles[$i]})
      process_bundle "${ids_in_bundle[@]}" &
      pids+=($!)
      pid_ids+=("bundle-${i}")
      running=$((running + 1))
    done

    # Wait for remaining workers
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  # Merge tracker additions
  merge_tracker

  # Print summary
  print_summary

  # Auto-log token usage for this batch to data/token-usage.tsv and
  # flag any session that exceeded the $1 budget. No-op if opencode DB
  # isn't available (e.g. batch ran on a CI runner without opencode).
  cost_report 180
}

main "$@"
