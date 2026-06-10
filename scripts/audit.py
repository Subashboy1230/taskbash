#!/usr/bin/env python3
"""
taskbash data integrity audit.

Runs a battery of invariant checks against the production Supabase. Each
check asserts something the app silently depends on. If the invariant
breaks, the app still compiles, still renders, still feels right — but a
downstream feature is quietly dead. This script catches those.

Usage (one-off):
  python3 scripts/audit.py
  python3 scripts/audit.py --verbose

Usage (CI / cron later):
  exit code 0 = all green
  exit code 1 = at least one red (downstream feature is silently broken)
  exit code 2 = at least one yellow (worth investigating but not blocking)

Adding a check:
  Drop a new function in `CHECKS` below. Each must return a CheckResult:
    OK  — the invariant holds. Note in the message what was checked.
    WARN — degraded but not broken (e.g. data slowly drifting).
    FAIL — invariant broken; downstream feature is silently dead.

Read every existing check before adding a new one — the pattern is to
state the invariant in English in the docstring, then prove it in code.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Callable

# ─────────────────────────────────────────────────────────────────────────
# Setup

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env.local"

def load_env() -> None:
    if not ENV_FILE.exists():
        die(f".env.local not found at {ENV_FILE}")
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        # strip surrounding quotes if any
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)

def die(msg: str) -> None:
    print(f"\033[31m✗ {msg}\033[0m", file=sys.stderr)
    sys.exit(2)

def sb_url() -> str:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    if not url: die("SUPABASE URL missing in .env.local")
    return url.rstrip("/")

def sb_key() -> str:
    k = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not k: die("SUPABASE_SERVICE_ROLE_KEY missing in .env.local")
    return k

def user_id() -> str:
    u = os.environ.get("APP_USER_ID")
    if not u: die("APP_USER_ID missing in .env.local")
    return u

def sb_get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    qs = urllib.parse.urlencode(params)
    url = f"{sb_url()}/rest/v1/{table}?{qs}"
    req = urllib.request.Request(url, headers={
        "apikey": sb_key(),
        "Authorization": f"Bearer {sb_key()}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return [{"_error": str(e)}]

# ─────────────────────────────────────────────────────────────────────────
# Result types

OK, WARN, FAIL = "OK", "WARN", "FAIL"

@dataclass
class CheckResult:
    status: str
    name: str
    message: str
    detail: str | None = None

def now() -> datetime:
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.isoformat()

# ─────────────────────────────────────────────────────────────────────────
# CHECKS — one function per invariant.
#
# Each check states an INVARIANT in plain English at the top of its
# docstring, then proves it with a query. If you're adding a feature
# that depends on a new wire being plugged in, write a check for it.

def check_recent_items_have_llm_call_id() -> CheckResult:
    """
    Invariant: every gmail/granola item extracted in the last 24h carries
    a non-null extraction_meta.llm_call_id.

    Why it matters: this is the wire that broke for months. If it breaks
    again, markItemSlop can't find the producing prompt, eval datasets
    stop auto-creating, slop-rate-per-prompt goes to zero, and the
    "agent gets smarter from feedback" thesis silently dies.
    """
    cutoff = iso(now() - timedelta(hours=24))
    rows = sb_get("items", {
        "user_id": f"eq.{user_id()}",
        "source": f"in.(gmail,granola)",
        "created_at": f"gte.{cutoff}",
        "select": "id,source,extraction_meta",
        "limit": "500",
    })
    if not rows:
        return CheckResult(WARN, "items.llm_call_id linkage",
            "No gmail/granola items inserted in the last 24h. Either no digest ran or all sources are disconnected.")
    bad = [r for r in rows if not ((r.get("extraction_meta") or {}).get("llm_call_id"))]
    if bad:
        return CheckResult(FAIL, "items.llm_call_id linkage",
            f"{len(bad)}/{len(rows)} items in last 24h have no llm_call_id. Slop loop is dead for these.",
            detail=f"Example item ids: {[b['id'] for b in bad[:5]]}")
    return CheckResult(OK, "items.llm_call_id linkage",
        f"All {len(rows)} gmail/granola items in last 24h have a producing llm_call_id.")


def check_recent_slop_signals_have_call_id() -> CheckResult:
    """
    Invariant: every slop signal created in the last 24h on a post-fix item
    has llm_call_id populated.

    Why it matters: orphaned slop = no eval case = signal lost forever.
    """
    cutoff = iso(now() - timedelta(hours=24))
    rows = sb_get("item_feedback", {
        "user_id": f"eq.{user_id()}",
        "kind": "eq.slop",
        "created_at": f"gte.{cutoff}",
        "select": "id,llm_call_id,item_id,created_at",
        "limit": "500",
    })
    if not rows:
        return CheckResult(OK, "feedback.llm_call_id linkage",
            "No slop signals in last 24h. (This is fine — just no signal to check.)")
    orphaned = [r for r in rows if not r.get("llm_call_id")]
    # Cross-check: orphans are EXPECTED if the slopped item is old (pre-fix).
    # Pull the orphans' items and confirm their extraction_meta is null too.
    if not orphaned:
        return CheckResult(OK, "feedback.llm_call_id linkage",
            f"All {len(rows)} slop signals in last 24h are linked to a producing call.")
    # Recover the items for these orphans and check whether they were extracted before linkage shipped.
    item_ids = [r["item_id"] for r in orphaned if r.get("item_id")]
    if not item_ids:
        return CheckResult(WARN, "feedback.llm_call_id linkage",
            f"{len(orphaned)} orphan slop signals but no item_ids to cross-check.")
    items = sb_get("items", {
        "id": f"in.({','.join(item_ids)})",
        "select": "id,extraction_meta,created_at",
    })
    pre_fix_orphans = [i for i in items if not ((i.get("extraction_meta") or {}).get("llm_call_id"))]
    post_fix_orphans = [i for i in items if ((i.get("extraction_meta") or {}).get("llm_call_id"))]
    if post_fix_orphans:
        return CheckResult(FAIL, "feedback.llm_call_id linkage",
            f"{len(post_fix_orphans)} slop signals on POST-FIX items have no llm_call_id. markItemSlop is silently broken.",
            detail=f"Affected item ids: {[i['id'] for i in post_fix_orphans[:5]]}")
    return CheckResult(OK, "feedback.llm_call_id linkage",
        f"{len(orphaned)} orphan slop signals all point at pre-fix items (expected — those items lack extraction_meta).")


def check_no_stuck_running_runs() -> CheckResult:
    """
    Invariant: no `runs` row stays in 'running' status for more than 10 minutes.

    Why it matters: B2 from QA. A run that dies mid-pipeline used to stay
    'running' forever. We added try/catch; this check makes sure no
    regression brings it back.
    """
    cutoff = iso(now() - timedelta(minutes=10))
    rows = sb_get("runs", {
        "status": "eq.running",
        "started_at": f"lt.{cutoff}",
        "select": "id,trigger,started_at,user_id",
        "limit": "20",
    })
    if not rows:
        return CheckResult(OK, "runs stuck-state",
            "No runs row stuck in 'running' status >10 min.")
    return CheckResult(FAIL, "runs stuck-state",
        f"{len(rows)} runs rows stuck in 'running' status for >10 min. /activity will show false in-progress.",
        detail=f"Stuck ids: {[r['id'] for r in rows[:5]]}")


def check_recent_digest_ran() -> CheckResult:
    """
    Invariant: a digest run completed successfully in the last 26 hours.
    (26 = 24h cron + 2h slack for cron timing drift.)

    Why it matters: if the cron silently dies, no morning digest, no fresh
    items, the product appears frozen. Inngest dashboard hides this;
    this query proves it from our own data.
    """
    cutoff = iso(now() - timedelta(hours=26))
    rows = sb_get("runs", {
        "user_id": f"eq.{user_id()}",
        "status": "in.(succeeded,completed)",
        "completed_at": f"gte.{cutoff}",
        "select": "id,trigger,completed_at",
        "order": "completed_at.desc",
        "limit": "5",
    })
    if not rows:
        return CheckResult(FAIL, "recent digest run",
            "No succeeded digest run in last 26h. Cron may have died silently.")
    last = rows[0]
    return CheckResult(OK, "recent digest run",
        f"Last succeeded digest: {last['completed_at'][:19]} (trigger={last['trigger']}).")


def check_llm_call_volume_sane() -> CheckResult:
    """
    Invariant: LLM call volume in last 24h is in the normal band (>0, <2000).

    Why it matters: 0 means extraction is silently down. >2000 means a
    runaway loop is burning credits (we already had the draft.followup
    scare).
    """
    cutoff = iso(now() - timedelta(hours=24))
    rows = sb_get("llm_calls", {
        "started_at": f"gte.{cutoff}",
        "select": "id,prompt_id",
        "limit": "5000",
    })
    if not rows or rows == [{"_error": "..."}]:
        return CheckResult(WARN, "llm_calls volume", "Could not fetch llm_calls.")
    n = len(rows)
    if n == 0:
        return CheckResult(FAIL, "llm_calls volume",
            "Zero LLM calls in last 24h. Extraction may be silently down.")
    if n > 2000:
        from collections import Counter
        by_prompt = Counter(r.get("prompt_id") for r in rows).most_common(3)
        return CheckResult(WARN, "llm_calls volume",
            f"{n} LLM calls in last 24h is high. Possible runaway loop.",
            detail=f"Top prompts: {by_prompt}")
    return CheckResult(OK, "llm_calls volume",
        f"{n} LLM calls in last 24h (normal band 1-2000).")


def check_eval_datasets_exist_for_slopped_prompts() -> CheckResult:
    """
    Invariant: every prompt that has slop signals in the last 7 days has a
    corresponding eval_datasets row named slop-<prompt_id>.

    Why it matters: this is what proves the auto-promote pipeline is alive.
    If slop signals accumulate without eval datasets auto-creating, the
    promote path is broken.
    """
    cutoff = iso(now() - timedelta(days=7))
    # Pull recent slop signals + their producing call's prompt_id
    slop = sb_get("item_feedback", {
        "user_id": f"eq.{user_id()}",
        "kind": "eq.slop",
        "created_at": f"gte.{cutoff}",
        "llm_call_id": "not.is.null",
        "select": "id,llm_call_id",
        "limit": "200",
    })
    if not slop:
        return CheckResult(OK, "eval_datasets auto-promote",
            "No linked slop signals in last 7 days. (Pre-condition not met; nothing to auto-promote.)")
    call_ids = [s["llm_call_id"] for s in slop if s.get("llm_call_id")]
    calls = sb_get("llm_calls", {
        "id": f"in.({','.join(call_ids[:100])})",
        "select": "id,prompt_id",
    })
    expected_prompt_ids = {c.get("prompt_id") for c in calls if c.get("prompt_id")}
    if not expected_prompt_ids:
        return CheckResult(WARN, "eval_datasets auto-promote",
            f"Could not resolve prompt_id for {len(call_ids)} linked slop signals.")
    datasets = sb_get("eval_datasets", {
        "user_id": f"eq.{user_id()}",
        "select": "name,prompt_id",
        "limit": "100",
    })
    existing = {d.get("prompt_id") for d in datasets}
    missing = expected_prompt_ids - existing
    if missing:
        return CheckResult(FAIL, "eval_datasets auto-promote",
            f"Slop signals exist for {len(expected_prompt_ids)} prompts; only {len(existing)} have datasets. Missing: {missing}.")
    return CheckResult(OK, "eval_datasets auto-promote",
        f"All {len(expected_prompt_ids)} slopped prompts have an auto-promoted dataset.")


def check_no_orphaned_in_progress_items() -> CheckResult:
    """
    Invariant: no item should sit in 'in_progress' for more than 14 days
    without being touched.

    Why it matters: 'in_progress' is a transient state — a user clicked
    something and the action half-finished. Stale ones rot the open list
    and degrade signal-to-noise.
    """
    cutoff = iso(now() - timedelta(days=14))
    rows = sb_get("items", {
        "user_id": f"eq.{user_id()}",
        "status": "eq.in_progress",
        "updated_at": f"lt.{cutoff}",
        "select": "id,title,updated_at",
        "limit": "50",
    })
    if not rows:
        return CheckResult(OK, "in_progress staleness",
            "No items stuck in 'in_progress' >14 days.")
    return CheckResult(WARN, "in_progress staleness",
        f"{len(rows)} items stuck in 'in_progress' >14 days. Consider auto-completing or surfacing.",
        detail=f"Examples: {[(r['id'], r.get('title','')[:50]) for r in rows[:3]]}")


def check_connections_active_but_have_items() -> CheckResult:
    """
    Invariant: every connection marked 'active' has produced at least one
    extracted item in the last 7 days. (Calendar is exempt — it's used
    only for prep briefs which are not items.)

    Why it matters: a token can silently expire. The /connections page
    will still say 'Connected' (because we last saw it work), but
    extraction silently 0s out. We've been bitten by this before.
    """
    cutoff = iso(now() - timedelta(days=7))
    conns = sb_get("connections", {
        "user_id": f"eq.{user_id()}",
        "status": "eq.active",
        "select": "provider,updated_at",
    })
    if not conns:
        return CheckResult(WARN, "connections producing items",
            "No active connections found.")
    EXEMPT = {"calendar"}
    silent = []
    for c in conns:
        prov = c.get("provider")
        if prov in EXEMPT: continue
        items = sb_get("items", {
            "user_id": f"eq.{user_id()}",
            "source": f"eq.{prov}",
            "created_at": f"gte.{cutoff}",
            "select": "id",
            "limit": "1",
        })
        if not items:
            silent.append(prov)
    if silent:
        return CheckResult(FAIL, "connections producing items",
            f"Connections marked 'active' but produced zero items in last 7 days: {silent}. Likely silent token expiry.")
    return CheckResult(OK, "connections producing items",
        f"All non-exempt active connections produced items recently.")


# ─────────────────────────────────────────────────────────────────────────
# Runner

CHECKS: list[Callable[[], CheckResult]] = [
    check_recent_items_have_llm_call_id,
    check_recent_slop_signals_have_call_id,
    check_no_stuck_running_runs,
    check_recent_digest_ran,
    check_llm_call_volume_sane,
    check_eval_datasets_exist_for_slopped_prompts,
    check_no_orphaned_in_progress_items,
    check_connections_active_but_have_items,
]

ICONS = {OK: "\033[32m✓\033[0m", WARN: "\033[33m⚠\033[0m", FAIL: "\033[31m✗\033[0m"}

def main() -> int:
    load_env()
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    print(f"\ntaskbash data integrity audit — {now().isoformat()[:19]}\n")
    results: list[CheckResult] = []
    for fn in CHECKS:
        try:
            r = fn()
        except Exception as e:
            r = CheckResult(FAIL, fn.__name__, f"Check itself threw: {e}")
        results.append(r)
        print(f"  {ICONS[r.status]} {r.name}")
        print(f"    {r.message}")
        if r.detail and (verbose or r.status != OK):
            print(f"    \033[90m{r.detail}\033[0m")
    counts = {OK: 0, WARN: 0, FAIL: 0}
    for r in results: counts[r.status] += 1
    print(f"\n  {counts[OK]} ok · {counts[WARN]} warn · {counts[FAIL]} fail\n")
    if counts[FAIL]: return 1
    if counts[WARN]: return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
