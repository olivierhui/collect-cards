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
      modules: Object.assign({}, (lay.modules || {})),
      freeform: !!lay.freeform,
      frames: Object.assign({}, (lay.frames || {})),
      viewer: Object.assign({}, (lay.viewer || {})),
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
    syncFreeformChrome();
    wireFreeform();
    wireViewerFree();
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
    teardownFreeformHandles();
    window.__cabinet.renderCabinet();
    if (window.__cabinet.applySite) window.__cabinet.applySite(window.__cabinet.me.site);
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
    const mem = site.memorial || (window.__cabinet.cabinet && window.__cabinet.cabinet.memorial) || { title: "纪念组", slots: 5, codes: ["", "", "", "", ""] };
    const codes = $$("#memorial .mem-slot").map((el) => el.dataset.cover || "");
    if (codes.length) mem.codes = codes;
    mem.title = ($("#mem-title")?.innerText || mem.title || "纪念组").trim();
    site.memorial = mem;
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
        syncFreeformChrome();
        wireFreeform();
        wireViewerFree();
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
      <label>这一张的集合链接（Patreon 帖子，写在属性里）
        <input id="ed-post-url" type="url" placeholder="https://www.patreon.com/posts/..." />
      </label>
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
    const post = $("#ed-post-url");
    const code0 = (cards[0] && cards[0].code) || "";
    if (post && code0) {
      api("/api/admin/card-text?code=" + encodeURIComponent(code0)).then((r) => {
        post.value = (r.text && r.text.serialUrl) || "";
      }).catch(() => {});
      post.onchange = async () => {
        try {
          await api("/api/admin/card-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code0, serialUrl: post.value.trim() }),
          });
          setStatus("这张卡的帖子链接已保存");
        } catch (e) {
          setStatus(e.message);
        }
      };
    }
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
        syncFreeformChrome();
        wireFreeform();
        wireViewerFree();
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
        syncFreeformChrome();
        wireFreeform();
        wireViewerFree();
      }
    } catch (e) {
      $("#ed-fix-msg").textContent = e.message;
    }
  }

  function bindMemorial() {
    $$("#memorial .mem-slot").forEach((el) => {
      el.ondragover = (e) => { e.preventDefault(); el.classList.add("ed-drop"); };
      el.ondragleave = () => el.classList.remove("ed-drop");
      el.ondrop = (e) => {
        e.preventDefault();
        el.classList.remove("ed-drop");
        const code = e.dataTransfer.getData("text/card-code");
        if (!code) return;
        const i = Number(el.dataset.mem);
        const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
        const mem = site.memorial || { title: "纪念组", slots: 5, codes: ["", "", "", "", ""] };
        while (mem.codes.length < 5) mem.codes.push("");
        mem.codes[i] = code;
        site.memorial = mem;
        markDirty();
        window.__cabinet.renderCabinet();
      };
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!el.dataset.cover) return;
        if (!confirm("从纪念组拿掉这张？")) return;
        const i = Number(el.dataset.mem);
        const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
        const mem = site.memorial || { codes: [] };
        if (mem.codes) mem.codes[i] = "";
        site.memorial = mem;
        markDirty();
        window.__cabinet.renderCabinet();
      };
    });
    const title = $("#mem-title");
    if (title) {
      title.contentEditable = "true";
      title.oninput = () => {
        const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
        site.memorial = site.memorial || {};
        site.memorial.title = title.innerText.trim();
        markDirty();
      };
    }
  }


  const PAGE_FRAMES = [
    { id: "top", sel: "header.top" },
    { id: "status", sel: "#status-bar" },
    { id: "gate", sel: "#gate" },
    { id: "note", sel: "#page-note" },
    { id: "cabinet", sel: "#cabinet" },
    { id: "memorial", sel: "#memorial-wrap" },
  ];
  const VIEWER_FRAMES = [
    { id: "ov-tools", sel: "#ov-tools" },
    { id: "viewer-side", sel: "#viewer-side" },
    { id: "close-viewer", sel: "#close-viewer" },
  ];

  function siteLayoutMut() {
    const site = window.__cabinet.me.site || (window.__cabinet.me.site = {});
    site.layout = layout();
    site.layout.frames = site.layout.frames || {};
    site.layout.viewer = site.layout.viewer || {};
    return site.layout;
  }

  function syncFreeformChrome() {
    const lay = layout();
    document.body.classList.toggle("freeform-layout", !!lay.freeform);
    const btn = $("#ed-freeform");
    if (btn) {
      btn.classList.toggle("on", !!lay.freeform);
      btn.textContent = lay.freeform ? "自由排版 · 开" : "自由排版";
    }
    if (window.__cabinet.applyFrames) window.__cabinet.applyFrames();
  }

  function measureEl(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(Math.max(r.width, 80)),
      h: Math.round(Math.max(r.height, 40)),
    };
  }

  function applyBox(el, box, mode) {
    if (!el || !box) return;
    el.style.left = box.x + "px";
    el.style.top = box.y + "px";
    el.style.width = box.w + "px";
    if (mode === "viewer") {
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.position = "fixed";
      if (box.h) el.style.height = box.h + "px";
    } else {
      el.style.height = box.h + "px";
    }
  }

  function snapshotMissingFrames() {
    const lay = siteLayoutMut();
    PAGE_FRAMES.forEach(({ id, sel }) => {
      const el = $(sel);
      if (!el || lay.frames[id]) return;
      if (el.classList.contains("hidden")) return;
      lay.frames[id] = measureEl(el);
    });
  }

  function teardownFreeformHandles() {
    $$(".ed-free-handle, .ed-free-resize").forEach((n) => n.remove());
    $$(".ed-free").forEach((el) => el.classList.remove("ed-free", "dragging", "resizing"));
  }

  function wireFreeform() {
    teardownFreeformHandles();
    const lay = layout();
    if (!state.on || !lay.freeform) return;
    PAGE_FRAMES.forEach(({ id, sel }) => {
      const el = $(sel);
      if (!el) return;
      el.classList.add("ed-free");
      el.dataset.frameId = id;
      if (![...el.children].some((c) => c.classList && c.classList.contains("ed-free-handle"))) {
        const handle = document.createElement("div");
        handle.className = "ed-free-handle";
        handle.textContent = "拖动 · 右下角缩放";
        el.appendChild(handle);
        const grip = document.createElement("div");
        grip.className = "ed-free-resize";
        grip.title = "缩放";
        el.appendChild(grip);
        bindFramePointer(el, handle, grip, "frames", id);
      }
    });
  }

  function bindFramePointer(el, handle, grip, bucket, id) {
    const startDrag = (ev, kind) => {
      ev.preventDefault();
      ev.stopPropagation();
      const lay = siteLayoutMut();
      const cur = (lay[bucket] && lay[bucket][id]) || measureEl(el);
      const ptr = ev.touches ? ev.touches[0] : ev;
      const ox = ptr.clientX;
      const oy = ptr.clientY;
      const origin = { ...cur };
      el.classList.add(kind === "resize" ? "resizing" : "dragging");
      const move = (e2) => {
        const p = e2.touches ? e2.touches[0] : e2;
        const dx = p.clientX - ox;
        const dy = p.clientY - oy;
        let next;
        if (kind === "resize") {
          next = {
            x: origin.x,
            y: origin.y,
            w: Math.max(80, origin.w + dx),
            h: Math.max(40, origin.h + dy),
          };
        } else {
          next = {
            x: Math.max(0, origin.x + dx),
            y: Math.max(0, origin.y + dy),
            w: origin.w,
            h: origin.h,
          };
        }
        lay[bucket][id] = next;
        applyBox(el, next, bucket === "viewer" ? "viewer" : "page");
      };
      const up = () => {
        el.classList.remove("dragging", "resizing");
        window.__cabinet.me.site.layout = layout();
        window.__cabinet.me.site.layout[bucket] = siteLayoutMut()[bucket];
        markDirty();
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("touchmove", move);
        document.removeEventListener("touchend", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", up);
    };
    handle.onpointerdown = (e) => startDrag(e, "drag");
    grip.onpointerdown = (e) => startDrag(e, "resize");
    handle.ontouchstart = (e) => startDrag(e, "drag");
    grip.ontouchstart = (e) => startDrag(e, "resize");
  }

  function toggleFreeform() {
    const lay = siteLayoutMut();
    if (!lay.freeform) {
      lay.freeform = true;
      // leave flow briefly to measure natural boxes
      document.body.classList.remove("freeform-layout");
      PAGE_FRAMES.forEach(({ sel }) => {
        const el = $(sel);
        if (!el) return;
        el.style.left = "";
        el.style.top = "";
        el.style.width = "";
        el.style.height = "";
      });
      requestAnimationFrame(() => {
        snapshotMissingFrames();
        window.__cabinet.me.site.layout = lay;
        syncFreeformChrome();
        wireFreeform();
        markDirty();
        setStatus("自由排版已开：拖顶条移动，右下角缩放，记得到保存");
      });
    } else {
      lay.freeform = false;
      window.__cabinet.me.site.layout = lay;
      syncFreeformChrome();
      teardownFreeformHandles();
      markDirty();
      setStatus("自由排版已关（坐标还留着，可再打开；要清空点「重置排版」）");
    }
  }

  function resetFreeform() {
    if (!confirm("清掉所有自由排版坐标，恢复默认从上到下的排版？")) return;
    const lay = siteLayoutMut();
    lay.freeform = false;
    lay.frames = {};
    lay.viewer = {};
    window.__cabinet.me.site.layout = lay;
    PAGE_FRAMES.forEach(({ sel }) => {
      const el = $(sel);
      if (!el) return;
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
    });
    VIEWER_FRAMES.forEach(({ sel }) => {
      const el = $(sel);
      if (!el) return;
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
      el.style.right = "";
      el.style.bottom = "";
    });
    syncFreeformChrome();
    teardownFreeformHandles();
    wireViewerFree();
    markDirty();
    setStatus("已重置排版");
  }

  function wireViewerFree() {
    VIEWER_FRAMES.forEach(({ id, sel }) => {
      const el = $(sel);
      if (!el || el.dataset.viewerFreeBound) return;
      el.dataset.viewerFreeBound = "1";
      el.classList.add("ed-viewer-free");
      const dragTarget = id === "viewer-side" ? (el.querySelector(".prop-head") || el) : el;
      dragTarget.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest("button, a, input, textarea")) return;
        if (id === "viewer-side" && !ev.target.closest(".prop-head")) return;
        // only creators rearrange shared viewer chrome while editing; others get applied layout only
        if (!state.on) return;
        const lay = siteLayoutMut();
        const box = (lay.viewer && lay.viewer[id]) || (() => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        })();
        const ptr = ev;
        const ox = ptr.clientX;
        const oy = ptr.clientY;
        const origin = { ...box };
        const move = (e2) => {
          const next = {
            x: Math.max(0, origin.x + (e2.clientX - ox)),
            y: Math.max(0, origin.y + (e2.clientY - oy)),
            w: origin.w,
            h: origin.h,
          };
          lay.viewer[id] = next;
          applyBox(el, next, "viewer");
        };
        const up = () => {
          markDirty();
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      });
    });
  }


  const MOD_LABELS = {
    propTitle: "属性标题",
    propCode: "属性编号",
    propCollection: "集合链接",
    propWallpaper: "壁纸按钮",
    propHint: "操作提示",
    propCover: "设为封面",
    faceToggle: "正面/背面",
    ownedBadge: "已有几张",
    cardDate: "卡面日期",
  };

  function openMods() {
    let box = $("#ed-mod-pop");
    if (box) {
      box.remove();
      return;
    }
    const site = window.__cabinet.me.site || {};
    const mods = layout().modules || {};
    box = document.createElement("div");
    box.id = "ed-mod-pop";
    box.className = "ed-mod-pop";
    const offByDefault = { cardDate: true };
    const rows = Object.keys(MOD_LABELS).map((k) => {
      const on = offByDefault[k] ? mods[k] === true : mods[k] !== false;
      return `<label class="ed-check"><input type="checkbox" data-mod="${k}" ${on ? "checked" : ""}/> ${MOD_LABELS[k]}</label>`;
    }).join("");
    box.innerHTML = `
      <h4>要留的模块</h4>
      ${rows}
      <label>属性里链接按钮文字
        <input id="ed-col-label" value="${site.collectionLabel || "打开 Patreon full set"}" />
      </label>
      <label>操作提示
        <input id="ed-hint" value="${site.hint || ""}" placeholder="滚轮缩放 · 右键返回 · 点击胸部跳动" />
      </label>
      <p class="muted tiny">集合 / Patreon 帖子链接按「每一张卡」设置：点格子 →「这一张的 Patreon 帖子」。只显示在属性面板里。</p>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => e.stopPropagation());
    box.querySelectorAll("input[data-mod]").forEach((inp) => {
      inp.onchange = () => {
        const s = window.__cabinet.me.site || (window.__cabinet.me.site = {});
        s.layout = layout();
        s.layout.modules = s.layout.modules || {};
        s.layout.modules[inp.dataset.mod] = inp.checked;
        window.__cabinet.me.site.layout = s.layout;
        markDirty();
        window.__cabinet.renderCabinet();
        if (window.__cabinet.applySite) window.__cabinet.applySite(s);
      };
    });
    const bindSite = (id, key) => {
      const el = box.querySelector(id);
      if (!el) return;
      el.oninput = () => {
        const s = window.__cabinet.me.site || (window.__cabinet.me.site = {});
        s[key] = el.value.trim();
        markDirty();
      };
    };
    bindSite("#ed-col-label", "collectionLabel");
    bindSite("#ed-hint", "hint");
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
    if (window.__cabinet.renderCabinet) window.__cabinet.renderCabinet();
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
    $("#ed-mods") && ($("#ed-mods").onclick = openMods);
    $("#ed-freeform") && ($("#ed-freeform").onclick = toggleFreeform);
    $("#ed-freeform-reset") && ($("#ed-freeform-reset").onclick = resetFreeform);
    wireViewerFree();
    syncFreeformChrome();
  }

  window.CabinetEditor = {
    get on() {
      return state.on;
    },
    bindSlots,
    bindMemorial,
    mount,
    markDirty,
    syncFreeformChrome,
    wireFreeform,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(mount, 0));
  } else {
    setTimeout(mount, 0);
  }
})();
