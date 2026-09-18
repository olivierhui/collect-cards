from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import httpx

from . import store

ROOT = Path(__file__).resolve().parent.parent

# Cabinet content that must survive Render redeploys.
SYNC_JSON = (
    store.SITE.relative_to(ROOT).as_posix(),
    store.CATALOG.relative_to(ROOT).as_posix(),
)
CARDS_PREFIX = store.CARDS.relative_to(ROOT).as_posix()  # data/cards


def enabled() -> bool:
    return bool(os.getenv("GITHUB_TOKEN"))


def _repo() -> str:
    return os.getenv("GITHUB_REPO") or "olivierhui/collect-cards"


def _branch() -> str:
    return os.getenv("GITHUB_BRANCH") or "main"


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "collect-cards-admin",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _local_card_files() -> list[Path]:
    if not store.CARDS.is_dir():
        return []
    out: list[Path] = []
    for path in store.CARDS.rglob("*"):
        if path.is_file() and path.name != ".gitkeep":
            out.append(path)
    return sorted(out)


def _collect_local_relpaths() -> dict[str, Path]:
    """relpath -> local Path for every file we mirror to GitHub."""
    mapping: dict[str, Path] = {}
    for rel in SYNC_JSON:
        local = ROOT / rel
        if local.is_file():
            mapping[rel] = local
    for path in _local_card_files():
        mapping[path.relative_to(ROOT).as_posix()] = path
    return mapping


async def _remote_card_paths(client: httpx.AsyncClient, repo: str, tree_sha: str) -> set[str]:
    """All blob paths under data/cards/ on the current commit tree."""
    url = f"https://api.github.com/repos/{repo}/git/trees/{tree_sha}"
    r = await client.get(url, params={"recursive": "1"})
    if r.status_code != 200:
        return set()
    paths: set[str] = set()
    for row in (r.json() or {}).get("tree") or []:
        if row.get("type") != "blob":
            continue
        path = str(row.get("path") or "")
        if path.startswith(CARDS_PREFIX + "/") and not path.endswith("/.gitkeep"):
            paths.add(path)
    return paths


async def push_data_files(message: str) -> dict[str, Any]:
    """Push site/catalog + every card file; delete GitHub card files removed locally.

    Uses one Git commit via the Git Data API so add/delete stays atomic.
    """
    token = (os.getenv("GITHUB_TOKEN") or "").strip()
    if not token:
        return {"ok": False, "reason": "no-token"}

    headers = _headers(token)
    repo = _repo()
    branch = _branch()
    local_map = _collect_local_relpaths()

    async with httpx.AsyncClient(timeout=120.0, headers=headers) as client:
        ref = await client.get(f"https://api.github.com/repos/{repo}/git/ref/heads/{branch}")
        if ref.status_code != 200:
            return {"ok": False, "reason": f"ref:{ref.text[:300]}"}
        head_sha = ((ref.json() or {}).get("object") or {}).get("sha")
        if not head_sha:
            return {"ok": False, "reason": "no-head-sha"}

        commit = await client.get(f"https://api.github.com/repos/{repo}/git/commits/{head_sha}")
        if commit.status_code != 200:
            return {"ok": False, "reason": f"commit:{commit.text[:300]}"}
        base_tree = ((commit.json() or {}).get("tree") or {}).get("sha")
        if not base_tree:
            return {"ok": False, "reason": "no-base-tree"}

        remote_cards = await _remote_card_paths(client, repo, base_tree)
        local_card_rels = {p for p in local_map if p.startswith(CARDS_PREFIX + "/")}
        to_delete = sorted(remote_cards - local_card_rels)

        tree_items: list[dict[str, Any]] = []
        uploaded: list[str] = []

        for rel, path in local_map.items():
            raw = path.read_bytes()
            blob = await client.post(
                f"https://api.github.com/repos/{repo}/git/blobs",
                json={
                    "content": base64.b64encode(raw).decode("ascii"),
                    "encoding": "base64",
                },
            )
            if blob.status_code not in {200, 201}:
                return {"ok": False, "reason": blob.text[:300], "file": rel}
            blob_sha = (blob.json() or {}).get("sha")
            if not blob_sha:
                return {"ok": False, "reason": "no-blob-sha", "file": rel}
            tree_items.append(
                {
                    "path": rel,
                    "mode": "100644",
                    "type": "blob",
                    "sha": blob_sha,
                }
            )
            uploaded.append(rel)

        for rel in to_delete:
            tree_items.append(
                {
                    "path": rel,
                    "mode": "100644",
                    "type": "blob",
                    "sha": None,
                }
            )

        if not tree_items:
            return {"ok": True, "files": [], "deleted": [], "skipped": "nothing-to-sync"}

        tree = await client.post(
            f"https://api.github.com/repos/{repo}/git/trees",
            json={"base_tree": base_tree, "tree": tree_items},
        )
        if tree.status_code not in {200, 201}:
            return {"ok": False, "reason": tree.text[:300]}
        new_tree = (tree.json() or {}).get("sha")
        if not new_tree:
            return {"ok": False, "reason": "no-new-tree"}

        new_commit = await client.post(
            f"https://api.github.com/repos/{repo}/git/commits",
            json={
                "message": message,
                "tree": new_tree,
                "parents": [head_sha],
            },
        )
        if new_commit.status_code not in {200, 201}:
            return {"ok": False, "reason": new_commit.text[:300]}
        new_sha = (new_commit.json() or {}).get("sha")
        if not new_sha:
            return {"ok": False, "reason": "no-new-commit"}

        upd = await client.patch(
            f"https://api.github.com/repos/{repo}/git/refs/heads/{branch}",
            json={"sha": new_sha},
        )
        if upd.status_code != 200:
            return {"ok": False, "reason": upd.text[:300]}

    return {
        "ok": True,
        "files": uploaded,
        "deleted": to_delete,
        "commit": new_sha,
    }
