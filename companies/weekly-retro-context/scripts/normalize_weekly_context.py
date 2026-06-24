#!/usr/bin/env python3
"""Normalize raw ClickUp and GitHub evidence into candidate retro items."""

from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Any

from _shared import (
    coerce_window,
    dedupe_by_key,
    isoformat_or_default,
    load_json_file,
    match_topics,
    normalize_text,
    parse_iso_datetime,
    topic_catalog,
    within_window,
    write_json_file,
)


def person(name: str, source: str, role: str) -> dict[str, str]:
    return {
        "name": name,
        "source": source,
        "role": role,
    }


def clickup_people(task: dict[str, Any]) -> list[dict[str, str]]:
    people: list[dict[str, str]] = []
    for assignee in task.get("assignees", []) if isinstance(task.get("assignees"), list) else []:
        if not isinstance(assignee, dict):
            continue
        name = normalize_text(assignee.get("username") or assignee.get("name") or assignee.get("email"))
        if name:
            people.append(person(name, "clickup", "assignee"))
    creator = task.get("creator")
    if isinstance(creator, dict):
        name = normalize_text(creator.get("username") or creator.get("name") or creator.get("email"))
        if name:
            people.append(person(name, "clickup", "creator"))
    return dedupe_by_key(people, "name")


def github_people(pull: dict[str, Any], reviews: list[dict[str, Any]] | None = None) -> list[dict[str, str]]:
    people: list[dict[str, str]] = []
    author = pull.get("user") if isinstance(pull.get("user"), dict) else None
    if isinstance(author, dict):
        name = normalize_text(author.get("login") or author.get("name"))
        if name:
            people.append(person(name, "github", "author"))
    merged_by = pull.get("merged_by") if isinstance(pull.get("merged_by"), dict) else None
    if isinstance(merged_by, dict):
        name = normalize_text(merged_by.get("login") or merged_by.get("name"))
        if name:
            people.append(person(name, "github", "merger"))
    for assignee in pull.get("assignees", []) if isinstance(pull.get("assignees"), list) else []:
        if not isinstance(assignee, dict):
            continue
        name = normalize_text(assignee.get("login") or assignee.get("name"))
        if name:
            people.append(person(name, "github", "assignee"))
    for reviewer in pull.get("requested_reviewers", []) if isinstance(pull.get("requested_reviewers"), list) else []:
        if not isinstance(reviewer, dict):
            continue
        name = normalize_text(reviewer.get("login") or reviewer.get("name"))
        if name:
            people.append(person(name, "github", "reviewer"))
    for review in reviews or []:
        if not isinstance(review, dict):
            continue
        user = review.get("user") if isinstance(review.get("user"), dict) else None
        if not isinstance(user, dict):
            continue
        name = normalize_text(user.get("login") or user.get("name"))
        if name:
            people.append(person(name, "github", "reviewer"))
    return dedupe_by_key(people, "name")


def build_topic_candidates(text_parts: list[str], topics: list[dict[str, Any]]) -> list[str]:
    text = "\n".join(part for part in text_parts if part)
    return match_topics(text, topics)


def normalize_clickup_task(task: dict[str, Any], window: Any, topics: list[dict[str, Any]]) -> dict[str, Any] | None:
    timestamp = (
        task.get("date_closed")
        or task.get("date_updated")
        or task.get("date_created")
    )
    if not within_window(timestamp, window):
        return None
    task_id = normalize_text(task.get("id"))
    title = normalize_text(task.get("name"))
    description = normalize_text(task.get("description"))
    status = normalize_text(task.get("status", {}).get("status") if isinstance(task.get("status"), dict) else task.get("status"))
    tag_names = [normalize_text(tag.get("name")) for tag in task.get("tags", []) if isinstance(tag, dict) and normalize_text(tag.get("name"))]
    participants = clickup_people(task)
    topic_candidates = build_topic_candidates([title, description, status, " ".join(tag_names)], topics)
    return {
        "id": f"clickup:{task_id}",
        "source": "clickup",
        "kind": "task",
        "timestamp": isoformat_or_default(timestamp, window.start),
        "title": title or f"ClickUp task {task_id}",
        "summary": description or title,
        "topic_candidates": topic_candidates,
        "participants": participants,
        "evidence": {
            "source_list_id": task.get("_source_list_id"),
            "status": status,
            "url": task.get("url"),
            "date_created": task.get("date_created"),
            "date_updated": task.get("date_updated"),
            "date_closed": task.get("date_closed"),
            "tags": tag_names,
        },
    }


def normalize_github_pull(pull: dict[str, Any], window: Any, topics: list[dict[str, Any]], reviews_by_pull: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    created_at = pull.get("created_at")
    closed_at = pull.get("closed_at")
    merged_at = pull.get("merged_at")
    if not any(within_window(value, window) for value in (created_at, closed_at, merged_at)):
        return None
    repository = normalize_text(pull.get("_repository") or pull.get("repository") or "unknown/unknown")
    number = pull.get("number")
    title = normalize_text(pull.get("title"))
    body = normalize_text(pull.get("body"))
    labels = [normalize_text(label.get("name")) for label in pull.get("labels", []) if isinstance(label, dict) and normalize_text(label.get("name"))]
    reviews = reviews_by_pull.get(f"{repository}#{number}", [])
    participants = github_people(pull, reviews)
    topic_candidates = build_topic_candidates([title, body, " ".join(labels), repository], topics)
    evidence_timestamp = merged_at or closed_at or created_at
    return {
        "id": f"github:{repository}#{number}",
        "source": "github",
        "kind": "pull_request",
        "timestamp": isoformat_or_default(evidence_timestamp, window.start),
        "title": title or f"Pull request {number}",
        "summary": body or title,
        "topic_candidates": topic_candidates,
        "participants": participants,
        "evidence": {
            "repository": repository,
            "number": number,
            "state": pull.get("state"),
            "html_url": pull.get("html_url"),
            "created_at": created_at,
            "closed_at": closed_at,
            "merged_at": merged_at,
            "labels": labels,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Path to the company config JSON")
    parser.add_argument("--input", required=True, help="Path to the raw bundle JSON")
    parser.add_argument("--output", required=True, help="Path to write the normalized bundle")
    args = parser.parse_args()

    config = load_json_file(args.config)
    raw = load_json_file(args.input)
    window = coerce_window(config, raw.get("window", {}).get("end") if isinstance(raw, dict) else None)
    topics = topic_catalog(config)

    normalized_items: list[dict[str, Any]] = []
    raw_clickup = raw.get("clickup", []) if isinstance(raw, dict) else []
    raw_github = raw.get("github", []) if isinstance(raw, dict) else []
    reviews_by_pull: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if isinstance(raw, dict):
        for repo_bundle in raw.get("github_reviews", []) if isinstance(raw.get("github_reviews"), list) else []:
            if not isinstance(repo_bundle, dict):
                continue
            for review in repo_bundle.get("reviews", []) if isinstance(repo_bundle.get("reviews"), list) else []:
                if not isinstance(review, dict):
                    continue
                repository = normalize_text(repo_bundle.get("repository") or "unknown/unknown")
                pull_number = normalize_text(repo_bundle.get("pull_number"))
                reviews_by_pull[f"{repository}#{pull_number}"].append(review)

    for task in raw_clickup if isinstance(raw_clickup, list) else []:
        if not isinstance(task, dict):
            continue
        normalized = normalize_clickup_task(task, window, topics)
        if normalized:
            normalized_items.append(normalized)

    for pull in raw_github if isinstance(raw_github, list) else []:
        if not isinstance(pull, dict):
            continue
        normalized = normalize_github_pull(pull, window, topics, reviews_by_pull)
        if normalized:
            normalized_items.append(normalized)

    normalized_items.sort(key=lambda item: (item["timestamp"], item["id"]))
    payload = {
        "window": window.as_dict(),
        "topics": topics,
        "items": normalized_items,
    }
    write_json_file(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
