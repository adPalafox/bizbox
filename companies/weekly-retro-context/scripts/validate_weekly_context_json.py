#!/usr/bin/env python3
"""Validate the final weekly retro context JSON output."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Any

from _shared import load_json_file, parse_iso_datetime, within_window


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def validate_item(item: dict[str, Any], index: int) -> None:
    ensure(isinstance(item.get("topic_slug"), str) and item["topic_slug"].strip(), f"Item {index} is missing topic_slug")
    ensure(isinstance(item.get("topic_label"), str) and item["topic_label"].strip(), f"Item {index} is missing topic_label")
    window = item.get("window")
    ensure(isinstance(window, dict), f"Item {index} is missing a window object")
    for key in ("start", "end", "timezone"):
        ensure(isinstance(window.get(key), str) and window[key].strip(), f"Item {index} window is missing {key}")
    start = parse_iso_datetime(window.get("start"))
    end = parse_iso_datetime(window.get("end"))
    ensure(start is not None and end is not None and start < end, f"Item {index} has an invalid window range")
    participants = item.get("participants")
    ensure(isinstance(participants, list), f"Item {index} participants must be a list")
    for participant in participants:
        ensure(isinstance(participant, dict), f"Item {index} has a malformed participant entry")
        for key in ("name", "source", "role"):
            ensure(isinstance(participant.get(key), str) and participant[key].strip(), f"Item {index} participant missing {key}")
    evidence_ids = item.get("evidence_ids")
    ensure(isinstance(evidence_ids, list), f"Item {index} evidence_ids must be a list")
    evidence = item.get("evidence")
    ensure(isinstance(evidence, list), f"Item {index} evidence must be a list")
    for evidence_item in evidence:
        ensure(isinstance(evidence_item, dict), f"Item {index} has a malformed evidence entry")
        for key in ("id", "source", "kind", "timestamp", "title"):
            ensure(isinstance(evidence_item.get(key), str) and evidence_item[key].strip(), f"Item {index} evidence entry missing {key}")
        timestamp = parse_iso_datetime(evidence_item.get("timestamp"))
        ensure(timestamp is not None, f"Item {index} evidence entry has an invalid timestamp")
        ensure(start <= timestamp.astimezone(start.tzinfo) <= end, f"Item {index} evidence timestamp is outside the window")
    insights = item.get("insights")
    ensure(isinstance(insights, list), f"Item {index} insights must be a list")
    source_counts = item.get("source_counts")
    ensure(isinstance(source_counts, dict), f"Item {index} source_counts must be an object")
    ensure(isinstance(source_counts.get("clickup"), int) and source_counts["clickup"] >= 0, f"Item {index} clickup source count is invalid")
    ensure(isinstance(source_counts.get("github"), int) and source_counts["github"] >= 0, f"Item {index} github source count is invalid")
    ensure(isinstance(item.get("summary"), str), f"Item {index} summary must be a string")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", required=True, help="Path to the company schema JSON")
    parser.add_argument("--input", required=True, help="Path to the final JSON list")
    args = parser.parse_args()

    schema_path = Path(args.schema)
    ensure(schema_path.exists(), f"Schema file does not exist: {schema_path}")
    _schema = load_json_file(schema_path)
    payload = load_json_file(args.input)
    ensure(isinstance(payload, list), "Final output must be a JSON array")
    for index, item in enumerate(payload):
        ensure(isinstance(item, dict), f"Item {index} must be an object")
        validate_item(item, index)
    print(f"Validated {len(payload)} weekly retro context item(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
