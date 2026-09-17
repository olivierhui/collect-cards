from __future__ import annotations

"""
柜库存：T3+ 自动入柜，不是领取。

规则（不要改口径）：
- 只有当天仍是 t3/t4/t5 才会拿到「投放日 = 当天」的新卡。
- 框 = 第一次入柜那天的档位（silver/gold/prism）。升档不改旧框。
- 降档：旧卡保留，从当天起不再发新卡。
- 月中才升到 T3：升档前那些投放日没有 tierLog = 空槽，不补。
- 一天可以多张：drops[日期] 可以是字符串或字符串数组。
- 续约补给：满一个月并续上下一个月，从她空着的已投放号里随机抽 2 张，
  框按补给当天档位。满月判定这周不做，见 grant_renewal_bonus。
- 隐藏卡：连续订满 2 个月以上每月一张。卡面未定，这周不发卡、不写发放逻辑。
- Shop 包不含隐藏卡；这周网站不收银。
"""

import json
import random
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CARDS = DATA / "cards"
USERS = DATA / "users.json"
INVENTORY = DATA / "inventory.json"
CLAIMS_LEGACY = DATA / "claims.json"
CATALOG = DATA / "catalog.json"
COVERS = DATA / "covers.json"
SITE = DATA / "site.json"

SITE_DEFAULT = {
    "kicker": "18ANIME GIRLS",
    "title": "个人典藏柜",
    "gate": "登录后打开你的个人典藏柜。当天仍在订的会员，卡会自动入柜。",
    "subscribeUrl": "https://www.patreon.com/18animegirls",
    "subscribeLabel": "去 Patreon 订阅",
    "pageTitle": "收集卡系列 · 展示柜",
}

DATA.mkdir(parents=True, exist_ok=True)
CARDS.mkdir(parents=True, exist_ok=True)

PAID_TIERS = ("t3", "t4", "t5")
FOLDER_RE = re.compile(r"^(S\d+)-(\d{1,3})(?:-(\d+))?$", re.I)


def _read(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def paid_tier(tier: str | None) -> bool:
    return tier in PAID_TIERS


def as_code_list(mapped: Any) -> list[str]:
    if not mapped:
        return []
    if isinstance(mapped, str):
        return [mapped]
    if isinstance(mapped, list):
        return [str(x) for x in mapped if x]
    return []


def as_grant_list(rec: Any) -> list[dict[str, Any]]:
    if rec is None:
        return []
    if isinstance(rec, list):
        return [x for x in rec if isinstance(x, dict) and x.get("code")]
    if isinstance(rec, dict) and rec.get("code"):
        return [rec]
    return []


def scan_disk_cards() -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if not CARDS.is_dir():
        return found
    for folder in sorted(CARDS.iterdir()):
        if not folder.is_dir():
            continue
        m = FOLDER_RE.match(folder.name)
        if not m:
            continue
        if not (folder / "original.png").is_file() and not (folder / "subject.png").is_file():
            continue
        season = m.group(1).upper()
        cid = m.group(2).zfill(3)
        n = int(m.group(3) or 1)
        code = f"{season}-{cid}-{n}"
        meta: dict[str, Any] = {}
        mp = folder / "meta.json"
        if mp.is_file():
            try:
                meta = json.loads(mp.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        found.append(
            {
                "season": season,
                "characterId": cid,
                "n": n,
                "code": code,
                "folder": folder.name,
                "name": (meta.get("name") or "").strip(),
                "date": (meta.get("date") or "").strip(),
                "mtime": folder.stat().st_mtime,
            }
        )
    return found


def catalog() -> dict[str, Any]:
    raw = _read(CATALOG, {"season": "S1", "slots": 24, "drops": {}, "characters": [], "tiers": {}})
    disk = scan_disk_cards()
    chars: dict[str, dict[str, Any]] = {}
    for ch in raw.get("characters") or []:
        cid = str(ch.get("id") or "").zfill(3)
        chars[cid] = dict(ch)
        chars[cid]["id"] = cid
        chars[cid]["cards"] = list(ch.get("cards") or [])
    for item in disk:
        ch = chars.setdefault(item["characterId"], {"id": item["characterId"], "name": "", "cards": []})
        if item["name"] and not ch.get("name"):
            ch["name"] = item["name"]
        cards = ch.setdefault("cards", [])
        hit = next((c for c in cards if c.get("code") == item["code"]), None)
        if hit:
            if item["date"] and not (hit.get("date") or "").strip():
                hit["date"] = item["date"]
            if item["name"] and not (hit.get("title") or "").strip():
                hit["title"] = item["name"]
            hit["folder"] = item["folder"]
        else:
            cards.append(
                {
                    "n": item["n"],
                    "code": item["code"],
                    "date": item["date"],
                    "title": item["name"] or item["code"],
                    "folder": item["folder"],
                }
            )
    raw["characters"] = sorted(chars.values(), key=lambda c: c["id"])
    raw["_drops"] = _merged_drops(raw, chars)
    return raw


def _merged_drops(raw: dict[str, Any], chars: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    """catalog.drops + 每张卡的 date / meta.date。手写 drops 优先顺序，日期仍必须有来源。"""
    out: dict[str, list[str]] = {}
    for day, val in (raw.get("drops") or {}).items():
        day = str(day)
        for code in as_code_list(val):
            bucket = out.setdefault(day, [])
            if code not in bucket:
                bucket.append(code)
    for ch in chars.values():
        for card in ch.get("cards") or []:
            day = (card.get("date") or "").strip()
            code = card.get("code")
            if not day or not code:
                continue
            bucket = out.setdefault(day, [])
            if code not in bucket:
                bucket.append(code)
    return out


def today_str() -> str:
    tz = catalog().get("timezone") or "Asia/Shanghai"
    try:
        now = datetime.now(ZoneInfo(tz))
    except Exception:
        now = datetime.now()
    return now.strftime("%Y-%m-%d")


def users() -> dict[str, Any]:
    return _read(USERS, {})


def save_users(data: dict[str, Any]) -> None:
    _write(USERS, data)


def _migrate_inventory(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for pid, days in (raw or {}).items():
        nd: dict[str, list] = {}
        for day, rec in (days or {}).items():
            nd[str(day)] = as_grant_list(rec)
        out[pid] = nd
    return out


def inventory() -> dict[str, Any]:
    if INVENTORY.is_file():
        return _migrate_inventory(_read(INVENTORY, {}))
    legacy = _read(CLAIMS_LEGACY, {})
    if legacy:
        data = _migrate_inventory(legacy)
        _write(INVENTORY, data)
        return data
    return {}


def save_inventory(data: dict[str, Any]) -> None:
    _write(INVENTORY, data)


def claims() -> dict[str, Any]:
    """兼容旧名：返回库存。"""
    return inventory()


def save_claims(data: dict[str, Any]) -> None:
    save_inventory(data)


def covers() -> dict[str, Any]:
    return _read(COVERS, {})


def save_covers(data: dict[str, Any]) -> None:
    _write(COVERS, data)


def upsert_user(pid: str, name: str, tier: str | None, creator: bool = False) -> dict[str, Any]:
    all_u = users()
    rec = all_u.get(pid) or {"id": pid, "name": name, "created": today_str()}
    rec["name"] = name or rec.get("name") or "Patron"
    rec["tier"] = tier
    rec["seen"] = today_str()
    if creator:
        rec["creator"] = True
    log = rec.setdefault("tierLog", {})
    # 当天最后一次登录的档位。入柜框仍锁在第一次获得。
    log[today_str()] = tier
    all_u[pid] = rec
    save_users(all_u)
    return rec


def variant_for_tier(tier: str | None) -> str | None:
    if not paid_tier(tier):
        return None
    info = (catalog().get("tiers") or {}).get(tier) or {}
    return info.get("variant") or {"t3": "silver", "t4": "gold", "t5": "prism"}.get(tier)


def find_card(code: str) -> dict[str, Any] | None:
    cat = catalog()
    for ch in cat.get("characters") or []:
        for card in ch.get("cards") or []:
            if card.get("code") == code:
                out = dict(card)
                out["characterId"] = ch.get("id")
                out["characterName"] = ch.get("name")
                return out
    return None


def drop_for_date(day: str) -> list[str]:
    """投放列表。兼容旧调用名；始终返回 list。"""
    return drops_for_date(day)


def drops_for_date(day: str) -> list[str]:
    cat = catalog()
    return list((cat.get("_drops") or {}).get(day) or [])


def iter_drops() -> list[tuple[str, list[str]]]:
    cat = catalog()
    items = list((cat.get("_drops") or {}).items())
    items.sort(key=lambda kv: kv[0])
    return items


def user_inventory(pid: str) -> dict[str, list[dict[str, Any]]]:
    mine = inventory().get(pid) or {}
    return {day: as_grant_list(rec) for day, rec in mine.items()}


def user_claims(pid: str) -> dict[str, Any]:
    return user_inventory(pid)


def _owned_codes(mine: dict[str, list[dict[str, Any]]]) -> set[str]:
    codes: set[str] = set()
    for grants in mine.values():
        for g in as_grant_list(grants):
            codes.add(g["code"])
    return codes


def _append_grant(mine: dict[str, Any], rec: dict[str, Any]) -> None:
    day = rec["day"]
    bucket = as_grant_list(mine.get(day))
    bucket.append(rec)
    mine[day] = bucket


def ensure_entitlements(pid: str) -> dict[str, Any]:
    """
    会员每次拉柜 / 登录时调用。
    对 catalog 里每一个已投放日 d <= today：
      - 若该日 tierLog 是 t3/t4/t5，或（d==today 且现在仍是 t3+），把该日的卡写入库存；
      - 框锁定为获得日（第一次写入）的档位，之后升档不改。
    没有历史 log 的旧日 = 空槽（月中升档不补前几天）。
    """
    all_u = users()
    user = all_u.get(pid) or {}
    today = today_str()
    log = user.get("tierLog") or {}
    current_tier = user.get("tier")
    inv_all = inventory()
    mine = {d: as_grant_list(r) for d, r in (inv_all.get(pid) or {}).items()}
    owned = _owned_codes(mine)
    granted: list[dict[str, Any]] = []

    for day, codes in iter_drops():
        if day > today:
            continue
        eligible = None
        day_log = log.get(day)
        if paid_tier(day_log):
            eligible = day_log
        elif day == today and paid_tier(current_tier):
            eligible = current_tier
        elif user.get("creator") and paid_tier(current_tier):
            # 创作者试柜：能看到已投放的卡。粉丝升档仍不补空槽。
            eligible = current_tier
        if not eligible:
            continue
        variant = variant_for_tier(eligible)
        if not variant:
            continue
        for code in codes:
            if code in owned:
                continue
            card = find_card(code)
            if not card:
                continue
            rec = {
                "code": code,
                "variant": variant,
                "characterId": card["characterId"],
                "day": day,
                "tier": eligible,
            }
            _append_grant(mine, rec)
            owned.add(code)
            granted.append(rec)

    inv_all[pid] = mine
    save_inventory(inv_all)
    return {"granted": granted, "inventory": mine}


def grant_renewal_bonus(pid: str, n: int = 2) -> list[dict[str, Any]]:
    """
    续约补给：会员满一个月并且续上下一个月，从她空着的已投放号里随机抽 n 张
    （默认 2）。框 = 补给当天的档位。

    满月判定这周不做。本函数可被管理员或模拟按钮触发。
    不发隐藏卡。Shop 包不含隐藏卡（这周不接 Shop 进柜）。
    """
    user = users().get(pid) or {}
    if not paid_tier(user.get("tier")):
        raise ValueError("当前不是付费档")
    variant = variant_for_tier(user.get("tier"))
    if not variant:
        raise ValueError("当前档位没有框")
    today = today_str()
    ensure_entitlements(pid)
    inv_all = inventory()
    mine = {d: as_grant_list(r) for d, r in (inv_all.get(pid) or {}).items()}
    owned = _owned_codes(mine)
    pool: list[str] = []
    for day, codes in iter_drops():
        if day > today:
            continue
        for code in codes:
            if code not in owned and find_card(code) and code not in pool:
                pool.append(code)
    if not pool:
        return []
    pick = random.sample(pool, k=min(n, len(pool)))
    out: list[dict[str, Any]] = []
    for code in pick:
        card = find_card(code)
        if not card:
            continue
        rec = {
            "code": code,
            "variant": variant,
            "characterId": card["characterId"],
            "day": today,
            "tier": user.get("tier"),
            "source": "renewal",
        }
        _append_grant(mine, rec)
        owned.add(code)
        out.append(rec)
    inv_all[pid] = mine
    save_inventory(inv_all)
    return out


def owned_cards(pid: str) -> list[dict[str, Any]]:
    mine = user_inventory(pid)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for grants in mine.values():
        for rec in grants:
            code = rec.get("code")
            if not code or code in seen:
                continue
            card = find_card(code)
            if not card:
                continue
            seen.add(code)
            item = dict(card)
            item["variant"] = rec.get("variant")
            item["claimedOn"] = rec.get("day")
            item["grantedOn"] = rec.get("day")
            item["source"] = rec.get("source") or "drop"
            out.append(item)
    return out


def cabinet(pid: str) -> dict[str, Any]:
    ensure_entitlements(pid)
    cat = catalog()
    season = cat.get("season") or "S1"
    slots = int(cat.get("slots") or 24)
    owned = owned_cards(pid)
    by_char: dict[str, list[dict[str, Any]]] = {}
    for c in owned:
        by_char.setdefault(c["characterId"], []).append(c)
    cover_map = covers().get(pid) or {}
    chars = {ch["id"]: ch for ch in (cat.get("characters") or [])}
    max_id = 0
    for cid in chars:
        try:
            max_id = max(max_id, int(cid))
        except ValueError:
            pass
    slots = max(slots, max_id, 24)
    today_codes = drops_for_date(today_str())
    today_chars = set()
    for code in today_codes:
        fc = find_card(code)
        if fc:
            today_chars.add(fc["characterId"])
    rows = []
    for i in range(1, slots + 1):
        cid = f"{i:03d}"
        ch = chars.get(cid) or {"id": cid, "name": ""}
        cards = by_char.get(cid) or []
        cover_code = cover_map.get(cid)
        cover = next((c for c in cards if c.get("code") == cover_code), None)
        if not cover and cards:
            cover = cards[0]
        rows.append(
            {
                "slot": f"{season}-{cid}",
                "characterId": cid,
                "name": ch.get("name") or "",
                "owned": len(cards),
                "cards": cards,
                "cover": cover,
                "todayDrop": cid in today_chars,
            }
        )
    return {
        "season": season,
        "seasonTitle": cat.get("seasonTitle") or season,
        "today": today_str(),
        "todayDrops": today_codes,
        "slots": rows,
    }


def set_cover(pid: str, character_id: str, code: str) -> None:
    mine = owned_cards(pid)
    if not any(c["code"] == code and c["characterId"] == character_id for c in mine):
        raise ValueError("你还没有这张卡")
    all_c = covers()
    rec = all_c.get(pid) or {}
    rec[character_id] = code
    all_c[pid] = rec
    save_covers(all_c)


def card_dir(code: str) -> Path:
    direct = CARDS / code
    if direct.is_dir():
        return direct
    parts = code.split("-")
    if len(parts) == 3 and parts[2] == "1":
        alt = CARDS / f"{parts[0]}-{parts[1]}"
        if alt.is_dir():
            return alt
    for item in scan_disk_cards():
        if item["code"] == code:
            return CARDS / item["folder"]
    return direct


def card_files(code: str) -> dict[str, str]:
    folder = card_dir(code)
    out = {}
    for name in ("original.png", "background.png", "subject.png", "meta.json"):
        p = folder / name
        if p.is_file():
            out[name] = str(p)
    i = 0
    while True:
        p = folder / f"extra_{i}.png"
        if not p.is_file():
            break
        out[p.name] = str(p)
        i += 1
    return out


def site() -> dict[str, Any]:
    raw = _read(SITE, {})
    out = dict(SITE_DEFAULT)
    if isinstance(raw, dict):
        for key, val in raw.items():
            if val is None or val == "":
                continue
            out[key] = val
    return out


def save_site(payload: dict[str, Any]) -> dict[str, Any]:
    cur = site()
    for key in SITE_DEFAULT:
        if key in payload and payload[key] is not None:
            cur[key] = str(payload[key]).strip()
    _write(SITE, cur)
    return cur


def catalog_raw() -> dict[str, Any]:
    return _read(CATALOG, {"season": "S1", "slots": 24, "drops": {}, "characters": [], "tiers": {}})


def save_admin_catalog(payload: dict[str, Any]) -> dict[str, Any]:
    raw = catalog_raw()
    if "seasonTitle" in payload and payload["seasonTitle"] is not None:
        raw["seasonTitle"] = str(payload["seasonTitle"]).strip()
    if "slots" in payload and payload["slots"] is not None:
        try:
            raw["slots"] = max(1, min(100, int(payload["slots"])))
        except (TypeError, ValueError):
            pass
    if "drops" in payload and isinstance(payload["drops"], dict):
        drops: dict[str, list[str]] = {}
        for day, codes in payload["drops"].items():
            day_s = str(day).strip()
            if not day_s:
                continue
            lst = as_code_list(codes)
            if lst:
                drops[day_s] = lst
        raw["drops"] = drops
    if "characters" in payload and isinstance(payload["characters"], list):
        by_id = {str(ch.get("id") or "").zfill(3): ch for ch in (raw.get("characters") or [])}
        for row in payload["characters"]:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("id") or "").zfill(3)
            if cid not in by_id:
                by_id[cid] = {"id": cid, "name": "", "cards": []}
            if "name" in row and row["name"] is not None:
                by_id[cid]["name"] = str(row["name"]).strip()
        raw["characters"] = sorted(by_id.values(), key=lambda c: c.get("id") or "")
    _write(CATALOG, raw)
    return raw


def list_card_codes() -> list[str]:
    return [item["code"] for item in scan_disk_cards()]


def register_drop(code: str, day: str, name: str = "", title: str = "") -> dict[str, Any]:
    """出卡后写入 catalog.json 的 drops + characters。文件夹名应等于 serial。"""
    card = find_card(code) or {}
    m = FOLDER_RE.match(code)
    if not m:
        raise ValueError("编号必须是 S1-001-1 这种")
    cid = m.group(2).zfill(3)
    n = int(m.group(3) or 1)
    raw = _read(CATALOG, {"season": "S1", "slots": 24, "drops": {}, "characters": [], "tiers": {}})
    drops = raw.setdefault("drops", {})
    existing = as_code_list(drops.get(day))
    if code not in existing:
        existing.append(code)
    drops[day] = existing
    chars = raw.setdefault("characters", [])
    ch = next((c for c in chars if str(c.get("id") or "").zfill(3) == cid), None)
    if not ch:
        ch = {"id": cid, "name": name or "", "cards": []}
        chars.append(ch)
    if name and not ch.get("name"):
        ch["name"] = name
    cards = ch.setdefault("cards", [])
    hit = next((c for c in cards if c.get("code") == code), None)
    if not hit:
        cards.append({"n": n, "code": code, "date": day, "title": title or name or code})
    else:
        hit["date"] = day or hit.get("date")
        if title or name:
            hit["title"] = title or name
    _write(CATALOG, raw)
    return {"ok": True, "code": code, "date": day, "characterId": cid}
