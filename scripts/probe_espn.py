"""One-off probe of ESPN's public scoreboard API to verify spec assumptions.

Answers (from docs/ADVERSARIAL_REVIEW.md A5, A1/F2, F4, F5, A3):
  1. CORS: does the response carry permissive access-control-allow-origin?
  2. Completeness: default limit vs explicit limit on a busy Saturday.
  3. Field availability: records, venue, gamecast links, broadcasts shape,
     conference membership, ranks, timeTbd, status types, winner.
  4. Date boundaries: which provider date bucket holds games kicking off
     between local-midnight-equivalent UTC hours (e.g. 2026-09-06T02:00Z).
"""

import json
import urllib.request

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "cfb-scoreboard-spec-probe/0.1"})
    with urllib.request.urlopen(req) as res:
        cors = res.headers.get("access-control-allow-origin")
        body = json.loads(res.read().decode("utf-8"))
    return cors, body


out = {}

# --- 1 + 2: CORS header and limit behavior on a busy Saturday -----------------
cors_a, a = get(f"{BASE}?dates=20260912")
_, b = get(f"{BASE}?dates=20260912&limit=400")
out["busy_saturday_20260912"] = {
    "cors_allow_origin": cors_a,
    "default_count": len(a.get("events", [])),
    "limit400_count": len(b.get("events", [])),
}

# --- 3: field availability on the busiest payload -----------------------------
evs = sorted(b["events"], key=lambda e: e["date"])
e = evs[0]
comp0 = e["competitions"][0]
competitor = comp0["competitors"][0]
team = competitor.get("team", {})
out["sample_event_fields"] = {
    "date": e.get("date"),
    "shortName": e.get("shortName"),
    "status_type": e.get("status", {}).get("type"),
    "event_keys": sorted(e.keys()),
    "competition_keys": sorted(comp0.keys()),
    "competitor_keys": sorted(competitor.keys()),
    "team_keys": sorted(team.keys()),
    "team_conferenceId": team.get("conferenceId"),
    "team_conference": team.get("conference"),
    "competitor_records": competitor.get("records"),
    "curatedRank": (competitor.get("curatedRank") or {}).get("current"),
    "venue": comp0.get("venue"),
    "broadcasts_field": comp0.get("broadcasts", comp0.get("broadcast")),
    "timeTbd": comp0.get("timeTbd", e.get("timeTbd")),
    "links": [{"rel": l.get("rel"), "href": l.get("href"), "text": l.get("text")} for l in e.get("links", [])],
    "notes": comp0.get("notes"),
}

# scan every event for broadcast shapes + status variety + winner presence
bshapes, statuses, winners, rank_count, conf_count, score_missing = set(), set(), 0, 0, 0, 0
for ev in evs:
    c = ev["competitions"][0]
    for bc in c.get("broadcasts", []) or []:
        bshapes.add(json.dumps({k: bc.get(k) for k in ("market", "names", "lang", "region")}, sort_keys=True))
    statuses.add(ev["status"]["type"]["name"])
    for cp in c["competitors"]:
        if cp.get("winner"):
            winners += 1
        if (cp.get("curatedRank") or {}).get("current", 99) < 99:
            rank_count += 1
        if cp.get("team", {}).get("conferenceId") is not None:
            conf_count += 1
        if cp.get("score") in (None, ""):
            score_missing += 1
out["payload_scan"] = {
    "n_events": len(evs),
    "status_names": sorted(statuses),
    "broadcast_shapes": sorted(bshapes)[:12],
    "winners_marked": winners,
    "ranked_competitors": rank_count,
    "competitors_with_conferenceId": conf_count,
    "competitors_missing_score": score_missing,
}

# --- 4: date boundary semantics -----------------------------------------------
_, d5 = get(f"{BASE}?dates=20260905&limit=400")
_, d6 = get(f"{BASE}?dates=20260906&limit=400")
ids5 = {ev["id"] for ev in d5["events"]}
ids6 = {ev["id"] for ev in d6["events"]}
out["date_boundary"] = {
    "count_0905": len(d5["events"]),
    "count_0906": len(d6["events"]),
    "id_overlap": len(ids5 & ids6),
    "0905_query_events_not_utc_sep5": [
        {"id": ev["id"], "date": ev["date"], "name": ev.get("shortName")}
        for ev in d5["events"]
        if not ev["date"].startswith("2026-09-05")
    ],
    "0906_query_events_utc_span": [
        min(ev["date"] for ev in d6["events"]),
        max(ev["date"] for ev in d6["events"]),
    ],
}

# range query coverage vs individual dates
_, rng = get(f"{BASE}?dates=20260903-20260907&limit=400")
rng_ids = {ev["id"] for ev in rng["events"]}
part_ids = ids5 | ids6
out["range_query"] = {
    "range_count": len(rng_ids),
    "union_5_6_count": len(part_ids),
    "in_union_missing_from_range": sorted(part_ids - rng_ids),
    "range_utc_span": [min(ev["date"] for ev in rng["events"]), max(ev["date"] for ev in rng["events"])],
}

print(json.dumps(out, indent=1)[:9000])
