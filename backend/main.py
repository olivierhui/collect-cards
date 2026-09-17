from __future__ import annotations

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import patreon
from . import store

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

app = FastAPI(title="收集卡系列")
_on_https = os.getenv("RENDER") == "true" or (os.getenv("APP_PUBLIC_URL") or "").startswith("https://")
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("APP_SECRET") or "dev-secret-change-me",
    same_site="lax",
    https_only=_on_https,
)

FRONTEND = ROOT / "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


def current_user(request: Request) -> dict | None:
    pid = request.session.get("pid")
    if not pid:
        return None
    return store.users().get(pid)


def login_and_grant(
    request: Request, pid: str, name: str, tier: str | None, creator: bool = False
) -> None:
    store.upsert_user(pid, name, tier, creator=creator)
    request.session["pid"] = pid
    store.ensure_entitlements(pid)


@app.get("/")
async def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/api/health")
async def health():
    return {"ok": True, "patreon": patreon.configured(), "today": store.today_str()}


@app.get("/api/me")
async def me(request: Request):
    user = current_user(request)
    if not user:
        return {"ok": True, "user": None, "patreonReady": patreon.configured()}
    store.ensure_entitlements(user["id"])
    return {
        "ok": True,
        "user": {
            "id": user["id"],
            "name": user.get("name"),
            "paid": store.paid_tier(user.get("tier")),
            "creator": bool(user.get("creator")),
            "mock": str(user.get("id") or "").startswith("mock-"),
        },
        "today": store.today_str(),
        "todayDrops": store.drops_for_date(store.today_str()),
        "patreonReady": patreon.configured(),
        "subscribeUrl": os.getenv("PATREON_PAGE_URL") or "https://www.patreon.com/18animegirls",
    }


@app.get("/auth/patreon")
async def auth_start(request: Request):
    if not patreon.configured():
        raise HTTPException(400, "还没配置 PATREON_CLIENT_ID，请先用模拟登录")
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    return RedirectResponse(patreon.login_url(state))


@app.get("/auth/patreon/callback")
async def auth_callback(request: Request, code: str = "", state: str = ""):
    if not code or state != request.session.get("oauth_state"):
        raise HTTPException(400, "OAuth state 无效")
    tokens = await patreon.exchange_code(code)
    ident = await patreon.identity(tokens["access_token"])
    pid = str((ident.get("data") or {}).get("id") or "")
    if not pid:
        raise HTTPException(400, "读不到 Patreon 用户")
    tier, name = patreon.map_tier(ident)
    creator = patreon.is_campaign_creator(ident)
    login_and_grant(request, pid, name, tier, creator=creator)
    return RedirectResponse("/")


@app.get("/auth/mock")
async def auth_mock(request: Request, tier: str = "t3", name: str = "测试会员"):
    if patreon.configured() and not os.getenv("ALLOW_MOCK"):
        raise HTTPException(400, "已接 Patreon，关闭模拟登录")
    if tier not in {"t3", "t4", "t5", "none"}:
        raise HTTPException(400, "tier 只能是 t3/t4/t5/none")
    pid = request.session.get("pid") or f"mock-{secrets.token_hex(4)}"
    login_and_grant(request, pid, name, None if tier == "none" else tier)
    return RedirectResponse("/")


@app.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/cabinet")
async def api_cabinet(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "请先登录")
    return store.cabinet(user["id"])


@app.post("/api/dev/renewal-bonus")
async def api_renewal_bonus(request: Request, x_admin_key: str | None = Header(default=None)):
    """模拟/管理员触发续约补给。满月判定以后再接。"""
    user = current_user(request)
    admin = os.getenv("ADMIN_KEY") or ""
    allowed = bool(user and str(user.get("id") or "").startswith("mock-"))
    if admin and x_admin_key == admin:
        allowed = True
    if not allowed:
        raise HTTPException(403, "只能用模拟登录或管理员钥匙触发补给")
    if not user:
        raise HTTPException(401, "请先登录")
    try:
        recs = store.grant_renewal_bonus(user["id"])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "granted": recs}


@app.post("/api/cover")
async def api_cover(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "请先登录")
    body = await request.json()
    try:
        store.set_cover(user["id"], str(body.get("characterId") or ""), str(body.get("code") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


@app.get("/api/cards/{code}")
async def api_card(code: str, request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "请先登录")
    owned = store.owned_cards(user["id"])
    hit = next((c for c in owned if c["code"] == code), None)
    if not hit:
        raise HTTPException(403, "柜里没有这张卡")
    files = store.card_files(code)
    meta = {}
    meta_path = files.get("meta.json")
    if meta_path:
        import json

        meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    return {
        "ok": True,
        "card": hit,
        "files": {k: f"/api/assets/{code}/{k}" for k in files if k != "meta.json"},
        "meta": meta,
        "canSeeBack": True,
    }


@app.get("/api/assets/{code}/{filename}")
async def api_asset(code: str, filename: str, request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401)
    owned = store.owned_cards(user["id"])
    if not any(c["code"] == code for c in owned):
        raise HTTPException(403)
    safe = Path(filename).name
    path = store.card_dir(code) / safe
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)


@app.get("/{path:path}")
async def spa(path: str):
    if path.startswith("api/") or path.startswith("auth/"):
        raise HTTPException(404)
    target = FRONTEND / path
    if target.is_file():
        return FileResponse(target)
    return FileResponse(FRONTEND / "index.html")
