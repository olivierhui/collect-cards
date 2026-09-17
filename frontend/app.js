(function () {
  const $ = (s) => document.querySelector(s);
  const FRAME = { silver: "银", gold: "金", prism: "幻彩" };
  let me = null;
  let cabinet = null;
  let viewer = null;

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || r.statusText);
    return data;
  }

  function frameName(v) {
    return FRAME[v] || "";
  }

  function renderTop() {
    const box = $("#top-actions");
    if (!me || !me.user) {
      const mock = me && me.patreonReady ? "" : `
        <a class="btn" href="/auth/mock?tier=t3">模拟 T3</a>
        <a class="btn" href="/auth/mock?tier=t4">模拟 T4</a>
        <a class="btn" href="/auth/mock?tier=t5">模拟 T5</a>
        <a class="btn" href="/auth/mock?tier=none">模拟未订</a>`;
      box.innerHTML = `
        <a class="btn primary" href="${me && me.patreonReady ? "/auth/patreon" : "https://www.patreon.com"}">${me && me.patreonReady ? "Patreon 登录" : "去 Patreon"}</a>
        ${mock}`;
      return;
    }
    const mockSwitch = me.user.mock
      ? `<a class="btn" href="/auth/mock?tier=t3">模拟 T3</a>
         <a class="btn" href="/auth/mock?tier=t4">模拟 T4</a>
         <a class="btn" href="/auth/mock?tier=t5">模拟 T5</a>
         <a class="btn" href="/auth/mock?tier=none">模拟未订</a>`
      : "";
    const adminLink = me.user.creator || me.user.mock ? `<a class="btn" href="/admin">后台</a>` : "";
    box.innerHTML = `
      <span class="muted">${me.user.name}</span>
      ${adminLink}
      ${mockSwitch}
      <button type="button" id="logout">退出</button>`;
    $("#logout").onclick = async () => {
      await api("/auth/logout", { method: "POST" });
      location.reload();
    };
  }

  function renderStatus() {
    const bar = $("#status-bar");
    if (!me || !me.user) {
      bar.innerHTML = `<p class="muted">登录后打开你的柜子。当天仍在订的会员，卡会自动出现，不用领取。</p>`;
      return;
    }
    if (!me.user.paid) {
      const sub = me.subscribeUrl || "https://www.patreon.com/18animegirls";
      const lab = me.subscribeLabel || "去 Patreon 订阅";
      bar.innerHTML = `<p class="muted">现在不会发新卡。柜子里已有的还在。</p>
        <a class="btn primary" href="${sub}">${lab}</a>`;
      return;
    }
    const n = (me.todayDrops || []).length;
    const extra = me.user.mock
      ? ` <button type="button" class="btn" id="bonus">测试续约补给</button>`
      : "";
    bar.innerHTML = `<p class="muted">${n ? `今天投放 ${n} 张，已按获得时的框入柜。` : "今天没有新投放。"} 升档不会改旧卡的框。</p>${extra}`;
    const bonus = $("#bonus");
    if (bonus) {
      bonus.onclick = async () => {
        try {
          const r = await api("/api/dev/renewal-bonus", { method: "POST" });
          const got = (r.granted || []).map((g) => g.code).join("、") || "没有空号可补";
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
    root.innerHTML = cabinet.slots
      .map((s) => {
        const cover = s.cover;
        const v = cover ? cover.variant : "";
        const img = cover && cover.code ? `/api/assets/${cover.code}/original.png` : "";
        if (!s.owned) {
          return `<article class="slot empty" data-cid="${s.characterId}">
            <div class="code">${s.slot}</div>
            <div class="empty-label">空位</div>
          </article>`;
        }
        return `<article class="slot ${v}" data-cid="${s.characterId}">
          <div class="code">${s.slot}</div>
          <img src="${img}" alt="${s.name || s.slot}">
          <div class="count">已有 ${s.owned} 张</div>
        </article>`;
      })
      .join("");
    root.querySelectorAll(".slot:not(.empty)").forEach((el) => {
      el.onclick = () => openSlot(el.dataset.cid);
    });
  }

  async function openSlot(cid) {
    const slot = cabinet.slots.find((s) => s.characterId === cid);
    if (!slot || !slot.owned) return;
    const cover = slot.cover || slot.cards[0];
    await showCard(cover);
    const stack = $("#viewer-stack");
    stack.innerHTML = slot.cards
      .map((c) => {
        const fr = frameName(c.variant);
        return `<button type="button" data-code="${c.code}">${c.code}${fr ? " · " + fr : ""}</button>`;
      })
      .join("");
    stack.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        const card = slot.cards.find((c) => c.code === b.dataset.code);
        showCard(card);
      };
    });
    $("#overlay").classList.remove("hidden");
    $("#viewer-title").textContent = slot.name || slot.slot;
  }

  async function showCard(card) {
    const spec = await api(`/api/cards/${card.code}`);
    const fr = frameName(card.variant);
    $("#viewer-code").textContent = `${card.code}${fr ? " · " + fr : ""} · ${card.claimedOn || card.grantedOn || ""}`;
    const stage = $("#viewer-stage");
    stage.innerHTML = `<div class="card-root" id="live-card"></div>`;
    if (viewer) viewer.destroy();
    viewer = new CardView($("#live-card"), spec);
    $("#btn-cover").onclick = async () => {
      await api("/api/cover", {
        method: "POST",
        body: JSON.stringify({ characterId: card.characterId, code: card.code }),
      });
      await boot();
    };
    $("#btn-phone").onclick = () => wallpaper(1080, 1920, spec);
    $("#btn-desk").onclick = () => wallpaper(1920, 1080, spec);
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

  $("#close-viewer").onclick = () => {
    $("#overlay").classList.add("hidden");
    if (viewer) viewer.destroy();
    viewer = null;
  };

  function applySite(site) {
    if (!site) return;
    if (site.pageTitle) document.title = site.pageTitle;
    const kicker = document.querySelector(".kicker");
    const title = document.querySelector(".top h1");
    const gate = document.querySelector("#gate p");
    if (kicker && site.kicker) kicker.textContent = site.kicker;
    if (title && site.title) title.textContent = site.title;
    if (gate && site.gate) gate.textContent = site.gate;
  }

  async function boot() {
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
  }

  boot().catch((e) => {
    $("#status-bar").textContent = e.message;
  });
})();
