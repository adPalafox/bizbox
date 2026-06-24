#!/usr/bin/env python3
"""Collect ClickUp and GitHub data for the weekly retro context window."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from _shared import coerce_window, expand_template, http_get_json, load_json_file, write_json_file


def load_source_list(path: str | None, key: str) -> list[dict[str, Any]]:
    if not path:
        return []
    payload = load_json_file(path)
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def fetch_clickup_tasks(config: dict[str, Any], token: str | None) -> list[dict[str, Any]]:
    clickup_cfg = config.get("clickup", {})
    if not clickup_cfg.get("enabled", False):
        return []
    base_url = str(clickup_cfg.get("baseUrl") or "https://api.clickup.com/api/v2").rstrip("/")
    team_id = str(clickup_cfg.get("teamId") or "").strip()
    list_ids = [str(item).strip() for item in clickup_cfg.get("listIds", []) if str(item).strip()]
    page_size = int(clickup_cfg.get("pageSize") or 100)
    include_subtasks = "true" if clickup_cfg.get("includeSubtasks", True) else "false"
    include_closed = "true" if clickup_cfg.get("includeClosed", True) else "false"
    task_template = str(clickup_cfg.get("taskPathTemplate") or "/list/{listId}/task")

    tasks: list[dict[str, Any]] = []
    for list_id in list_ids:
        page = 0
        while True:
            path = expand_template(task_template, listId=list_id, teamId=team_id)
            query = urlencode(
                {
                    "page": page,
                    "subtasks": include_subtasks,
                    "include_closed": include_closed,
                    "limit": page_size,
                }
            )
            url = f"{base_url}{path}?{query}"
            response = http_get_json(url, token, auth_scheme="raw")
            batch: list[dict[str, Any]] = []
            if isinstance(response, dict):
                for key in ("tasks", "data", "items"):
                    value = response.get(key)
                    if isinstance(value, list):
                        batch = [item for item in value if isinstance(item, dict)]
                        break
            elif isinstance(response, list):
                batch = [item for item in response if isinstance(item, dict)]
            if not batch:
                break
            for task in batch:
                task["_source_list_id"] = list_id
                task["_source_team_id"] = team_id
                tasks.append(task)
            if len(batch) < page_size:
                break
            page += 1
    return tasks


def fetch_github_pulls(config: dict[str, Any], token: str | None) -> list[dict[str, Any]]:
    github_cfg = config.get("github", {})
    if not github_cfg.get("enabled", False):
        return []
    base_url = str(github_cfg.get("baseUrl") or "https://api.github.com").rstrip("/")
    repositories = [str(item).strip() for item in github_cfg.get("repositories", []) if str(item).strip()]
    page_size = int(github_cfg.get("pageSize") or 100)

    pulls: list[dict[str, Any]] = []
    for repo in repositories:
        if "/" not in repo:
            continue
        owner, repo_name = repo.split("/", 1)
        page = 1
        while True:
            path = f"/repos/{owner}/{repo_name}/pulls"
            query = urlencode({"state": "all", "per_page": page_size, "page": page})
            url = f"{base_url}{path}?{query}"
            response = http_get_json(url, token)
            batch = [item for item in response if isinstance(item, dict)] if isinstance(response, list) else []
            if not batch:
                break
            for pull in batch:
                pull["_repository"] = repo
                pulls.append(pull)
            if len(batch) < page_size:
                break
            page += 1
    return pulls


def fetch_github_reviews(config: dict[str, Any], pulls: list[dict[str, Any]], token: str | None) -> list[dict[str, Any]]:
    github_cfg = config.get("github", {})
    if not github_cfg.get("enabled", False) or not github_cfg.get("includeReviews", True):
        return []
    base_url = str(github_cfg.get("baseUrl") or "https://api.github.com").rstrip("/")
    reviews_template = str(github_cfg.get("reviewsPathTemplate") or "/repos/{owner}/{repo}/pulls/{pullNumber}/reviews")

    reviews_by_repo_pull: dict[str, list[dict[str, Any]]] = {}
    for pull in pulls:
        repository = str(pull.get("_repository") or "").strip()
        number = str(pull.get("number") or "").strip()
        if not repository or not number or "/" not in repository:
            continue
        owner, repo_name = repository.split("/", 1)
        path = expand_template(reviews_template, owner=owner, repo=repo_name, pullNumber=number)
        url = f"{base_url}{path}"
        response = http_get_json(url, token)
        batch = [item for item in response if isinstance(item, dict)] if isinstance(response, list) else []
        reviews_by_repo_pull[f"{repository}#{number}"] = batch

    output: list[dict[str, Any]] = []
    for key, reviews in reviews_by_repo_pull.items():
        repository, _, number = key.partition("#")
        output.append({
            "repository": repository,
            "pull_number": number,
            "reviews": reviews,
        })
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Path to the company config JSON")
    parser.add_argument("--output", required=True, help="Path to write the collected raw bundle")
    parser.add_argument("--window-end", help="ISO timestamp to use as the end of the 7-day window")
    parser.add_argument("--clickup-file", help="Fixture JSON file for ClickUp data")
    parser.add_argument("--github-file", help="Fixture JSON file for GitHub data")
    args = parser.parse_args()

    config = load_json_file(args.config)
    window = coerce_window(config, args.window_end)
    clickup_token = os.environ.get("CLICKUP_API_TOKEN")
    github_token = os.environ.get("GITHUB_TOKEN")

    if args.clickup_file:
        clickup_tasks = load_source_list(args.clickup_file, "tasks")
        clickup_mode = "fixture"
    else:
        clickup_tasks = fetch_clickup_tasks(config, clickup_token)
        clickup_mode = "api"

    if args.github_file:
        github_pulls = load_source_list(args.github_file, "pulls")
        github_mode = "fixture"
        github_reviews: list[dict[str, Any]] = []
    else:
        github_pulls = fetch_github_pulls(config, github_token)
        github_mode = "api"
        github_reviews = fetch_github_reviews(config, github_pulls, github_token)

    payload = {
        "window": window.as_dict(),
        "captured_at": window.end.isoformat(),
        "source_modes": {
            "clickup": clickup_mode,
            "github": github_mode,
        },
        "clickup": clickup_tasks,
        "github": github_pulls,
        "github_reviews": github_reviews,
    }
    write_json_file(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
