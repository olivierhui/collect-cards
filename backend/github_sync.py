from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import httpx

from . import store

ROOT = Path(__file__).resolve().parent.parent


def enabled() -> bool:
    return bool(os.getenv("GITHUB_TOKEN"))


def _repo() -> str:
    return os.getenv("GITHUB_REPO") or "olivierhui/collect-cards"


def _branch() -> str:
    return os.getenv("GITHUB_BRANCH") or "main"


async def push_data_files(message: str) -> dict[str, Any]:
    token = (os.getenv("GITHUB_TOKEN") or "").strip()
    if not token:
        return {"ok": False, "reason": "no-token"}
    paths = [
        store.SITE.relative_to(ROOT).as_posix(),
        store.CATALOG.relative_to(ROOT).as_posix(),
    ]
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "collect-cards-admin",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    repo = _repo()
    branch = _branch()
    done = []
    async with httpx.AsyncClient(timeout=30) as client:
        for rel in paths:
            local = ROOT / rel
            if not local.is_file():
                continue
            url = f"https://api.github.com/repos/{repo}/contents/{rel}"
            sha = None
            get = await client.get(url, headers=headers, params={"ref": branch})
            if get.status_code == 200:
                sha = (get.json() or {}).get("sha")
            content = base64.b64encode(local.read_bytes()).decode("ascii")
            body: dict[str, Any] = {
                "message": message,
                "content": content,
                "branch": branch,
            }
            if sha:
                body["sha"] = sha
            put = await client.put(url, headers=headers, json=body)
            if put.status_code not in {200, 201}:
                return {"ok": False, "reason": put.text[:300], "file": rel}
            done.append(rel)
    return {"ok": True, "files": done}
