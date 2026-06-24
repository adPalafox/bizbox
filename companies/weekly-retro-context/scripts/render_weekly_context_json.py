#!/usr/bin/env python3
"""Render the final reviewed weekly retro context JSON list."""

from __future__ import annotations

import argparse
from collections import OrderedDict
from typing import Any

from _shared import load_json_file, normalize_text, write_json_file


def participant_key(item: dict[str, Any]) -> tuple[str, str, str]:
    return (
        normalize_text(item.get("name")),
        normalize_text(item.get("source")),
        normalize_text(item.get("role")),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Path to the company config JSON")
    parser.add_argument("--normalized", required=True, help="Path to the normalized evidence JSON")
    parser.add_argument("--review", required=True, help="Path to the reviewer JSON")
    parser.add_argument("--output", required=True, help="Path to write the final JSON list")
    args = parser.parse_args()

    _config = load_json_file(args.config)
    normalized = load_json_file(args.normalized)
    review = load_json_file(args.review)

    window = normalized.get("window") if isinstance(normalized, dict) else None
    if not isinstance(window, dict):
        raise SystemExit("Normalized input is missing a window object")
    review_window = review.get("window") if isinstance(review, dict) else None
    if review_window != window:
        raise SystemExit("Review window does not match normalized window")

    evidence_items = normalized.get("items", []) if isinstance(normalized, dict) else []
    evidence_by_id = {item.get("id"): item for item in evidence_items if isinstance(item, dict) and item.get("id")}

    output: list[dict[str, Any]] = []
    decisions = review.get("decisions", []) if isinstance(review, dict) else []
    for decision in decisions:
        if not isinstance(decision, dict) or not decision.get("include", True):
            continue
        evidence_ids = [normalize_text(evidence_id) for evidence_id in decision.get("evidence_ids", []) if normalize_text(evidence_id)]
        selected = [evidence_by_id[evidence_id] for evidence_id in evidence_ids if evidence_id in evidence_by_id]
        if not selected:
            continue
        participants_map: "OrderedDict[tuple[str, str, str], dict[str, str]]" = OrderedDict()
        for item in selected:
            for participant in item.get("participants", []) if isinstance(item.get("participants"), list) else []:
                if not isinstance(participant, dict):
                    continue
                key = participant_key(participant)
                if key not in participants_map and all(key):
                    participants_map[key] = {
                        "name": key[0],
                        "source": key[1],
                        "role": key[2],
                    }

        source_counts = {"clickup": 0, "github": 0}
        for item in selected:
            source = normalize_text(item.get("source"))
            if source in source_counts:
                source_counts[source] += 1

        summary = normalize_text(decision.get("review_notes")) or f"{decision.get('topic_label')} with {len(selected)} evidence items."
        output.append({
            "topic_slug": normalize_text(decision.get("topic_slug")),
            "topic_label": normalize_text(decision.get("topic_label")),
            "window": window,
            "participants": list(participants_map.values()),
            "evidence_ids": evidence_ids,
            "evidence": selected,
            "insights": [normalize_text(item) for item in decision.get("insights", []) if normalize_text(item)],
            "source_counts": source_counts,
            "summary": summary,
        })

    output.sort(key=lambda item: item["topic_slug"])
    write_json_file(args.output, output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
