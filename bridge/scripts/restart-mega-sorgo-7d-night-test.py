"""Restart the isolated 7-day test on one of the owner's two approved chats.

Usage: python bridge/scripts/restart-mega-sorgo-7d-night-test.py PATH_TO_ENV 673|1286 RUN_TAG
Old sent queue rows remain for audit. Only outstanding rows are cancelled.
"""

import sys
from datetime import datetime, timezone

import requests
from dotenv import dotenv_values


CHAT_IDS = {
    673: "b1f6fec3-c120-42a7-9c6c-3eb1be379e24",
    1286: "cd345968-602a-4a9d-aa33-d60cc53f7800",
}
cw_id = int(sys.argv[2])
run_tag = sys.argv[3]
if not run_tag or not run_tag.replace("-", "").isalnum() or len(run_tag) > 40:
    raise SystemExit("RUN_TAG must be a short alphanumeric label")
if cw_id not in CHAT_IDS:
    raise SystemExit("only test conversations 673/1286 are allowed")
conv_id = CHAT_IDS[cw_id]
env = dotenv_values(sys.argv[1])
base = env["SUPABASE_URL"].rstrip("/")
key = env["SUPABASE_SERVICE_ROLE_KEY"]
db_headers = {"apikey": key, "Authorization": f"Bearer {key}"}


def db(method, table, **kwargs):
    headers = {**db_headers, **kwargs.pop("headers", {})}
    response = requests.request(method, f"{base}/rest/v1/{table}", headers=headers,
                                timeout=30, **kwargs)
    response.raise_for_status()
    return response.json() if response.content else []


sequences = db("GET", "sales_sequences", params={
    "select": "id,status", "conversation_id": f"eq.{conv_id}",
    "funnel": "eq.mega-sorgo-7d-v1",
})
if len(sequences) != 1 or sequences[0]["status"] != "paused":
    raise RuntimeError(f"expected exactly one paused test sequence, got {sequences}")

remaining = db("GET", "scheduled_messages", params={
    "select": "id,status", "conversation_id": f"eq.{conv_id}",
    "funnel": "eq.mega-sorgo-7d-v1", "status": "in.(paused,pending)",
})
if len(remaining) > 39:
    raise RuntimeError("unexpected outstanding test queue size")
cancelled = db("PATCH", "scheduled_messages", params={
    "conversation_id": f"eq.{conv_id}", "funnel": "eq.mega-sorgo-7d-v1",
    "status": "in.(paused,pending)"},
    headers={"Content-Type": "application/json", "Prefer": "return=representation"},
    json={"status": "cancelled"})
if len(cancelled) != len(remaining):
    raise RuntimeError("partial cancellation; stop before new enrollment")

db("POST", "events", headers={"Content-Type": "application/json"}, json={
    "source": "mega-sorgo-7d", "event_type": "night_retest_restarted",
    "payload": {"chatwoot_conversation_id": cw_id, "previous_sequence_id": sequences[0]["id"],
                "cancelled_rows": len(cancelled)},
})
deleted = db("DELETE", "sales_sequences", params={
    "id": f"eq.{sequences[0]['id']}", "status": "eq.paused"},
    headers={"Prefer": "return=representation"})
if len(deleted) != 1:
    raise RuntimeError("old sequence was not released")

coolify = requests.get(
    env["COOLIFY_URL"].rstrip("/") + "/applications/m8qf6ru2x75gukzozpsrssrm/envs",
    headers={"Authorization": "Bearer " + env["COOLIFY_TOKEN"]}, timeout=30)
coolify.raise_for_status()
secret = next(item["value"] for item in coolify.json()
              if item.get("key") == "N8N_ACTION_SECRET" and item.get("is_preview") is False)
request_id = f"owner-night-retest-20261108-{cw_id}-{run_tag}"
result = requests.post("https://cofre.camposoberano.com.br/n8n-action-enqueue",
                       headers={"Authorization": "Bearer " + secret},
                       json={"request": {"request_id": request_id, "source": "macro",
                                         "chatwoot_conversation_id": cw_id, "action": "funil",
                                         "funnel_version": "mega-sorgo-7d-v1"}, "pieces": []}, timeout=45)
print("enrollment", cw_id, result.status_code, result.text[:250])
result.raise_for_status()
if not result.json().get("ok") or result.json().get("accepted") != 34:
    raise RuntimeError("new queue did not contain 34 pieces")
