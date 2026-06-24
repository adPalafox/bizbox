#!/usr/bin/env python3
"""Shared helpers for the weekly retro context scripts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime
    timezone: str

    def as_dict(self) -> dict[str, str]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "timezone": self.timezone,
        }


def load_json_file(path: str | os.PathLike[str]) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_file(path: str | os.PathLike[str], payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


def parse_iso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return " ".join(str(value).split()).strip()


def lower_join(values: Iterable[str]) -> str:
    return "\n".join(v.lower() for v in values if v)


def dedupe_by_key(items: Iterable[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    seen: set[Any] = set()
    output: list[dict[str, Any]] = []
    for item in items:
        marker = item.get(key)
        if marker in seen:
            continue
        seen.add(marker)
        output.append(item)
    return output


def isoformat_or_default(value: Any, default: datetime) -> str:
    parsed = parse_iso_datetime(value)
    if parsed is None:
        return default.isoformat()
    return parsed.isoformat()


def coerce_window(config: dict[str, Any], window_end: str | None = None) -> Window:
    window_cfg = config.get("window", {})
    timezone_name = normalize_text(window_cfg.get("timezone") or "UTC") or "UTC"
    tz = ZoneInfo(timezone_name)
    end = parse_iso_datetime(window_end) if window_end else None
    if end is None:
        end = datetime.now(tz)
    if end.tzinfo is None:
        end = end.replace(tzinfo=tz)
    else:
        end = end.astimezone(tz)
    end = end.replace(second=0, microsecond=0)
    lookback_days = int(window_cfg.get("lookbackDays") or 7)
    start = (end - timedelta(days=lookback_days)).replace(second=0, microsecond=0)
    return Window(start=start, end=end, timezone=timezone_name)


def within_window(value: Any, window: Window) -> bool:
    parsed = parse_iso_datetime(value)
    if parsed is None:
        return False
    local = parsed.astimezone(ZoneInfo(window.timezone))
    return window.start <= local < window.end


def topic_catalog(config: dict[str, Any]) -> list[dict[str, Any]]:
    topics = config.get("topics", [])
    if not isinstance(topics, list):
        return []
    output: list[dict[str, Any]] = []
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        slug = normalize_text(topic.get("slug"))
        label = normalize_text(topic.get("label"))
        keywords = [normalize_text(keyword).lower() for keyword in topic.get("keywords", []) if normalize_text(keyword)]
        if slug and label:
            output.append({"slug": slug, "label": label, "keywords": keywords})
    return output


def match_topics(text: str, topics: list[dict[str, Any]]) -> list[str]:
    haystack = text.lower()
    matches = [topic["slug"] for topic in topics if any(keyword in haystack for keyword in topic["keywords"])]
    if not matches:
        return ["general-context"]
    ordered: list[str] = []
    for slug in matches:
        if slug not in ordered:
            ordered.append(slug)
    return ordered


def http_get_json(url: str, token: str | None = None, auth_scheme: str = "bearer") -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "weekly-retro-context/1.0",
    }
    if token:
        scheme = auth_scheme.strip().lower()
        if scheme == "raw":
            headers["Authorization"] = token
        else:
            headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=60) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload)
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} while fetching {url}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not fetch {url}: {exc.reason}") from exc


def expand_template(template: str, **values: Any) -> str:
    output = template
    for key, value in values.items():
        output = output.replace(f"{{{key}}}", str(value))
    return output
