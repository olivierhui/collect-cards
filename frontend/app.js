(function () {
  const $ = (s) => document.querySelector(s);
  let me = null;
  let cabinet = null;
  let viewer = null;
  let view = { cid: null, cards: [], selected: null, simple: localStorage.getItem("cc-simple") === "1", scale: 1 };
  const undo = [];
  const slotViews = [];

  const TIER_FRAME = { t2: "iron", t3: "silver", t4: "gold", t5: "prism" };

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || r.statusText);
    return data;
  }

  function t(k, vars) {
    return window.I18N ? I18N.t(k, vars) : k;
  }
  function frameName(v) {
    return window.I18N ? I18N.frameLabel(v) : v || "";
  }
  function tierLabel(tier) {
    return window.I18N ? I18N.tierLabel(tier) : tier || "";
  }

  function extA(href, label, cls) {
    return `<a class="${cls || "btn"}" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  function firstCard(slot) {
    const cards = (slot.cards || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0) || String(a.code).localeCompare(String(b.code)));
    return cards[0] || slot.cover || null;
  }

  function pushUndo(fn) {
    undo.push(fn);
    if (undo.length > 40) undo.shift();
  }

  function doUndo() {
    const fn = undo.pop();
    if (fn) fn();
  }

  function renderLang() {
    const cur = window.I18N ? I18N.lang() : "zh";
    return `<span class="lang-switch">${["zh", "en", "ja"].map((L) =>
      `<button type="button" class="lang-btn${cur === L ? " active" : ""}" data-lang="${L}">${L.toUpperCase()}</button>`
    ).join("")}</span>`;
  }

  function bindLang() {
    document.querySelectorAll(".lang-btn").forEach((b) => {
      b.onclick = () => {
        I18N.setLang(b.dataset.lang);
        renderTop();
        renderStatus();
        renderCabinet();
        applySite(me && me.site);
        if (!$("#overlay").classList.contains("hidden") && view.cid) refreshViewerChrome();
      };
    });
  }

  function renderTop() {
    const box = $("#top-actions");
    const lang = renderLang();
    if (!me || !me.user) {
      const mock = me && me.patreonReady ? "" : `
        <a class="btn" href="/auth/mock?tier=t2">${t("mock")} T2</a>
        <a class="btn" href="/auth/mock?tier=t3">${t("mock")} T3</a>
        <a class="btn" href="/auth/mock?tier=t4">${t("mock")} T4</a>
        <a class="btn" href="/auth/mock?tier=t5">${t("mock")} T5</a>
        <a class="btn" href="/auth/mock?tier=none">${t("mock")}</a>`;
      const loginHref = me && me.patreonReady ? "/auth/patreon" : "https://www.patreon.com/18animegirls";
      const login = me && me.patreonReady
        ? `<a class="btn primary" href="${loginHref}">${t("login")}</a>`
        : extA(loginHref, t("goPatreon"), "btn primary");
      box.innerHTML = `${lang}${login}${mock}`;
      bindLang();
      return;
    }
    const mockSwitch = me.user.mock
      ? `<a class="btn" href="/auth/mock?tier=t2">${t("mock")} T2</a>
         <a class="btn" href="/auth/mock?tier=t3">${t("mock")} T3</a>
         <a class="btn" href="/auth/mock?tier=t4">${t("mock")} T4</a>
         <a class="btn" href="/auth/mock?tier=t5">${t("mock")} T5</a>
         <a class="btn" href="/auth/mock?tier=none">${t("mock")}</a>`
      : "";
    const adminLink = me.user.creator || me.user.mock ? `<a class="btn" href="/admin">${t("admin")}</a>` : "";
    const tier = me.user.tier || "none";
    const fr = TIER_FRAME[tier] || "";
    box.innerHTML = `
      ${lang}
      ${adminLink}
      ${mockSwitch}
      <button type="button" class="who-chip ${fr}" id="who-chip">
        <span class="who-name">${me.user.name || ""}</span>
        <span class="who-tier">${tierLabel(tier)}</span>
      </button>
      <button type="button" id="logout">${t("logout")}</button>`;
    bindLang();
    $("#logout").onclick = async () => {
      await api("/auth/logout", { method: "POST" });
      location.reload();
    };
    $("#who-chip").onclick = (e) => {
      e.stopPropagation();
      toggleProfile();
    };
  }

  function toggleProfile() {
    let pop = $("#who-pop");
    if (pop) {
      pop.remove();
      return;
    }
    const upgrade = (me.upgradeUrl || (me.site && me.site.upgradeUrl) || "https://www.patreon.com/18animegirls/membership");
    pop = document.createElement("div");
    pop.id = "who-pop";
    pop.className = "who-pop";
    pop.innerHTML = `
      <p class="who-pop-name">${me.user.name || ""}</p>
      <p class="muted tiny">${tierLabel(me.user.tier)} · ${t("profileCards", { n: me.user.ownedCount || 0 })} · ${t("profileSlots", { n: me.user.slotsFilled || 0 })}</p>
      <p class="muted tiny">${me.user.created ? t("profileSince", { d: me.user.created }) : ""}</p>
      ${extA(upgrade, t("upgrade"), "btn primary")}
    `;
    document.body.appendChild(pop);
    const chip = $("#who-chip");
    const r = chip.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.right = `${window.innerWidth - r.right}px`;
    const close = (ev) => {
      if (!pop.contains(ev.target) && ev.target !== chip) {
        pop.remove();
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }

  function renderStatus() {
    const bar = $("#status-bar");
    if (!me || !me.user) {
      bar.innerHTML = `<p class="muted">${t("statusGuest")}</p>`;
      return;
    }
    if (!me.user.paid) {
      const sub = me.subscribeUrl || "https://www.patreon.com/18animegirls";
      const lab = me.subscribeLabel || t("goPatreon");
      bar.innerHTML = `<p class="muted">${t("statusUnpaid")}</p>${extA(sub, lab, "btn primary")}`;
      return;
    }
    const n = (me.todayDrops || []).length;
    const extra = me.user.mock
      ? ` <button type="button" class="btn" id="bonus">${t("mock")}</button>`
      : "";
    const line = n ? t("statusToday", { n }) : t("statusNone");
    bar.innerHTML = `<p class="muted">${line} ${t("statusKeep")}</p>${extra}`;
    const bonus = $("#bonus");
    if (bonus) {
      bonus.onclick = async () => {
        try {
          const r = await api("/api/dev/renewal-bonus", { method: "POST" });
          const got = (r.granted || []).map((g) => g.code).join("、") || "—";
          alert(got);
          await boot();
        } catch (e) {
          alert(e.message);
        }
      };
    }
  }

  function renderCabinet() {
    const root = $("#cabinet");
    const gate = $("#gate");
    if (!me || !me.user) {
      root.innerHTML = "";
      root.classList.add("hidden");
      if (gate) gate.classList.remove("hidden");
      return;
    }
    if (gate) gate.classList.add("hidden");
    root.classList.remove("hidden");
    if (!cabinet) {
      root.innerHTML = "";
      return;
    }
    const editing = window.CabinetEditor && window.CabinetEditor.on;
    const hiddenSlots = new Set((me.site && me.site.layout && me.site.layout.hiddenSlots) || []);
    root.innerHTML = cabinet.slots
      .filter((s) => editing || !hiddenSlots.has(s.characterId))
      .map((s) => {
        const cover = s.cover;
        const first = firstCard(s);
        const v = first ? first.variant : "";
        const img = cover && cover.code ? `/api/assets/${cover.code}/original.png` : "";
        const hid = hiddenSlots.has(s.characterId) ? " ed-hidden-slot" : "";
        if (!s.owned) {
          return `<article class="slot empty${hid}" data-cid="${s.characterId}">
            <div class="code">${s.slot}</div>
            <div class="empty-label">${t("empty")}</div>
            <div class="ed-name-tag">${s.name || ""}</div>
          </article>`;
        }
        return `<article class="slot ${v}${hid}" data-cid="${s.characterId}" data-cover="${cover && cover.code ? cover.code : ""}">
          <div class="slot-live"></div>
          <div class="slot-frame" aria-hidden="true"></div>
          <div class="code">${s.slot}</div>
          <img src="${img}" alt="${s.name || s.slot}">
          <div class="count">${t("owned", { n: s.owned })}</div>
          <div class="ed-name-tag">${s.name || ""}</div>
        </article>`;
      })
      .join("");
    if (!window.CabinetEditor || !window.CabinetEditor.on) {
      root.querySelectorAll(".slot:not(.empty)").forEach((el) => {
        el.onclick = () => openSlot(el.dataset.cid);
      });
    } else if (window.CabinetEditor.bindSlots) {
      window.CabinetEditor.bindSlots();
    }
    mountSlotLives();
  }

  function clearSlotViews() {
    slotViews.forEach((v) => { try { v.destroy(); } catch (e) {} });
    slotViews.length = 0;
  }

  function mountSlotLives() {
    clearSlotViews();
    if (window.CabinetEditor && window.CabinetEditor.on) return;
    document.querySelectorAll(".slot[data-cover]").forEach((el) => {
      const code = el.dataset.cover;
      const host = el.querySelector(".slot-live");
      if (!code || !host) return;
      api(`/api/cards/${code}`).then((spec) => {
        if (!el.isConnected) return;
        el.classList.add("has-live");
        const cv = new CardView(host, Object.assign({}, spec, { mini: true, canSeeBack: false }));
        slotViews.push(cv);
        const fit = () => cv.fitMini && cv.fitMini();
        fit();
        if (window.ResizeObserver) {
          const ro = new ResizeObserver(fit);
          ro.observe(el);
          cv._ro = ro;
        }
      }).catch(() => {});
    });
  }

  async function openSlot(cid) {
    const slot = cabinet.slots.find((s) => s.characterId === cid);
    if (!slot || !slot.owned) return;
    const prev = { ...view };
    pushUndo(() => {
      $("#overlay").classList.add("hidden");
      if (viewer) { viewer.destroy(); viewer = null; }
      view = prev;
    });
    view.cid = cid;
    view.cards = (slot.cards || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0));
    view.selected = slot.cover || view.cards[0];
    $("#overlay").classList.remove("hidden");
    applySimple();
    await showCard(view.selected);
    refreshViewerChrome();
  }

  function refreshViewerChrome() {
    const slot = cabinet.slots.find((s) => s.characterId === view.cid);
    $("#viewer-title").textContent = (slot && slot.name) || (view.selected && view.selected.code) || "";
    const fr = view.selected ? frameName(view.selected.variant) : "";
    $("#viewer-code").textContent = view.selected
      ? `${view.selected.code}${fr ? " · " + fr : ""} · ${view.selected.claimedOn || view.selected.grantedOn || ""}`
      : "";
    const strip = $("#viewer-strip");
    if (strip) {
      strip.innerHTML = view.cards.map((c) => {
        const on = view.selected && c.code === view.selected.code ? " on" : "";
        return `<button type="button" class="strip-card${on}" data-code="${c.code}">
          <img src="/api/assets/${c.code}/original.png" alt="${c.code}">
          <span>${c.code}</span>
        </button>`;
      }).join("");
      strip.querySelectorAll("button").forEach((b) => {
        b.onclick = () => selectCard(b.dataset.code);
      });
      strip.classList.toggle("hidden", view.cards.length < 2);
    }
    $("#btn-hide-info").textContent = view.simple ? t("showInfo") : t("hideInfo");
    $("#btn-cover").textContent = t("setCover");
    $("#btn-phone").textContent = t("wallpaperPhone");
    $("#btn-desk").textContent = t("wallpaperDesk");
    $("#close-viewer").textContent = t("close");
    const hint = $("#viewer-hint");
    if (hint) hint.textContent = t("hint");
    const link = $("#prop-collection");
    const url = view.serialUrl || (me && me.site && me.site.serialCollectionUrl) || "";
    if (link) {
      if (url) {
        link.href = url;
        link.classList.remove("hidden");
      } else {
        link.classList.add("hidden");
      }
    }
  }

  function applySimple() {
    $("#overlay").classList.toggle("viewer-simple", !!view.simple);
    localStorage.setItem("cc-simple", view.simple ? "1" : "0");
  }

  function applyZoom() {
    const card = $("#float-stage .float-card");
    if (card) card.style.transform = `scale(${view.scale})`;
  }

  function maxZoom() {
    const stage = $("#float-stage");
    if (!stage) return 1.8;
    const r = stage.getBoundingClientRect();
    const capW = window.innerWidth * 0.92 / Math.max(r.width, 1);
    const capH = window.innerHeight * 0.92 / Math.max(r.height, 1);
    return Math.max(1, Math.min(capW, capH, 2.4));
  }

  async function selectCard(code) {
    const card = view.cards.find((c) => c.code === code);
    if (!card) return;
    const prev = view.selected;
    pushUndo(() => {
      if (prev) showCard(prev).then(refreshViewerChrome);
    });
    view.selected = card;
    await showCard(card);
    refreshViewerChrome();
  }

  async function showCard(card) {
    const spec = await api(`/api/cards/${card.code}`);
    const stage = $("#viewer-stage");
    stage.innerHTML = `<div class="card-root" id="live-card"></div>`;
    if (viewer) viewer.destroy();
    viewer = new CardView($("#live-card"), spec);
    view.serialUrl = (spec.meta && spec.meta.serialUrl) || "";
    view.scale = 1;
    applyZoom();
    const faceBtns = document.querySelectorAll("#live-card [data-face]");
    faceBtns.forEach((b) => {
      if (b.dataset.face === "front") b.textContent = t("front");
      if (b.dataset.face === "back") b.textContent = t("back");
    });
  }

  function wireViewer() {
    const toggleProps = () => {
      const was = view.simple;
      pushUndo(() => { view.simple = was; applySimple(); refreshViewerChrome(); });
      view.simple = !view.simple;
      applySimple();
      refreshViewerChrome();
    };
    $("#btn-hide-info").onclick = toggleProps;
    const x = $("#btn-hide-info-x");
    if (x) x.onclick = () => {
      if (!view.simple) toggleProps();
    };
    const stage = $("#float-stage");
    if (stage) {
      stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        const next = view.scale * (e.deltaY > 0 ? 0.94 : 1.06);
        view.scale = Math.min(maxZoom(), Math.max(1, next));
        applyZoom();
      }, { passive: false });
    }
    $("#btn-cover").onclick = async () => {
      if (!view.selected) return;
      const prevCover = (cabinet.slots.find((s) => s.characterId === view.cid) || {}).cover;
      pushUndo(async () => {
        if (prevCover) {
          await api("/api/cover", { method: "POST", body: JSON.stringify({ characterId: view.cid, code: prevCover.code }) });
          await boot();
        }
      });
      await api("/api/cover", {
        method: "POST",
        body: JSON.stringify({ characterId: view.selected.characterId, code: view.selected.code }),
      });
      await boot();
      if (view.cid) {
        $("#overlay").classList.remove("hidden");
        applySimple();
        refreshViewerChrome();
      }
    };
    $("#btn-phone").onclick = () => {
      if (viewer) wallpaper(1080, 1920, { files: { "original.png": `/api/assets/${view.selected.code}/original.png` }, card: view.selected });
    };
    $("#btn-desk").onclick = () => {
      if (view.selected) wallpaper(1920, 1080, { files: { "original.png": `/api/assets/${view.selected.code}/original.png` }, card: view.selected });
    };
    $("#close-viewer").onclick = () => {
      $("#overlay").classList.add("hidden");
      if (viewer) { viewer.destroy(); viewer = null; }
    };
  }

  async function wallpaper(w, h, spec) {
    const files = spec.files || {};
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = files["original.png"] || files["subject.png"];
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0d0c10";
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min((w * 0.72) / img.width, (h * 0.82) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${spec.card.code}-${w}x${h}.png`;
      a.click();
    }, "image/png");
  }

  document.addEventListener("contextmenu", (e) => {
    if ($("#overlay") && !$("#overlay").classList.contains("hidden")) {
      e.preventDefault();
      doUndo();
    }
  });

  function applySite(site) {
    if (!site) return;
    if (site.pageTitle) document.title = site.pageTitle;
    const kicker = document.querySelector(".kicker");
    const title = document.querySelector(".top h1");
    const gate = document.querySelector("#gate p");
    const noteWrap = document.querySelector("#page-note");
    const note = document.querySelector("#ed-note");
    if (kicker && site.kicker) kicker.textContent = site.kicker;
    if (title && site.title) title.textContent = site.title;
    if (gate && site.gate) gate.textContent = site.gate;
    if (note) note.textContent = site.note || "";
    if (noteWrap) {
      const editing = window.CabinetEditor && window.CabinetEditor.on;
      noteWrap.classList.toggle("hidden", !editing && !(site.note || "").trim());
    }
    const hidden = new Set((site.layout && site.layout.hiddenBlocks) || []);
    document.querySelectorAll("[data-block]").forEach((el) => {
      if (el.id === "cabinet") return;
      el.classList.toggle("ed-block-off", hidden.has(el.dataset.block));
    });
    if (kicker) kicker.classList.toggle("ed-block-off", hidden.has("kicker"));
    if (title) title.classList.toggle("ed-block-off", hidden.has("title"));
  }

  async function boot() {
    if (window.I18N) I18N.setLang(I18N.lang());
    me = await api("/api/me");
    applySite(me.site);
    renderTop();
    renderStatus();
    if (me.user) {
      try {
        cabinet = await api("/api/cabinet");
      } catch (e) {
        cabinet = null;
      }
    } else cabinet = null;
    renderCabinet();
    if (window.CabinetEditor) window.CabinetEditor.mount();
  }

  window.__cabinet = {
    get me() { return me; },
    set me(v) { me = v; },
    get cabinet() { return cabinet; },
    set cabinet(v) { cabinet = v; },
    api,
    boot,
    renderCabinet,
    applySite,
  };

  wireViewer();
  boot().catch((e) => {
    $("#status-bar").textContent = e.message;
  });
})();
