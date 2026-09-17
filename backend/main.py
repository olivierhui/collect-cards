from __future__ import annotations

import json
import os
import secrets
import shutil
import tempfile
import zipfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import github_sync
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


def require_creator(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(401, "请先登录")
    if user.get("creator") or str(user.get("id") or "").startswith("mock-"):
        return user
    raise HTTPException(403, "只有创作者能进后台")


def login_and_grant(
    request: Request, pid: str, name: str, tier: str | None, creator: bool = False
) -> None:
    store.upsert_user(pid, name, tier, creator=creator)
    request.session["pid"] = pid
    store.ensure_entitlements(pid)


@app.get("/")
async def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/admin")
async def admin_page():
    return FileResponse(FRONTEND / "admin.html")


@app.get("/api/site")
async def api_site():
    return {"ok": True, "site": store.site(), "today": store.today_str()}


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
        "subscribeUrl": store.site().get("subscribeUrl") or os.getenv("PATREON_PAGE_URL") or "https://www.patreon.com/18animegirls",
        "subscribeLabel": store.site().get("subscribeLabel") or "去 Patreon 订阅",
        "site": store.site(),
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


@app.get("/api/admin/state")
async def admin_state(request: Request):
    require_creator(request)
    cat = store.catalog()
    drops = {day: list(codes) for day, codes in (cat.get("_drops") or {}).items()}
    chars = [{"id": ch.get("id"), "name": ch.get("name") or "", "cards": ch.get("cards") or []} for ch in (cat.get("characters") or [])]
    return {
        "ok": True,
        "today": store.today_str(),
        "site": store.site(),
        "seasonTitle": cat.get("seasonTitle") or "",
        "slots": int(cat.get("slots") or 24),
        "drops": drops,
        "characters": chars,
        "codes": store.list_card_codes(),
        "github": github_sync.enabled(),
        "layout": store.site_layout(),
    }


@app.post("/api/admin/save")
async def admin_save(request: Request):
    require_creator(request)
    body = await request.json()
    site = store.save_site(body.get("site") or {})
    cat = store.save_admin_catalog(body)
    gh = await github_sync.push_data_files("admin: update cabinet site")
    live = store.catalog()
    return {
        "ok": True,
        "site": site,
        "seasonTitle": cat.get("seasonTitle") or "",
        "slots": int(cat.get("slots") or 24),
        "drops": live.get("_drops") or {},
        "characters": live.get("characters") or [],
        "today": store.today_str(),
        "github": gh,
        "layout": store.site_layout(),
    }


@app.get("/api/admin/drop-impact")
async def admin_drop_impact(request: Request, code: str = ""):
    require_creator(request)
    code = (code or "").strip()
    if not store.FOLDER_RE.match(code):
        raise HTTPException(400, "编号必须是 S1-001-1 这种")
    return {"ok": True, **store.drop_impact(code)}


@app.post("/api/admin/drop-fix")
async def admin_drop_fix(request: Request):
    require_creator(request)
    body = await request.json()
    try:
        result = store.fix_drop(
            action=str(body.get("action") or ""),
            code=str(body.get("code") or ""),
            day=str(body.get("day") or ""),
            new_code=str(body.get("newCode") or ""),
            new_day=str(body.get("newDay") or ""),
            inventory_mode=str(body.get("inventory") or "keep"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    gh = await github_sync.push_data_files(
        f"admin: drop-fix {result.get('action')} {result.get('code')}"
    )
    result["github"] = gh
    return result


@app.post("/api/admin/schedule")
async def admin_schedule(request: Request):
    require_creator(request)
    body = await request.json()
    code = str(body.get("code") or "").strip()
    day = str(body.get("day") or "").strip() or store.today_str()
    try:
        rec = store.register_drop(code, day, str(body.get("name") or ""), str(body.get("title") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    await github_sync.push_data_files(f"admin: schedule {code} {day}")
    return rec


@app.get("/api/admin/library")
async def admin_library(request: Request):
    require_creator(request)
    cat = store.catalog()
    drops = cat.get("_drops") or {}
    by_code_day: dict[str, list[str]] = {}
    for day, codes in drops.items():
        for code in codes:
            by_code_day.setdefault(code, []).append(day)
    items = []
    for card in store.scan_disk_cards():
        items.append(
            {
                "code": card["code"],
                "name": card.get("name") or "",
                "date": card.get("date") or "",
                "characterId": card["characterId"],
                "days": by_code_day.get(card["code"]) or [],
                "thumb": f"/api/admin/assets/{card['code']}/original.png",
                "holders": len(store.holders_of(card["code"])),
            }
        )
    return {"ok": True, "today": store.today_str(), "cards": items}


@app.get("/api/admin/assets/{code}/{filename}")
async def admin_asset(code: str, filename: str, request: Request):
    require_creator(request)
    if filename not in {"original.png", "subject.png", "background.png"}:
        raise HTTPException(404, "not allowed")
    path = store.card_dir(code) / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)


@app.post("/api/admin/card-zip")
async def admin_card_zip(
    request: Request,
    file: UploadFile = File(...),
    date: str = Form(""),
):
    require_creator(request)
    day = (date or "").strip() or store.today_str()
    suffix = Path(file.filename or "card.zip").suffix.lower()
    if suffix != ".zip":
        raise HTTPException(400, "请上传 ZIP")
    root_tmp = Path(tempfile.mkdtemp(prefix="cardzip-"))
    try:
        raw = await file.read()
        zpath = root_tmp / "card.zip"
        zpath.write_bytes(raw)
        with zipfile.ZipFile(zpath) as zf:
            zf.extractall(root_tmp)
        folder = root_tmp
        if not (folder / "meta.json").is_file():
            found = next(root_tmp.rglob("meta.json"), None)
            if found:
                folder = found.parent
        meta_path = folder / "meta.json"
        meta = {}
        if meta_path.is_file():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        serial = str(meta.get("serial") or Path(file.filename or "").stem)
        m = store.FOLDER_RE.match(serial.strip())
        if not m:
            raise HTTPException(400, "ZIP 里 meta.json 的 serial 要写成 S1-001-1")
        code = f"{m.group(1).upper()}-{m.group(2).zfill(3)}-{int(m.group(3) or 1)}"
        dest = store.CARDS / code
        dest.mkdir(parents=True, exist_ok=True)
        for name in ("original.png", "background.png", "subject.png", "meta.json"):
            src = folder / name
            if src.is_file():
                shutil.copy2(src, dest / name)
        for src in folder.glob("extra_*.png"):
            shutil.copy2(src, dest / src.name)
        meta["serial"] = code
        meta["date"] = day
        (dest / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        store.register_drop(code, day, meta.get("name") or "", meta.get("name") or "")
        await github_sync.push_data_files(f"admin: add card {code}")
        return {"ok": True, "code": code, "date": day}
    finally:
        shutil.rmtree(root_tmp, ignore_errors=True)


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
