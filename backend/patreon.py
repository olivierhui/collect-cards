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
        "scope": "identity identity.memberships campaigns",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            TOKEN_URL,
            headers={"User-Agent": "collect-cards (https://collect-cards.onrender.com)"},
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
        "include": "memberships.currently_entitled_tiers,campaign",
        "fields[user]": "full_name,vanity",
        "fields[tier]": "title,amount_cents",
        "fields[member]": "patron_status,last_charge_status,currently_entitled_amount_cents",
        "fields[campaign]": "creation_name,url,vanity",
    }
    headers = {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "collect-cards (https://collect-cards.onrender.com)",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(IDENTITY_URL, params=params, headers=headers)
        r.raise_for_status()
        return r.json()


def creator_vanities() -> set[str]:
    extra = (os.getenv("PATREON_CREATOR_VANITY") or "").lower()
    names = {"18animegirls", "uiuianime"}
    if extra:
        names.add(extra)
    return names


def is_campaign_creator(identity_json: dict[str, Any]) -> bool:
    """This site's creator counts as T5 so they can test the cabinet."""
    data = identity_json.get("data") or {}
    pid = str(data.get("id") or "")
    attrs = data.get("attributes") or {}
    vanity = (attrs.get("vanity") or "").lower()
    full_name = (attrs.get("full_name") or "").lower().replace(" ", "")
    creator_id = (os.getenv("PATREON_CREATOR_USER_ID") or "").strip()
    if creator_id and pid == creator_id:
        return True
    known = creator_vanities()
    if vanity in known or full_name in known:
        return True
    campaign_id = (os.getenv("PATREON_CAMPAIGN_ID") or "").strip()
    camp = ((data.get("relationships") or {}).get("campaign") or {}).get("data") or {}
    if camp.get("id"):
        if not campaign_id or str(camp.get("id")) == campaign_id:
            return True
    for row in identity_json.get("included") or []:
        if row.get("type") == "campaign":
            if not campaign_id or str(row.get("id") or "") == campaign_id:
                return True
            cv = ((row.get("attributes") or {}).get("vanity") or "").lower()
            if vanity and cv and vanity == cv:
                return True
    return False


def map_tier(identity_json: dict[str, Any]) -> tuple[str | None, str]:
    """Return (t3|t4|t5|t6|t7|None, display name). T6/T7 are prism same as T5."""
    data = identity_json.get("data") or {}
    name = ((data.get("attributes") or {}).get("full_name")) or "Patron"
    if is_campaign_creator(identity_json):
        return "t5", name
    included = identity_json.get("included") or []
    t3 = os.getenv("PATREON_TIER_T3") or ""
    t4 = os.getenv("PATREON_TIER_T4") or ""
    t5 = os.getenv("PATREON_TIER_T5") or ""
    t6 = os.getenv("PATREON_TIER_T6") or ""
    t7 = os.getenv("PATREON_TIER_T7") or ""
    entitled: list[str] = []
    titles: dict[str, str] = {}
    for row in included:
        if row.get("type") == "tier":
            tid = str(row.get("id") or "")
            titles[tid] = ((row.get("attributes") or {}).get("title") or "").lower()
            entitled.append(tid)
    # Highest paid wins: t7 > t6 > t5 > t4 > t3 (t5/t6/t7 all prism frames).
    order = {"t3": 1, "t4": 2, "t5": 3, "t6": 4, "t7": 5}
    rank = None

    def bump(next_rank: str) -> None:
        nonlocal rank
        if rank is None or order.get(next_rank, 0) > order.get(rank, 0):
            rank = next_rank

    for tid in entitled:
        title = titles.get(tid, "")
        if tid == t7 or "t7" in title:
            bump("t7")
        elif tid == t6 or "t6" in title:
            bump("t6")
        elif tid == t5 or "t5" in title or "幻彩" in title or "prism" in title:
            bump("t5")
        elif tid == t4 or "t4" in title or "黄金" in title or "gold" in title:
            bump("t4")
        elif tid == t3 or "t3" in title or "白银" in title or "silver" in title:
            bump("t3")
    return rank, name
