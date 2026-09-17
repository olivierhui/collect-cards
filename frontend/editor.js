/**
 * On-page visual editor for the cabinet.
 * Creators edit the live page: text, slots, drops, recall mistaken grants.
 */
(function () {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const state = {
    on: false,
    dirty: false,
    library: null,
    selected: null,
    dragCid: null,
  };

  function api(url, opts) {
    return window.__cabinet.api(url, opts);
  }

  function canEdit() {
    const me = window.__cabinet?.me?.user;
    return !!(me && (me.creator || me.mock));
  }

  function layout() {
    const site = window.__cabinet?.me?.site || {};
    const lay = site.layout || {};
    return {
      slotOrder: [...(lay.slotOrder || [])],
      hiddenSlots: [...(lay.hiddenSlots || [])],
      hiddenBlocks: [...(lay.hiddenBlocks || [])],
    };
  }

  function markDirty() {
    state.dirty = true;
    const pill = $("#ed-dirty");
    if (pill) pill.hidden = false;
  }

  function setStatus(msg) {
    const el = $("#ed-status");
    if (el) el.textContent = msg || "";
  }

  function enter() {
    if (!canEdit()) return;
    state.on = true;
    document.body.classList.add("editing");
    $("#ed-bar")?.classList.remove("hidden");
    $("#ed-enter")?.classList.add("hidden");
    wireText();
    window.__cabinet.renderCabinet();
    loadLibrary();
  }

  function exit(saveFirst) {
    if (saveFirst && state.dirty) return;
    state.on = false;
    state.selected = null;
    document.body.classList.remove("editing");
    $("#ed-bar")?.classList.add("hidden");
    $("#ed-enter")?.classList.remove("hidden");
    $("#ed-drawer")?.classList.add("hidden");
    $("#ed-lib")?.classList.add("hidden");
    $("#ed-fix")?.classList.add("hidden");
    $$("[data-ed]").forEach((el) => {
      el.removeAttribute("contenteditable");
    });
    window.__cabinet.renderCabinet();
  }

  function wireText() {
    const map = [
      [".kicker", "kicker"],
      [".top h1", "title"],
      ["#gate p", "gate"],
      ["#ed-note", "note"],
    ];
    map.forEach(([sel, key]) => {
      const el = $(sel);
      if (!el) return;
      el.dataset.ed = key;
      el.contentEditable = "true";
      el.spellcheck = false;
      el.oninput = () => {
        const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
        site[key] = el.innerText.trim();
        markDirty();
      };
    });
  }

  function collectSite() {
    const site = Object.assign({}, window.__cabinet.me.site || {});
    const kicker = $(".kicker");
    const title = $(".top h1");
    const gate = $("#gate p");
    const note = $("#ed-note");
    if (kicker) site.kicker = kicker.innerText.trim();
    if (title) site.title = title.innerText.trim();
    if (gate) site.gate = gate.innerText.trim();
    if (note) site.note = note.innerText.trim();
    site.layout = layout();
    const order = $$("#cabinet .slot").map((el) => el.dataset.cid).filter(Boolean);
    if (order.length) site.layout.slotOrder = order;
    return site;
  }

  async function save() {
    setStatus("保存中…");
    const site = collectSite();
    const characters = (window.__cabinet.cabinet?.slots || []).map((s) => ({
      id: s.characterId,
      name: s.name || "",
    }));
    try {
      const r = await api("/api/admin/save", {
        method: "POST",
        body: JSON.stringify({ site, characters }),
      });
      window.__cabinet.me.site = r.site;
      state.dirty = false;
      $("#ed-dirty").hidden = true;
      setStatus(r.github && r.github.ok ? "已保存，并备份到 GitHub" : "已保存，网站立刻变了");
      await window.__cabinet.boot();
      if (state.on) {
        document.body.classList.add("editing");
        wireText();
        window.__cabinet.renderCabinet();
      }
    } catch (e) {
      setStatus(e.message);
    }
  }

  async function loadLibrary() {
    try {
      state.library = await api("/api/admin/library");
      renderLibrary();
    } catch (e) {
      setStatus(e.message);
    }
  }

  function renderLibrary() {
    const box = $("#ed-lib-list");
    if (!box || !state.library) return;
    const q = ($("#ed-lib-q")?.value || "").trim().toLowerCase();
    box.innerHTML = (state.library.cards || [])
      .filter((c) => {
        if (!q) return true;
        return (c.code + " " + c.name).toLowerCase().includes(q);
      })
      .map((c) => {
        const days = (c.days || []).join("、") || "未投放";
        return `<button type="button" class="ed-card" draggable="true" data-code="${c.code}">
          <img src="${c.thumb}" alt="">
          <span>${c.code}</span>
          <em>${c.name || "未命名"} · ${days} · ${c.holders}人</em>
        </button>`;
      })
      .join("");
    box.querySelectorAll(".ed-card").forEach((el) => {
      el.ondragstart = (e) => {
        e.dataTransfer.setData("text/card-code", el.dataset.code);
        e.dataTransfer.effectAllowed = "copy";
      };
      el.onclick = () => openFix(el.dataset.code);
    });
  }

  function bindSlots() {
    if (!state.on) return;
    const root = $("#cabinet");
    if (!root) return;
    $$(".slot", root).forEach((el) => {
      el.draggable = true;
      el.ondragstart = (e) => {
        state.dragCid = el.dataset.cid;
        e.dataTransfer.setData("text/slot-id", el.dataset.cid);
        e.dataTransfer.effectAllowed = "move";
      };
      el.ondragover = (e) => {
        e.preventDefault();
        el.classList.add("ed-drop");
      };
      el.ondragleave = () => el.classList.remove("ed-drop");
      el.ondrop = (e) => {
        e.preventDefault();
        el.classList.remove("ed-drop");
        const cardCode = e.dataTransfer.getData("text/card-code");
        if (cardCode) {
          assignDrop(cardCode);
          return;
        }
        const from = e.dataTransfer.getData("text/slot-id") || state.dragCid;
        const to = el.dataset.cid;
        if (!from || from === to) return;
        swapSlots(from, to);
      };
      el.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        openInspector(el.dataset.cid);
      };
    });
  }

  function swapSlots(from, to) {
    const root = $("#cabinet");
    const a = root.querySelector(`.slot[data-cid="${from}"]`);
    const b = root.querySelector(`.slot[data-cid="${to}"]`);
    if (!a || !b) return;
    const marker = document.createElement("div");
    b.replaceWith(marker);
    a.replaceWith(b);
    marker.replaceWith(a);
    const cab = window.__cabinet.cabinet;
    if (cab) {
      const ids = $$(".slot", root).map((el) => el.dataset.cid);
      cab.slots.sort((x, y) => ids.indexOf(x.characterId) - ids.indexOf(y.characterId));
      const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
      site.layout = site.layout || {};
      site.layout.slotOrder = ids;
    }
    markDirty();
    bindSlots();
  }

  function openInspector(cid) {
    const slot = (window.__cabinet.cabinet?.slots || []).find((s) => s.characterId === cid);
    if (!slot) return;
    state.selected = cid;
    const d = $("#ed-drawer");
    d.classList.remove("hidden");
    const hidden = layout().hiddenSlots.includes(cid);
    const cards = slot.cards || [];
    const lib = state.library?.cards || [];
    d.innerHTML = `
      <header>
        <h3>格子 ${slot.slot}</h3>
        <button type="button" class="ed-x" id="ed-x">关闭</button>
      </header>
      <label>角色名
        <input id="ed-name" value="${slot.name || ""}" />
      </label>
      <label class="ed-check">
        <input type="checkbox" id="ed-hide" ${hidden ? "checked" : ""} />
        对会员隐藏这一格
      </label>
      <h4>这一格的卡</h4>
      <div class="ed-mini">
        ${cards.length ? cards.map((c) => `<button type="button" data-fix="${c.code}">${c.code} · ${c.grantedOn || c.date || ""}</button>`).join("") : "<p class='muted tiny'>还没有卡。从卡片库拖一张进来，或下面纠错。</p>"}
      </div>
      <h4>投放纠错</h4>
      <p class="muted tiny">投放错了：改编号、改日期、或撤销。已入柜的人可以收回或换成正确的卡。</p>
      <label>编号 <input id="ed-code" placeholder="S1-001-1" value="${(cards[0] && cards[0].code) || ""}" /></label>
      <div class="ed-actions">
        <button type="button" id="ed-impact">看谁已经拿到</button>
        <button type="button" id="ed-open-fix">打开纠错</button>
      </div>
      <p class="muted tiny" id="ed-impact-out"></p>
    `;
    $("#ed-x").onclick = () => d.classList.add("hidden");
    $("#ed-name").oninput = () => {
      slot.name = $("#ed-name").value.trim();
      const label = document.querySelector(`.slot[data-cid="${cid}"] .ed-name-tag`);
      if (label) label.textContent = slot.name;
      markDirty();
    };
    $("#ed-hide").onchange = () => {
      const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
      site.layout = layout();
      const set = new Set(site.layout.hiddenSlots);
      if ($("#ed-hide").checked) set.add(cid);
      else set.delete(cid);
      site.layout.hiddenSlots = [...set];
      window.__cabinet.me.site.layout = site.layout;
      markDirty();
      const el = document.querySelector(`.slot[data-cid="${cid}"]`);
      if (el) el.classList.toggle("ed-hidden-slot", $("#ed-hide").checked);
    };
    d.querySelectorAll("[data-fix]").forEach((b) => {
      b.onclick = () => openFix(b.dataset.fix);
    });
    $("#ed-impact").onclick = async () => {
      const code = $("#ed-code").value.trim();
      if (!code) return;
      try {
        const r = await api("/api/admin/drop-impact?code=" + encodeURIComponent(code));
        $("#ed-impact-out").textContent = r.count
          ? `${r.code} 已在 ${r.count} 人柜里 · 投放日 ${(r.days || []).join("、") || "无"}`
          : `${r.code} 还没有人拿到。投放日 ${(r.days || []).join("、") || "无"}`;
      } catch (e) {
        $("#ed-impact-out").textContent = e.message;
      }
    };
    $("#ed-open-fix").onclick = () => openFix($("#ed-code").value.trim());
  }

  async function assignDrop(code) {
    const day = window.__cabinet.me?.today || "";
    if (!code || !day) return;
    setStatus(`正在投放 ${code} → ${day}`);
    try {
      await api("/api/admin/schedule", {
        method: "POST",
        body: JSON.stringify({ code, day }),
      });
      setStatus(`已把 ${code} 加进 ${day} 的投放。若这不是今天该发的，用投放纠错改掉。`);
      await loadLibrary();
      await window.__cabinet.boot();
      if (state.on) {
        document.body.classList.add("editing");
        wireText();
        window.__cabinet.renderCabinet();
      }
    } catch (e) {
      setStatus(e.message);
    }
  }

  function openFix(code, extra) {
    const modal = $("#ed-fix");
    modal.classList.remove("hidden");
    const today = window.__cabinet.me?.today || "";
    const info = (state.library?.cards || []).find((c) => c.code === code);
    $("#ed-fix-code").value = code || "";
    $("#ed-fix-newcode").value = "";
    $("#ed-fix-day").value = (info && info.days && info.days[0]) || today;
    $("#ed-fix-newday").value = today;
    $("#ed-fix-action").value = extra && extra.attachTo ? "reassign" : "remove";
    $("#ed-fix-inv").value = "keep";
    $("#ed-fix-msg").textContent = extra && extra.attachTo
      ? `把这张卡投到格子 ${extra.attachTo} 的角色位。选「改编号」或先看冲击。`
      : "投放错了用这一页。先看谁拿到了，再决定只改名单还是收回。";
    $("#ed-fix-go").onclick = () => runFix();
    refreshImpact();
  }

  async function refreshImpact() {
    const code = $("#ed-fix-code").value.trim();
    if (!code) return;
    try {
      const r = await api("/api/admin/drop-impact?code=" + encodeURIComponent(code));
      $("#ed-fix-impact").textContent = r.count
        ? `已有 ${r.count} 人柜里是这张：${(r.holders || []).slice(0, 8).map((h) => h.name).join("、")}${(r.holders || []).length > 8 ? "…" : ""}`
        : "还没有人拿到这张。改名单即可。";
    } catch (e) {
      $("#ed-fix-impact").textContent = e.message;
    }
  }

  async function runFix() {
    const body = {
      action: $("#ed-fix-action").value,
      code: $("#ed-fix-code").value.trim(),
      day: $("#ed-fix-day").value.trim(),
      newCode: $("#ed-fix-newcode").value.trim(),
      newDay: $("#ed-fix-newday").value.trim(),
      inventory: $("#ed-fix-inv").value,
    };
    if (!body.code) return;
    if (!confirm("确定改投放？这个操作会立刻写进网站。")) return;
    setStatus("正在纠错…");
    try {
      const r = await api("/api/admin/drop-fix", { method: "POST", body: JSON.stringify(body) });
      $("#ed-fix").classList.add("hidden");
      setStatus(
        `已处理：收回 ${r.recalled || 0} 份` +
          (r.granted ? `，补发 ${r.granted}` : "") +
          (r.holdersBefore ? `（原先 ${r.holdersBefore} 人）` : ""),
      );
      await loadLibrary();
      await window.__cabinet.boot();
      if (state.on) {
        document.body.classList.add("editing");
        wireText();
        window.__cabinet.renderCabinet();
      }
    } catch (e) {
      $("#ed-fix-msg").textContent = e.message;
    }
  }

  function toggleBlock(id) {
    const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
    site.layout = layout();
    const set = new Set(site.layout.hiddenBlocks);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    site.layout.hiddenBlocks = [...set];
    window.__cabinet.me.site.layout = site.layout;
    window.__cabinet.applySite(site);
    markDirty();
  }

  function mount() {
    if (!canEdit()) {
      $("#ed-enter")?.classList.add("hidden");
      return;
    }
    $("#ed-enter")?.classList.remove("hidden");
    $("#ed-enter").onclick = enter;
    $("#ed-save").onclick = save;
    $("#ed-quit").onclick = () => {
      if (state.dirty && !confirm("有未保存的改动，退出会丢掉。确定？")) return;
      state.dirty = false;
      exit();
    };
    $("#ed-open-lib").onclick = () => {
      $("#ed-lib").classList.toggle("hidden");
      loadLibrary();
    };
    $("#ed-bar-fix").onclick = () => openFix("");
    $("#ed-lib-q")?.addEventListener("input", renderLibrary);
    $("#ed-fix-code")?.addEventListener("change", refreshImpact);
    $("#ed-fix-close")?.addEventListener("click", () => $("#ed-fix").classList.add("hidden"));
    $$("[data-hide-block]").forEach((b) => {
      b.onclick = () => toggleBlock(b.dataset.hideBlock);
    });
  }

  window.CabinetEditor = {
    get on() {
      return state.on;
    },
    bindSlots,
    mount,
    markDirty,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(mount, 0));
  } else {
    setTimeout(mount, 0);
  }
})();
