"""Read-only audit of one identified seven-day test in allowlisted Chatwoot conversations.

Usage: python bridge/scripts/audit-mega-sorgo-7d-test.py PATH_TO_ENV REQUEST_ID CHATWOOT_ID...
Uses only GET requests. Never prints credentials, phone numbers, or message bodies.
"""

import collections
import sys

import requests
from dotenv import dotenv_values


def main() -> int:
    if len(sys.argv) < 4:
        raise SystemExit("usage: audit-mega-sorgo-7d-test.py PATH_TO_ENV REQUEST_ID CHATWOOT_ID...")
    request_id = sys.argv[2]
    if not request_id or len(request_id) > 180:
        raise SystemExit("valid request ID required")
    ids = [int(raw) for raw in sys.argv[3:]]
    if not ids or any(value <= 0 for value in ids):
        raise SystemExit("positive Chatwoot conversation IDs required")
    env = dotenv_values(sys.argv[1])
    base = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    session = requests.Session()
    session.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def read(table: str, params: dict[str, str]) -> list[dict]:
        response = session.get(f"{base}/rest/v1/{table}", params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    failures = 0
    for cw_id in ids:
        rows = read("scheduled_messages", {
            "select": "id,conversation_id,chatwoot_conversation_id,funnel,step,day,type,status,send_at,payload",
            "chatwoot_conversation_id": f"eq.{cw_id}",
            "funnel": "eq.mega-sorgo-7d-v1", "limit": "500",
        })
        groups: dict[str, list[dict]] = collections.defaultdict(list)
        for row in rows:
            key = str(row.get("payload", {}).get("__funnel_sequence_id", ""))
            if key:
                groups[key].append(row)
        matched = [batch for key, batch in groups.items() if key.endswith(":" + request_id)]
        if len(matched) != 1:
            print(f"Chatwoot {cw_id}: expected one enrollment for request ID")
            failures += 1
            continue
        current = matched[0]
        current = sorted(current, key=lambda row: row["step"])
        status = dict(collections.Counter(row["status"] for row in current))
        codes = [row["payload"].get("__funnel_piece_code") for row in current]
        issues: list[str] = []
        if len(current) != 33 or len(set(codes)) != 33:
            issues.append("expected 33 unique pieces")
        if [row["type"] for row in current[:2]] != ["audio", "image"]:
            issues.append("opening order is not audio then photo")
        if sum(row["type"] == "audio" for row in current) != 10:
            issues.append("expected 10 audio pieces")
        if any(row["day"] == 4 for row in current):
            issues.append("day 4 contains pieces")
        by_code = {row["payload"].get("__funnel_piece_code"): row for row in current}
        pdf = by_code.get("d5_pdf", {})
        if pdf.get("type") != "text" or "media_url" in pdf.get("payload", {}):
            issues.append("PDF is automatic instead of offered")
        for code in ("d6_duvida", "d7_ultima"):
            if "[nome]" in str(by_code.get(code, {}).get("payload", {}).get("content", "")):
                issues.append(f"literal name placeholder in {code}")
        if any(row["status"] == "failed" for row in current):
            issues.append("failed queue rows")

        row_ids = [row["id"] for row in current]
        messages = read("messages", {
            "select": "scheduled_message_id,status",
            "scheduled_message_id": f"in.({','.join(row_ids)})", "limit": "500",
        })
        msg_counts = collections.Counter(row["scheduled_message_id"] for row in messages)
        missing = [row["id"] for row in current if row["status"] == "sent" and msg_counts[row["id"]] == 0]
        if missing:
            issues.append(f"{len(missing)} sent rows without message record")
        videos = read("scheduled_messages", {
            "select": "id,status,payload",
            "chatwoot_conversation_id": f"eq.{cw_id}",
            "funnel": "eq.mega-sorgo-7d-v1:video", "limit": "100",
        })
        if len(videos) not in (0, 5):
            issues.append(f"{len(videos)} conditional video rows; expected 0 or 5")
        print(f"Chatwoot {cw_id}: pieces={len(current)}, status={status}, "
              f"message_records={len(messages)}, official_videos={len(videos)}, "
              f"issues={issues or 'none'}")
        failures += len(issues)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
