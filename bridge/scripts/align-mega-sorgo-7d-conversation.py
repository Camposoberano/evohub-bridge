"""Remove short clips from two test queues and replace audio that promises a video.

Run: python bridge/scripts/align-mega-sorgo-7d-conversation.py PATH_TO_ENV
"""

import sys
from pathlib import Path

import requests
from dotenv import dotenv_values


env = dotenv_values(sys.argv[1])
base = env["SUPABASE_URL"].rstrip("/")
key = env["SUPABASE_SERVICE_ROLE_KEY"]
headers = {"apikey": key, "Authorization": f"Bearer {key}"}
root = Path(__file__).resolve().parents[2]
media_dir = root / "ops" / "mega-sorgo-7d-media"
conversations = (
    "b1f6fec3-c120-42a7-9c6c-3eb1be379e24",
    "cd345968-602a-4a9d-aa33-d60cc53f7800",
)


def request(method, path, **kwargs):
    result = requests.request(method, base + path, headers={**headers, **kwargs.pop("headers", {})}, timeout=30, **kwargs)
    result.raise_for_status()
    return result


for slot, filename in (("p04", "p04_sem_promessa_video.ogg"), ("p05", "p05_sem_promessa_video.ogg")):
    path = f"funil/mega-sorgo-7d-v1/conversa-20261107/{filename}"
    url = f"{base}/storage/v1/object/public/soberano-out/{path}"
    existing = request("GET", "/rest/v1/funnel_media", params={
        "select": "id,url,type", "funnel": "eq.mega-sorgo-7d-v1", "day": "eq.0",
        "slot": f"eq.{slot}", "active": "eq.true",
    }).json()
    if len(existing) != 1 or existing[0]["type"] != "audio":
        raise RuntimeError(f"unexpected media slot {slot}")
    head = requests.head(url, timeout=30)
    missing = head.status_code == 404 or (
        head.status_code == 400 and requests.get(url, timeout=30).json().get("statusCode") == "404"
    )
    if missing:
        data = (media_dir / filename).read_bytes()
        request("POST", f"/storage/v1/object/soberano-out/{path}",
                headers={"Content-Type": "audio/ogg", "x-upsert": "false"}, data=data)
    elif not head.ok:
        head.raise_for_status()
    if not requests.head(url, timeout=30).ok:
        raise RuntimeError(f"uploaded file unavailable: {slot}")
    request("PATCH", "/rest/v1/funnel_media", params={"id": f"eq.{existing[0]['id']}", "url": f"eq.{existing[0]['url']}"},
            headers={"Content-Type": "application/json", "Prefer": "return=representation"}, json={"url": url})
    print(f"updated audio slot {slot}")


rows = request("GET", "/rest/v1/scheduled_messages", params={
    "select": "id,conversation_id,status,payload", "funnel": "eq.mega-sorgo-7d-v1",
    "conversation_id": f"in.({','.join(conversations)})", "status": "in.(paused,pending)",
    "type": "eq.video",
}).json()
allowed = {"06", "11", "16", "22", "24v"}
for row in rows:
    code = row["payload"].get("__funnel_piece_code")
    if code not in allowed:
        raise RuntimeError(f"unexpected queued video: {code}")
    updated = request("PATCH", "/rest/v1/scheduled_messages", params={
        "id": f"eq.{row['id']}", "status": f"eq.{row['status']}"},
        headers={"Content-Type": "application/json", "Prefer": "return=representation"},
        json={"status": "cancelled"}).json()
    if len(updated) != 1:
        raise RuntimeError(f"could not cancel video {row['id']}")
    print(f"cancelled queued clip {code} on {row['conversation_id'][:8]}")

remaining = request("GET", "/rest/v1/scheduled_messages", params={
    "select": "id", "funnel": "eq.mega-sorgo-7d-v1", "conversation_id": f"in.({','.join(conversations)})",
    "status": "in.(paused,pending)", "type": "eq.video",
}).json()
print(f"short clips remaining in queue: {len(remaining)}")
