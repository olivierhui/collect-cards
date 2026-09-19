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
    "note": "",
    "upgradeUrl": "https://www.patreon.com/18animegirls/membership",
    "serialCollectionUrl": "",
    "collectionLabel": "打开 Patreon full set",
    "hint": "滚轮缩放 · 右键返回",
    "layout": {
        "slotOrder": [],
        "hiddenSlots": [],
        "hiddenBlocks": [],
        "modules": {
            "propTitle": True,
            "propCode": True,
            "propCollection": True,
            "propWallpaper": True,
            "propHint": True,
            "propCover": True,
            "faceToggle": True,
            "ownedBadge": True,
            "cardDate": False,
        },
    },
    "memorial": {
        "title": "纪念组",
        "slots": 5,
        "codes": ["", "", "", "", ""],
    },
}

DATA.mkdir(parents=True, exist_ok=True)
CARDS.mkdir(parents=True, exist_ok=True)

PAID_TIERS = ("t3", "t4", "t5")
FOLDER_RE = re.compile(r"^(S\d+)-(\d{1,3})(?:-(\d+))?$", re.I)
MEM_RE = re.compile(r"^MEM-(\d{1,2})$", re.I)


def parse_card_code(code: str) -> dict[str, Any] | None:
    """Normalize S1-001-1 or MEM-01. Returns None if invalid."""
    raw = (code or "").strip()
    m = FOLDER_RE.match(raw)
    if m:
        season = m.group(1).upper()
        cid = m.group(2).zfill(3)
        n = int(m.group(3) or 1)
        return {
            "kind": "season",
            "code": f"{season}-{cid}-{n}",
            "season": season,
            "characterId": cid,
            "n": n,
        }
    m = MEM_RE.match(raw)
    if m:
        n = int(m.group(1))
        if n < 1 or n > 24:
            return None
        return {
            "kind": "memorial",
            "code": f"MEM-{n:02d}",
            "season": "MEM",
            "characterId": f"M{n:02d}",
            "n": 1,
            "slotIndex": n - 1,
        }
    return None


def is_card_code(code: str) -> bool:
    return parse_card_code(code) is not None


def _read(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def paid_tier(tier: str | None) -> bool:
    return tier in PAID_TIERS


def pending_set(raw: dict[str, Any] | None = None) -> set[str]:
    src = raw if isinstance(raw, dict) else _read(CATALOG, {})
    return set(as_code_list(src.get("pending")))


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
        parsed = parse_card_code(folder.name)
        if not parsed:
            continue
        if not (folder / "original.png").is_file() and not (folder / "subject.png").is_file():
            continue
        meta: dict[str, Any] = {}
        mp = folder / "meta.json"
        if mp.is_file():
            try:
                meta = json.loads(mp.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        found.append(
            {
                "season": parsed["season"],
                "characterId": parsed["characterId"],
                "n": parsed["n"],
                "code": parsed["code"],
                "folder": parsed["code"],
                "kind": parsed["kind"],
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
    raw["_pending"] = as_code_list(raw.get("pending"))
    raw["_drops"] = _merged_drops(raw, chars)
    return raw


def _merged_drops(raw: dict[str, Any], chars: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    """catalog.drops + 每张卡的 date / meta.date。手写 drops 优先顺序，日期仍必须有来源。"""
    out: dict[str, list[str]] = {}
    parked = pending_set(raw)
    for day, val in (raw.get("drops") or {}).items():
        day = str(day)
        for code in as_code_list(val):
            if code in parked:
                continue
            bucket = out.setdefault(day, [])
            if code not in bucket:
                bucket.append(code)
    for ch in chars.values():
        for card in ch.get("cards") or []:
            day = (card.get("date") or "").strip()
            code = card.get("code")
            if not day or not code:
                continue
            if code in pending_set(raw):
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
    lay = site_layout()
    order = [str(x).zfill(3) for x in (lay.get("slotOrder") or [])]
    if order:
        by_id = {r["characterId"]: r for r in rows}
        ordered = []
        seen: set[str] = set()
        for cid in order:
            if cid in by_id and cid not in seen:
                ordered.append(by_id[cid])
                seen.add(cid)
        for r in rows:
            if r["characterId"] not in seen:
                ordered.append(r)
        rows = ordered
    mem = memorial()
    owned_by_code = {c["code"]: c for c in owned}
    memorial_slots = []
    for i, code in enumerate(mem.get("codes") or []):
        card = find_card(code) if code else None
        hit = owned_by_code.get(code) if code else None
        cover = hit or (
            {
                **card,
                "variant": "gold",
                "showcase": True,
            }
            if card
            else None
        )
        memorial_slots.append(
            {
                "slot": f"MEM-{i + 1:02d}",
                "index": i,
                "code": code or "",
                "name": (hit or card or {}).get("characterName") or (hit or card or {}).get("name") or (hit or card or {}).get("title") or "",
                "owned": bool(hit or card),
                "cards": [cover] if cover else [],
                "cover": cover,
                "memorial": True,
            }
        )
    return {
        "season": season,
        "seasonTitle": cat.get("seasonTitle") or season,
        "today": today_str(),
        "todayDrops": today_codes,
        "slots": rows,
        "layout": lay,
        "memorial": {**mem, "slots": memorial_slots},
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
        if key not in payload or payload[key] is None:
            continue
        if key == "layout":
            continue
        if key == "memorial":
            continue
        cur[key] = str(payload[key]).strip()
    if isinstance(payload.get("layout"), dict):
        cur["layout"] = _normalize_layout(payload["layout"], cur.get("layout"))
    if isinstance(payload.get("memorial"), dict):
        cur["memorial"] = _normalize_memorial(payload["memorial"])
    _write(SITE, cur)
    return cur


def _normalize_layout(incoming: dict[str, Any], prev: Any) -> dict[str, Any]:
    default_mods = dict(SITE_DEFAULT["layout"]["modules"])
    base = {
        "slotOrder": [],
        "hiddenSlots": [],
        "hiddenBlocks": [],
        "modules": default_mods,
    }
    if isinstance(prev, dict):
        for k in ("slotOrder", "hiddenSlots", "hiddenBlocks"):
            if k in prev:
                base[k] = prev[k]
        if isinstance(prev.get("modules"), dict):
            base["modules"] = {**default_mods, **prev["modules"]}
    order = incoming.get("slotOrder", base["slotOrder"])
    hidden = incoming.get("hiddenSlots", base["hiddenSlots"])
    blocks = incoming.get("hiddenBlocks", base["hiddenBlocks"])
    mods_in = incoming.get("modules", base["modules"])
    def ids(val: Any) -> list[str]:
        if not isinstance(val, list):
            return []
        out: list[str] = []
        for x in val:
            s = str(x).strip()
            if s and s not in out:
                out.append(s)
        return out
    mods = dict(default_mods)
    if isinstance(mods_in, dict):
        for k, v in mods_in.items():
            if k in default_mods:
                mods[k] = bool(v)
    return {
        "slotOrder": [str(x).zfill(3) if str(x).isdigit() else str(x) for x in ids(order)],
        "hiddenSlots": [str(x).zfill(3) if str(x).isdigit() else str(x) for x in ids(hidden)],
        "hiddenBlocks": ids(blocks),
        "modules": mods,
    }


def _normalize_memorial(incoming: dict[str, Any]) -> dict[str, Any]:
    n = int(incoming.get("slots") or 5)
    n = max(1, min(24, n))
    codes = incoming.get("codes") if isinstance(incoming.get("codes"), list) else []
    out_codes = []
    for i in range(n):
        c = str(codes[i]).strip() if i < len(codes) else ""
        parsed = parse_card_code(c)
        out_codes.append(parsed["code"] if parsed else "")
    title = str(incoming.get("title") or "纪念组").strip() or "纪念组"
    return {"title": title, "slots": n, "codes": out_codes}


def assign_memorial_slot(code: str, name: str = "") -> dict[str, Any]:
    """Put MEM-01.. into site.memorial.codes[n-1]. Also accepts season codes into first empty slot."""
    parsed = parse_card_code(code)
    if not parsed:
        raise ValueError("编号必须是 S1-001-1 或 MEM-01")
    code = parsed["code"]
    site_data = site()
    mem = _normalize_memorial(site_data.get("memorial") or {})
    codes = list(mem.get("codes") or [])
    if parsed["kind"] == "memorial":
        idx = int(parsed["slotIndex"])
        if idx >= mem["slots"]:
            mem["slots"] = idx + 1
        while len(codes) < mem["slots"]:
            codes.append("")
        while len(codes) <= idx:
            codes.append("")
        codes[idx] = code
    else:
        # season card dropped onto memorial: first empty slot, else slot 0
        while len(codes) < mem["slots"]:
            codes.append("")
        try:
            idx = codes.index("")
        except ValueError:
            idx = 0
        codes[idx] = code
    mem["codes"] = codes[: mem["slots"]]
    cur = site()
    cur["memorial"] = mem
    _write(SITE, cur)
    return {"ok": True, "code": code, "memorial": mem, "name": name}


def memorial() -> dict[str, Any]:
    raw = site().get("memorial")
    if not isinstance(raw, dict):
        raw = SITE_DEFAULT["memorial"]
    return _normalize_memorial(raw)


def memorial_codes() -> list[str]:
    return [c for c in memorial().get("codes") or [] if c]


def site_layout() -> dict[str, Any]:
    lay = site().get("layout")
    return _normalize_layout(lay if isinstance(lay, dict) else {}, None)


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
    """出卡后写入 catalog.json。MEM-01 进纪念组；S1-xxx 进当天投放。"""
    parsed = parse_card_code(code)
    if not parsed:
        raise ValueError("编号必须是 S1-001-1 或 MEM-01")
    code = parsed["code"]
    if parsed["kind"] == "memorial":
        assign_memorial_slot(code, name=name or title or code)
        raw = _read(CATALOG, {"season": "S1", "slots": 24, "drops": {}, "characters": [], "tiers": {}})
        cid = parsed["characterId"]
        chars = raw.setdefault("characters", [])
        ch = next((c for c in chars if str(c.get("id") or "") == cid), None)
        if not ch:
            ch = {"id": cid, "name": name or code, "cards": []}
            chars.append(ch)
        if name and not ch.get("name"):
            ch["name"] = name
        cards = ch.setdefault("cards", [])
        hit = next((c for c in cards if c.get("code") == code), None)
        if not hit:
            cards.append({"n": 1, "code": code, "date": day or "", "title": title or name or code, "memorial": True})
        else:
            if title or name:
                hit["title"] = title or name
            hit["memorial"] = True
        parked = [c for c in as_code_list(raw.get("pending")) if c != code]
        raw["pending"] = parked
        _write(CATALOG, raw)
        return {"ok": True, "code": code, "date": day, "characterId": cid, "memorial": True}

    cid = parsed["characterId"]
    n = parsed["n"]
    raw = _read(CATALOG, {"season": "S1", "slots": 24, "drops": {}, "characters": [], "tiers": {}})
    drops = raw.setdefault("drops", {})
    existing = as_code_list(drops.get(day))
    if code not in existing:
        existing.append(code)
    drops[day] = existing
    parked = [c for c in as_code_list(raw.get("pending")) if c != code]
    raw["pending"] = parked
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



def _write_card_date(code: str, day: str) -> None:
    folder = card_dir(code)
    mp = folder / "meta.json"
    if not mp.is_file():
        return
    try:
        meta = json.loads(mp.read_text(encoding="utf-8"))
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    meta["date"] = day
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _touch_character_card(raw: dict[str, Any], code: str, day: str | None, title: str = "") -> None:
    parsed = parse_card_code(code)
    if not parsed:
        return
    code = parsed["code"]
    cid = parsed["characterId"]
    n = parsed["n"]
    chars = raw.setdefault("characters", [])
    ch = next((c for c in chars if str(c.get("id") or "").zfill(3) == cid), None)
    if not ch:
        ch = {"id": cid, "name": title or "", "cards": []}
        chars.append(ch)
    cards = ch.setdefault("cards", [])
    hit = next((c for c in cards if c.get("code") == code), None)
    if not hit:
        hit = {"n": n, "code": code, "date": day or "", "title": title or code}
        cards.append(hit)
    if day is not None:
        hit["date"] = day
    if title:
        hit["title"] = title


def holders_of(code: str) -> list[dict[str, Any]]:
    """Who already has this code in inventory."""
    out: list[dict[str, Any]] = []
    all_u = users()
    for pid, days in inventory().items():
        for day, grants in (days or {}).items():
            for g in as_grant_list(grants):
                if g.get("code") != code:
                    continue
                u = all_u.get(pid) or {}
                out.append(
                    {
                        "pid": pid,
                        "name": u.get("name") or pid,
                        "day": g.get("day") or day,
                        "variant": g.get("variant"),
                        "tier": g.get("tier"),
                    }
                )
    return out


def recall_code(code: str) -> int:
    """Strip a card from every cabinet. Returns how many grants removed."""
    inv = inventory()
    n = 0
    for pid, days in list(inv.items()):
        nd: dict[str, list] = {}
        for day, grants in (days or {}).items():
            kept = [g for g in as_grant_list(grants) if g.get("code") != code]
            n += len(as_grant_list(grants)) - len(kept)
            if kept:
                nd[str(day)] = kept
        inv[pid] = nd
    save_inventory(inv)
    covers_all = covers()
    dirty = False
    for pid, cmap in list(covers_all.items()):
        if not isinstance(cmap, dict):
            continue
        nxt = {k: v for k, v in cmap.items() if v != code}
        if nxt != cmap:
            covers_all[pid] = nxt
            dirty = True
    if dirty:
        save_covers(covers_all)
    return n


def _grant_to_holders(code: str, holders: list[dict[str, Any]]) -> int:
    card = find_card(code)
    if not card:
        return 0
    inv = inventory()
    n = 0
    for h in holders:
        pid = h.get("pid")
        if not pid:
            continue
        mine = {d: as_grant_list(r) for d, r in (inv.get(pid) or {}).items()}
        if code in _owned_codes(mine):
            continue
        rec = {
            "code": code,
            "variant": h.get("variant") or "gold",
            "characterId": card["characterId"],
            "day": h.get("day") or today_str(),
            "tier": h.get("tier"),
            "source": "drop-fix",
        }
        _append_grant(mine, rec)
        inv[pid] = mine
        n += 1
    save_inventory(inv)
    return n


def drop_impact(code: str) -> dict[str, Any]:
    holders = holders_of(code)
    days: list[str] = []
    cat = catalog()
    for day, codes in (cat.get("_drops") or {}).items():
        if code in codes:
            days.append(day)
    return {
        "code": code,
        "days": days,
        "holders": holders,
        "count": len(holders),
        "card": find_card(code),
    }


def fix_drop(
    *,
    action: str,
    code: str,
    day: str = "",
    new_code: str = "",
    new_day: str = "",
    inventory_mode: str = "keep",
) -> dict[str, Any]:
    """
    Fix a mistaken drop.

    action:
      reassign  replace code with new_code on that day
      move      move this code to new_day
      remove    take this code off the drop list
    inventory_mode:
      keep     only change the schedule; cabinets stay as they are
      recall   pull this code out of every cabinet
      swap     recall the old code and give new_code to the same people (reassign only)
    """
    code = (code or "").strip()
    if not is_card_code(code):
        raise ValueError("编号必须是 S1-001-1 或 MEM-01")
    action = (action or "").strip()
    inventory_mode = (inventory_mode or "keep").strip()
    if action not in {"reassign", "move", "remove"}:
        raise ValueError("action 只能是 reassign / move / remove")
    if inventory_mode not in {"keep", "recall", "swap"}:
        raise ValueError("库存处理只能是 keep / recall / swap")
    if action == "reassign" and not is_card_code((new_code or "").strip()):
        raise ValueError("请填写正确的新编号")
    if action == "move" and not (new_day or "").strip():
        raise ValueError("请填写新的投放日")

    raw = catalog_raw()
    drops = raw.setdefault("drops", {})
    day_s = (day or "").strip()
    holders = holders_of(code)
    recalled = 0
    granted = 0

    if action == "remove":
        if day_s:
            lst = [c for c in as_code_list(drops.get(day_s)) if c != code]
            if lst:
                drops[day_s] = lst
            else:
                drops.pop(day_s, None)
        else:
            for d, val in list(drops.items()):
                lst = [c for c in as_code_list(val) if c != code]
                if lst:
                    drops[d] = lst
                else:
                    drops.pop(d, None)
        _touch_character_card(raw, code, "")
        _write_card_date(code, "")
        if inventory_mode in {"recall", "swap"}:
            recalled = recall_code(code)

    elif action == "move":
        target = new_day.strip()
        src_days = [day_s] if day_s else [d for d, val in drops.items() if code in as_code_list(val)]
        for d in src_days:
            lst = [c for c in as_code_list(drops.get(d)) if c != code]
            if lst:
                drops[d] = lst
            else:
                drops.pop(d, None)
        bucket = as_code_list(drops.get(target))
        if code not in bucket:
            bucket.append(code)
        drops[target] = bucket
        _touch_character_card(raw, code, target)
        _write_card_date(code, target)
        if inventory_mode == "recall":
            recalled = recall_code(code)

    elif action == "reassign":
        parsed_new = parse_card_code(new_code.strip())
        if not parsed_new:
            raise ValueError("新编号必须是 S1-001-1 或 MEM-01")
        nxt = parsed_new["code"]
        src_days = [day_s] if day_s else [d for d, val in drops.items() if code in as_code_list(val)]
        if not src_days:
            src_days = [today_str()]
        for d in src_days:
            lst = [nxt if c == code else c for c in as_code_list(drops.get(d))]
            if nxt not in lst:
                lst.append(nxt)
            lst = [c for c in lst if c != code]
            drops[d] = lst
        last_day = src_days[-1]
        _touch_character_card(raw, code, "")
        _write_card_date(code, "")
        _touch_character_card(raw, nxt, last_day)
        _write_card_date(nxt, last_day)
        if inventory_mode == "recall":
            recalled = recall_code(code)
        elif inventory_mode == "swap":
            recalled = recall_code(code)
            granted = _grant_to_holders(nxt, holders)

    raw["drops"] = drops
    _write(CATALOG, raw)
    return {
        "ok": True,
        "action": action,
        "code": code,
        "newCode": (new_code or "").strip(),
        "newDay": (new_day or "").strip(),
        "inventory": inventory_mode,
        "holdersBefore": len(holders),
        "recalled": recalled,
        "granted": granted,
        "drops": catalog().get("_drops") or {},
    }


TEXT_KEYS = (
    "name",
    "brand",
    "serial",
    "date",
    "edition",
    "serialUrl",
    "backKicker",
    "backMark",
    "backBrand",
    "backSub",
)


def read_card_text(code: str) -> dict[str, Any]:
    code = (code or "").strip()
    if not is_card_code(code):
        raise ValueError("编号必须是 S1-001-1 或 MEM-01")
    folder = card_dir(code)
    mp = folder / "meta.json"
    meta: dict[str, Any] = {}
    if mp.is_file():
        try:
            meta = json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return {"ok": True, "code": code, "text": {k: meta.get(k, "") for k in TEXT_KEYS}}


def save_card_text(code: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Update only face/back copy. Never touch FX (depth/glow/foil/eyes/chest)."""
    code = (code or "").strip()
    if not is_card_code(code):
        raise ValueError("编号必须是 S1-001-1 或 MEM-01")
    folder = card_dir(code)
    mp = folder / "meta.json"
    meta: dict[str, Any] = {}
    if mp.is_file():
        try:
            meta = json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    if not isinstance(meta, dict):
        meta = {}
    for key in TEXT_KEYS:
        if key in fields and fields[key] is not None:
            meta[key] = str(fields[key]).strip()
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    if meta.get("name") or meta.get("date"):
        raw = catalog_raw()
        _touch_character_card(raw, code, meta.get("date") if "date" in fields else None, meta.get("name") or "")
        _write(CATALOG, raw)
    return {"ok": True, "code": code, "text": {k: meta.get(k, "") for k in TEXT_KEYS}}


def set_card_zone(code: str, zone: str, *, delete: bool = False, recall: bool = False) -> dict[str, Any]:
    """active = live drops; pending = 待放区; delete = remove files."""
    code = (code or "").strip()
    if not is_card_code(code):
        raise ValueError("编号必须是 S1-001-1 或 MEM-01")
    zone = (zone or "pending").strip()
    raw = catalog_raw()
    parked = as_code_list(raw.get("pending"))
    drops = raw.setdefault("drops", {})
    recalled = 0
    if delete:
        if recall:
            recalled = recall_code(code)
        parked = [c for c in parked if c != code]
        for d, val in list(drops.items()):
            lst = [c for c in as_code_list(val) if c != code]
            if lst:
                drops[d] = lst
            else:
                drops.pop(d, None)
        for ch in raw.get("characters") or []:
            ch["cards"] = [c for c in (ch.get("cards") or []) if c.get("code") != code]
        raw["characters"] = [ch for ch in (raw.get("characters") or []) if ch.get("cards")]
        raw["pending"] = parked
        raw["drops"] = drops
        _write(CATALOG, raw)
        # Clear memorial slot if this code was pinned there.
        cur = site()
        mem = _normalize_memorial(cur.get("memorial") or {})
        mem["codes"] = ["" if c == code else c for c in (mem.get("codes") or [])]
        cur["memorial"] = mem
        _write(SITE, cur)
        folder = card_dir(code)
        if folder.is_dir():
            import shutil

            shutil.rmtree(folder, ignore_errors=True)
        return {"ok": True, "code": code, "zone": "deleted", "recalled": recalled}

    if zone == "pending":
        if code not in parked:
            parked.append(code)
        for d, val in list(drops.items()):
            lst = [c for c in as_code_list(val) if c != code]
            if lst:
                drops[d] = lst
            else:
                drops.pop(d, None)
        _touch_character_card(raw, code, "")
        _write_card_date(code, "")
        raw["pending"] = parked
        raw["drops"] = drops
        _write(CATALOG, raw)
        recalled = recall_code(code)
        return {"ok": True, "code": code, "zone": "pending", "recalled": recalled}

    if zone == "active":
        parked = [c for c in parked if c != code]
        raw["pending"] = parked
        _write(CATALOG, raw)
        day = today_str()
        register_drop(code, day)
        parsed = parse_card_code(code)
        return {
            "ok": True,
            "code": code,
            "zone": "active",
            "date": day,
            "memorial": bool(parsed and parsed["kind"] == "memorial"),
        }
    raise ValueError("zone 只能是 active / pending")


def fan_stats() -> dict[str, Any]:
    all_u = users()
    by_card: dict[str, list[dict[str, Any]]] = {}
    by_user: list[dict[str, Any]] = []
    for pid, days in inventory().items():
        u = all_u.get(pid) or {}
        codes: list[str] = []
        seen: set[str] = set()
        for day, grants in (days or {}).items():
            for g in as_grant_list(grants):
                code = g.get("code")
                if not code:
                    continue
                by_card.setdefault(code, []).append(
                    {
                        "pid": pid,
                        "name": u.get("name") or pid,
                        "tier": u.get("tier"),
                        "variant": g.get("variant"),
                        "day": g.get("day") or day,
                    }
                )
                if code not in seen:
                    seen.add(code)
                    codes.append(code)
        by_user.append(
            {
                "pid": pid,
                "name": u.get("name") or pid,
                "tier": u.get("tier"),
                "count": len(codes),
                "codes": codes,
                "seen": u.get("seen") or "",
                "created": u.get("created") or "",
            }
        )
    by_user.sort(key=lambda x: (-x["count"], x["name"]))
    return {"byCard": by_card, "byUser": by_user}


def user_public(pid: str) -> dict[str, Any]:
    u = users().get(pid) or {}
    owned = owned_cards(pid)
    return {
        "name": u.get("name") or "",
        "tier": u.get("tier"),
        "paid": paid_tier(u.get("tier")),
        "created": u.get("created") or "",
        "seen": u.get("seen") or "",
        "ownedCount": len(owned),
        "slotsFilled": len({c.get("characterId") for c in owned if c.get("characterId")}),
    }
