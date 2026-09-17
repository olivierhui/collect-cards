(function () {
  const $ = (s) => document.querySelector(s);
  let data = null;

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

  function render() {
    const site = data.site || {};
    $("#kicker").value = site.kicker || "";
    $("#title").value = site.title || "";
    $("#gate").value = site.gate || "";
    $("#subscribeLabel").value = site.subscribeLabel || "";
    $("#subscribeUrl").value = site.subscribeUrl || "";
    $("#pageTitle").value = site.pageTitle || "";
    $("#seasonTitle").value = data.seasonTitle || "";
    $("#slots").value = data.slots || 24;
    if (!$("#zip-date").value) $("#zip-date").value = data.today || "";
    const dropsBox = $("#drops");
    dropsBox.innerHTML = "";
    const drops = data.drops || {};
    const days = Object.keys(drops).sort().reverse();
    if (!days.length) dropsBox.appendChild(dropRow(data.today, []));
    days.forEach((d) => dropsBox.appendChild(dropRow(d, drops[d])));
    const charsBox = $("#chars");
    charsBox.innerHTML = "";
    (data.characters || []).forEach((ch) => {
      const row = document.createElement("label");
      row.innerHTML = `${ch.id} <input data-cid="${ch.id}" value="${ch.name || ""}" />`;
      charsBox.appendChild(row);
    });
  }

  function collect() {
    const drops = {};
    $("#drops").querySelectorAll(".admin-row").forEach((row) => {
      const day = row.querySelector(".drop-day").value.trim();
      const codes = row.querySelector(".drop-codes").value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      if (day && codes.length) drops[day] = codes;
    });
    const characters = [...$("#chars").querySelectorAll("input[data-cid]")].map((el) => ({
      id: el.dataset.cid,
      name: el.value.trim(),
    }));
    return {
      site: {
        kicker: $("#kicker").value,
        title: $("#title").value,
        gate: $("#gate").value,
        subscribeLabel: $("#subscribeLabel").value,
        subscribeUrl: $("#subscribeUrl").value,
        pageTitle: $("#pageTitle").value,
      },
      seasonTitle: $("#seasonTitle").value,
      slots: Number($("#slots").value || 24),
      drops,
      characters,
    };
  }

  $("#add-drop").onclick = () => $("#drops").prepend(dropRow("", []));
  $("#logout").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    location.href = "/";
  };
  $("#save").onclick = async () => {
    try {
      setStatus("保存中…", true);
      const r = await api("/api/admin/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collect()),
      });
      data = r;
      render();
      setStatus(r.github && r.github.ok ? "已更新网站，并备份到 GitHub。" : "已更新网站。", true);
    } catch (e) {
      setStatus(e.message, false);
    }
  };
  $("#upload").onclick = async () => {
    const file = $("#zip-file").files[0];
    if (!file) {
      setStatus("先选 ZIP", false);
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("date", $("#zip-date").value);
    try {
      setStatus("上传中…", true);
      const r = await fetch("/api/admin/card-zip", { method: "POST", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || r.statusText);
      data = await api("/api/admin/state");
      render();
      setStatus(`已放入 ${body.code} · ${body.date}`, true);
    } catch (e) {
      setStatus(e.message, false);
    }
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
      data = await api("/api/admin/state");
      render();
    } catch (e) {
      setStatus(e.message, false);
    }
  })();
})();
