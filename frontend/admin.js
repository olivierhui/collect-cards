(function () {
  const $ = (s) => document.querySelector(s);
  let data = null;
  let library = null;
  let fans = null;

  async function api(url, opts) {
    const r = await fetch(url, opts || {});
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body;
  }

  function setStatus(msg, ok) {
    const el = $("#status");
    el.textContent = msg;
    el.style.color = ok ? "#8fd19e" : "#e8c36a";
  }

  function dropRow(day, codes) {
    const wrap = document.createElement("div");
    wrap.className = "admin-row";
    wrap.innerHTML = `
      <input class="drop-day" type="date" value="${day || ""}" />
      <input class="drop-codes" placeholder="S1-001-1, S1-002-1" value="${(codes || []).join(", ")}" />
      <button type="button" class="drop-del">删</button>`;
    wrap.querySelector(".drop-del").onclick = () => wrap.remove();
    return wrap;
  }

  function zoneCard(c, zone) {
    const el = document.createElement("div");
    el.className = "zone-card";
    el.innerHTML = `
      <img src="${c.thumb}" alt="">
      <div>
        <strong>${c.code}</strong>
        <p class="muted tiny">${c.name || "未命名"} · ${c.holders || 0} 人有</p>
        <div class="ed-actions">
          ${zone === "active"
            ? `<button type="button" data-act="pending">待放（收回所有人）</button>`
            : `<button type="button" data-act="active">去激活</button>`}
          <button type="button" data-act="text">改文字</button>
          <button type="button" data-act="delete">删除</button>
        </div>
      </div>`;
    el.querySelectorAll("button").forEach((b) => {
      b.onclick = async () => {
        const act = b.dataset.act;
        if (act === "text") {
          $("#txt-code").value = c.code;
          loadText();
          return;
        }
        if (act === "delete") {
          if (!confirm(`删除 ${c.code}？文件会去掉。`)) return;
          const recall = confirm("同时从所有人柜里收回这张？");
          try {
            await api("/api/admin/zone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: c.code, delete: true, recall }),
            });
            await refresh();
            setStatus(`已删除 ${c.code}`, true);
          } catch (e) {
            setStatus(e.message, false);
          }
          return;
        }
        try {
          await api("/api/admin/zone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: c.code, zone: act }),
          });
          await refresh();
          setStatus(`${c.code} → ${act}`, true);
        } catch (e) {
          setStatus(e.message, false);
        }
      };
    });
    return el;
  }

  function renderZones() {
    const active = $("#zone-active");
    const pending = $("#zone-pending");
    active.innerHTML = "";
    pending.innerHTML = "";
    (library.cards || []).forEach((c) => {
      if (c.zone === "pending") pending.appendChild(zoneCard(c, "pending"));
      else active.appendChild(zoneCard(c, "active"));
    });
    if (!active.children.length) active.innerHTML = `<p class="muted tiny">没有激活的卡。</p>`;
    if (!pending.children.length) pending.innerHTML = `<p class="muted tiny">待放区是空的。</p>`;
  }

  function renderFans() {
    const uBox = $("#fans-users");
    const cBox = $("#fans-cards");
    if (!fans) {
      uBox.textContent = "";
      cBox.textContent = "";
      return;
    }
    uBox.innerHTML = (fans.byUser || []).map((u) =>
      `<p><strong>${u.name}</strong> · ${u.tier || "—"} · ${u.count} 张<br><span class="muted tiny">${(u.codes || []).join("、")}</span></p>`
    ).join("") || `<p class="muted tiny">还没有粉丝库存。</p>`;
    cBox.innerHTML = Object.keys(fans.byCard || {}).map((code) => {
      const hs = fans.byCard[code] || [];
      return `<p><strong>${code}</strong> · ${hs.length} 人<br><span class="muted tiny">${hs.map((h) => `${h.name}（${h.variant || ""}）`).join("、")}</span></p>`;
    }).join("") || `<p class="muted tiny">没有发卡记录。</p>`;
  }

  function render() {
    const site = data.site || {};
    $("#kicker").value = site.kicker || "";
    $("#title").value = site.title || "";
    $("#gate").value = site.gate || "";
    $("#subscribeLabel").value = site.subscribeLabel || "";
    $("#subscribeUrl").value = site.subscribeUrl || "";
    $("#upgradeUrl").value = site.upgradeUrl || "";
    $("#pageTitle").value = site.pageTitle || "";
    $("#seasonTitle").value = data.seasonTitle || "";
    $("#slots").value = data.slots || 24;
    if (!$("#zip-date").value) $("#zip-date").value = data.today || "";
    const dropsBox = $("#drops");
    dropsBox.innerHTML = "";
    const drops = data.drops || {};
    const days = Object.keys(drops).sort();
    if (!days.length) dropsBox.appendChild(dropRow(data.today, []));
    days.forEach((d) => dropsBox.appendChild(dropRow(d, drops[d])));
    const chars = $("#chars");
    chars.innerHTML = "";
    (data.characters || []).forEach((ch) => {
      const row = document.createElement("label");
      row.textContent = `S1-${ch.id} `;
      const inp = document.createElement("input");
      inp.className = "char-name";
      inp.dataset.id = ch.id;
      inp.value = ch.name || "";
      row.appendChild(inp);
      chars.appendChild(row);
    });
    if (library) renderZones();
    if (fans) renderFans();
  }

  function collect() {
    const drops = {};
    $("#drops").querySelectorAll(".admin-row").forEach((row) => {
      const day = row.querySelector(".drop-day").value;
      const codes = row.querySelector(".drop-codes").value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      if (day && codes.length) drops[day] = codes;
    });
    const characters = [...document.querySelectorAll(".char-name")].map((inp) => ({
      id: inp.dataset.id,
      name: inp.value.trim(),
    }));
    return {
      site: {
        kicker: $("#kicker").value,
        title: $("#title").value,
        gate: $("#gate").value,
        subscribeLabel: $("#subscribeLabel").value,
        subscribeUrl: $("#subscribeUrl").value,
        upgradeUrl: $("#upgradeUrl").value,
        pageTitle: $("#pageTitle").value,
      },
      seasonTitle: $("#seasonTitle").value,
      slots: Number($("#slots").value || 24),
      drops,
      characters,
    };
  }

  async function loadText() {
    const code = $("#txt-code").value.trim();
    if (!code) return;
    try {
      const rec = await api("/api/admin/card-text?code=" + encodeURIComponent(code));
      const tx = rec.text || {};
      $("#txt-name").value = tx.name || "";
      $("#txt-brand").value = tx.brand || "";
      $("#txt-serial").value = tx.serial || code;
      $("#txt-serialUrl").value = tx.serialUrl || "";
      $("#txt-date").value = tx.date || "";
      $("#txt-edition").value = tx.edition || "";
      $("#txt-backKicker").value = tx.backKicker || "个人典藏";
      $("#txt-backMark").value = tx.backMark || "18";
      $("#txt-backBrand").value = tx.backBrand || "ANIME GIRLS";
      $("#txt-backSub").value = tx.backSub || "";
      $("#txt-backLine").value = tx.backLine || "";
      setStatus("已读出文字（效果没动）", true);
    } catch (e) {
      setStatus(e.message, false);
    }
  }

  async function refresh() {
    data = await api("/api/admin/state");
    library = await api("/api/admin/library");
    fans = await api("/api/admin/fans");
    render();
  }

  $("#add-drop").onclick = () => $("#drops").appendChild(dropRow(data.today, []));
  $("#save").onclick = async () => {
    try {
      setStatus("保存中…", true);
      const r = await api("/api/admin/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collect()),
      });
      data = r;
      await refresh();
      setStatus(r.github && r.github.ok ? "已更新网站，并备份到 GitHub。" : "已更新网站。", true);
    } catch (e) {
      setStatus(e.message, false);
    }
  };
  $("#txt-load").onclick = loadText;
  $("#txt-save").onclick = async () => {
    const code = $("#txt-code").value.trim();
    if (!code) return;
    try {
      await api("/api/admin/card-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: $("#txt-name").value,
          brand: $("#txt-brand").value,
          serial: $("#txt-serial").value,
          serialUrl: $("#txt-serialUrl").value,
          date: $("#txt-date").value,
          edition: $("#txt-edition").value,
          backKicker: $("#txt-backKicker").value,
          backMark: $("#txt-backMark").value,
          backBrand: $("#txt-backBrand").value,
          backSub: $("#txt-backSub").value,
          backLine: $("#txt-backLine").value,
        }),
      });
      setStatus("文字已保存，扫光/眼睛/胸部没改。", true);
    } catch (e) {
      setStatus(e.message, false);
    }
  };
  $("#upload").onclick = async () => {
    const list = Array.from($("#zip-file").files || []);
    if (!list.length) {
      setStatus("先选 ZIP", false);
      return;
    }
    const fd = new FormData();
    for (const file of list) fd.append("files", file);
    fd.append("date", $("#zip-date").value);
    fd.append("zone", $("#zip-zone").value);
    try {
      setStatus(list.length > 1 ? `批量上传 ${list.length} 个…` : "上传中…", true);
      const r = await fetch("/api/admin/card-zips", { method: "POST", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || r.statusText);
      await refresh();
      const ok = (body.results || []).map((x) => x.code).filter(Boolean);
      const bad = (body.errors || []).map((x) => `${x.file}: ${x.error}`);
      let msg = ok.length ? `已放入 ${ok.join(", ")}` : "没有成功";
      if (bad.length) msg += ` · 失败 ${bad.length}：${bad.slice(0, 3).join("；")}`;
      setStatus(msg, bad.length === 0);
      $("#zip-file").value = "";
    } catch (e) {
      setStatus(e.message, false);
    }
  };
  $("#logout").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    location.href = "/";
  };

  (async function boot() {
    try {
      const me = await api("/api/me");
      if (!me.user) {
        location.href = "/auth/patreon";
        return;
      }
      if (!me.user.creator && !me.user.mock) {
        $("#note").textContent = "只有创作者能用后台。";
        return;
      }
      await refresh();
    } catch (e) {
      setStatus(e.message, false);
    }
  })();
})();
