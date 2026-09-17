from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

import httpx

AUTH_URL = "https://www.patreon.com/oauth2/authorize"
TOKEN_URL = "https://www.patreon.com/api/oauth2/token"
IDENTITY_URL = "https://www.patreon.com/api/oauth2/v2/identity"


def configured() -> bool:
    return bool(os.getenv("PATREON_CLIENT_ID") and os.getenv("PATREON_CLIENT_SECRET"))


def login_url(state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": os.getenv("PATREON_CLIENT_ID"),
        "redirect_uri": os.getenv("PATREON_REDIRECT_URI"),
        "scope": "identity identity.memberships",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": os.getenv("PATREON_CLIENT_ID"),
                "client_secret": os.getenv("PATREON_CLIENT_SECRET"),
                "redirect_uri": os.getenv("PATREON_REDIRECT_URI"),
            },
        )
        r.raise_for_status()
        return r.json()


async def identity(access_token: str) -> dict[str, Any]:
    params = {
        "include": "memberships.currently_entitled_tiers",
        "fields[user]": "full_name,vanity",
        "fields[tier]": "title,amount_cents",
        "fields[member]": "patron_status,last_charge_status,currently_entitled_amount_cents",
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(IDENTITY_URL, params=params, headers=headers)
        r.raise_for_status()
        return r.json()


def map_tier(identity_json: dict[str, Any]) -> tuple[str | None, str]:
    """Return (t3|t4|t5|None, display name)."""
    data = identity_json.get("data") or {}
    name = ((data.get("attributes") or {}).get("full_name")) or "Patron"
    included = identity_json.get("included") or []
    t3 = os.getenv("PATREON_TIER_T3") or ""
    t4 = os.getenv("PATREON_TIER_T4") or ""
    t5 = os.getenv("PATREON_TIER_T5") or ""
    entitled: list[str] = []
    titles: dict[str, str] = {}
    for row in included:
        if row.get("type") == "tier":
            tid = str(row.get("id") or "")
            titles[tid] = ((row.get("attributes") or {}).get("title") or "").lower()
            entitled.append(tid)
    # membership include may nest; also scan relationships
    rel = (((data.get("relationships") or {}).get("memberships") or {}).get("data")) or []
    # entitled tiers appear as type=tier in included when currently_entitled_tiers is requested
    rank = None
    for tid in entitled:
        title = titles.get(tid, "")
        if tid == t5 or "t5" in title or "幻彩" in title or "prism" in title:
            rank = "t5"
        elif tid == t4 or "t4" in title or "黄金" in title or "gold" in title:
            if rank != "t5":
                rank = "t4"
        elif tid == t3 or "t3" in title or "白银" in title or "silver" in title:
            if rank not in {"t4", "t5"}:
                rank = "t3"
    return rank, name
