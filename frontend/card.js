/**
 * Cabinet live card — same sandwich as the Grok Building studio preview.
 * LOCKED 2026-09-16: playback matches studio. Do not retune foil/eyes/chest.
 * Backup: backup/card-fx-locked-2026-09-16/
 */
(function (global) {
  function loadImg(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = url;
    });
  }

  let sparkUrl = "";
  function sparkTexture() {
    if (sparkUrl) return sparkUrl;
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 1024;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 1024, 1024);
    for (let i = 0; i < 280; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const r = 0.4 + Math.random() * 1.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      const a = 0.15 + Math.random() * 0.55;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    sparkUrl = `url("${c.toDataURL("image/png")}")`;
    return sparkUrl;
  }

  function CardView(root, spec) {
    this.root = root;
    this.spec = spec;
    this.card = spec.card || spec;
    this.files = spec.files || {};
    this.meta = spec.meta || {};
    this.canSeeBack = !!spec.canSeeBack;
    this.ptr = { x: 0.5, y: 0.5 };
    this.target = { x: 0.5, y: 0.5 };
    this.flipped = false;
    this.flipAngle = 0;
    this.flipFrom = 0;
    this.flipTo = 0;
    this.flipT0 = 0;
    this.flipDur = 680;
    this.jig = 0;
    this.jigT = 0;
    this.down = null;
    this.images = {};
    const slider01 = (v, fallbackInt) => {
      const x = Number(v);
      if (!Number.isFinite(x)) return fallbackInt / 100;
      return x > 1.5 ? x / 100 : Math.max(0, x);
    };
    this.depth = slider01(this.meta.depth, 32);
    this.glow = slider01(this.meta.glow, 35);
    this.foilAmt = slider01(this.meta.foil, 55);
    this.tilt = this.meta.tilt !== false;
    this.floatOn = this.meta.float !== false;
    this.gaze = this.meta.gaze !== false;
    this.mini = !!spec.mini;
    this._dead = false;
    this._abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.render();
    this.bind();
    this.load();
    if (this.mini) this.fitMini();
    const self = this;
    const loop = (now) => {
      if (self._dead) return;
      self.tick(now);
      self.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  CardView.prototype.render = function () {
    const v = this.card.variant || this.meta.grade || "gold";
    const foil = this.meta.foilStyle || "rainbow";
    const foilTarget = this.meta.foilTarget || "all";
    this.root.className = this.mini ? "slot-live holo-card-wrap is-mini" : "holo-card-wrap";
    this.root.innerHTML = `
      <div class="card-root holo-card" data-grade="${v}" data-foil="${foil}" data-foil-target="${foilTarget}" data-flipped="0">
      <div class="holo-flipper">
        <div class="holo-face holo-front">
          <div class="holo-stock">
            <img class="holo-layer-img" data-kind="background" alt="">
            <div class="holo-foil holo-foil-bg"></div>
            <div class="holo-foil-bars"></div>
            <div class="holo-spark"></div>
            <div class="holo-glare"></div>
          </div>
          <div class="holo-contact-shadow"></div>
          <div class="holo-frame">
            <div class="holo-edge-glow"></div>
            <div class="holo-frame-shine"></div>
            <svg class="holo-filigree tl" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
            <svg class="holo-filigree tr" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
            <svg class="holo-filigree bl" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
            <svg class="holo-filigree br" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
            <svg class="holo-filigree-mid top" viewBox="0 0 80 24"><use href="#filigree-mid"/></svg>
            <svg class="holo-filigree-mid bot" viewBox="0 0 80 24"><use href="#filigree-mid"/></svg>
          </div>
          <img class="holo-layer-img holo-subject" data-kind="subject" alt="">
          <canvas class="holo-chest" width="400" height="560"></canvas>
          <div class="holo-foil holo-foil-char"></div>
          <div class="holo-extras"></div>
          <canvas class="holo-eyes" width="400" height="560"></canvas>
        </div>
        <div class="holo-face holo-back">
          <div class="holo-back-paper"></div>
          <div class="holo-foil holo-foil-bg holo-back-foil"></div>
          <div class="holo-foil-bars"></div>
          <div class="holo-spark"></div>
          <div class="holo-glare"></div>
          <div class="holo-back-frame"></div>
          <svg class="holo-filigree tl" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
          <svg class="holo-filigree tr" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
          <svg class="holo-filigree bl" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
          <svg class="holo-filigree br" viewBox="0 0 86 86"><use href="#filigree-corner"/></svg>
          <div class="holo-back-inner">
            <div class="back-mod holo-back-kicker" data-back="kicker"></div>
            <div class="back-mod holo-back-mono" data-back="mono"></div>
            <div class="back-mod holo-back-brand" data-back="brand"></div>
            <div class="back-mod holo-back-sub" data-back="sub"></div>
            <div class="back-mod holo-back-rule" data-back="rule"></div>
            <div class="back-mod holo-back-edition" data-back="edition"></div>
            <div class="back-mod holo-back-serial" data-back="serial"></div>
          </div>
        </div>
      </div>
      <div class="holo-type">
        <div class="holo-type-serial"></div>
        <div class="holo-type-brand"></div>
        <div class="holo-type-name"></div>
        <div class="holo-type-edition"></div>
        <div class="holo-type-date"></div>
      </div>
      </div>
      ${this.mini ? "" : `<div class="holo-face-toggle">
        <button type="button" class="holo-face-btn active" data-face="front">正面</button>
        <button type="button" class="holo-face-btn" data-face="back">背面</button>
      </div>`}`;
    this.cardEl = this.root.querySelector(".holo-card");
    this.cardEl.style.setProperty("--spark", sparkTexture());
    this.flip = this.root.querySelector(".holo-flipper");
    this.bg = this.root.querySelector('[data-kind="background"]');
    this.fg = this.root.querySelector('[data-kind="subject"]');
    this.foil = this.root.querySelector(".holo-front .holo-foil-bg");
    this.charFoil = this.root.querySelector(".holo-foil-char");
    this.bars = this.root.querySelector(".holo-front .holo-foil-bars");
    this.spark = this.root.querySelector(".holo-front .holo-spark");
    this.glare = this.root.querySelector(".holo-front .holo-glare");
    this.shine = this.root.querySelector(".holo-frame-shine");
    this.shadow = this.root.querySelector(".holo-contact-shadow");
    this.extras = this.root.querySelector(".holo-extras");
    this.eyesCv = this.root.querySelector(".holo-eyes");
    this.chestCv = this.root.querySelector(".holo-chest");
    this.frame = this.root.querySelector(".holo-frame");
    this.backFoil = this.root.querySelector(".holo-back-foil");
    this.backGlare = this.root.querySelector(".holo-back .holo-glare");
    this.backBars = this.root.querySelector(".holo-back .holo-foil-bars");
    this.backSpark = this.root.querySelector(".holo-back .holo-spark");
    this.type = this.root.querySelector(".holo-type");
    const serial = this.meta.serial || this.card.code || "";
    const brand = this.meta.brand || "18animegirls";
    const name = this.meta.name || this.card.characterName || "";
    const setTxt = (sel, v) => {
      const el = this.root.querySelector(sel);
      if (!el) return;
      const t = (v || "").trim();
      el.textContent = t;
      el.style.display = t ? "" : "none";
    };
    setTxt(".holo-type-serial", serial);
    setTxt(".holo-type-brand", brand);
    setTxt(".holo-type-name", name);
    setTxt(".holo-type-edition", this.meta.edition || "");
    const mods = (window.__cabinet && window.__cabinet.me && window.__cabinet.me.site && window.__cabinet.me.site.layout && window.__cabinet.me.site.layout.modules) || {};
    if (mods.cardDate) setTxt(".holo-type-date", this.meta.date || "");
    else setTxt(".holo-type-date", "");
    const i18 = (k, fb) => (window.I18N && I18N.t ? I18N.t(k) : fb);
    setTxt(".holo-back-kicker", this.meta.backKicker || i18("backKicker", "PERSONAL COLLECTION"));
    setTxt(".holo-back-mono", this.meta.backMark || "18");
    setTxt(".holo-back-brand", this.meta.backBrand || i18("backBrand", "ANIME GIRLS"));
    setTxt(".holo-back-sub", this.meta.backSub || "");
    setTxt(".holo-back-edition", this.meta.edition || "");
    setTxt(".holo-back-serial", serial);
    this.applyBackLayout();
  };

  CardView.prototype.applyBackLayout = function () {
    const lay = this.meta.backLayout || {};
    const fallback = {
      kicker: { x: 50, y: 40, s: 1 },
      mono: { x: 50, y: 50, s: 1 },
      brand: { x: 50, y: 60, s: 1 },
      sub: { x: 50, y: 66, s: 1 },
      rule: { x: 50, y: 72, s: 1 },
      serial: { x: 50, y: 78, s: 1 },
      edition: { x: 50, y: 84, s: 1 },
    };
    this.root.querySelectorAll("[data-back]").forEach((el) => {
      const L = lay[el.dataset.back] || fallback[el.dataset.back];
      if (!L) return;
      el.style.left = L.x + "%";
      el.style.top = L.y + "%";
      el.style.setProperty("--s", String(L.s || 1));
    });
  };

  CardView.prototype.load = function () {
    const files = this.files;
    const extraUrls = Object.keys(files)
      .filter((k) => /^extra_\d+\.png$/.test(k))
      .sort()
      .map((k) => files[k]);
    Promise.all([
      loadImg(files["background.png"]),
      loadImg(files["subject.png"]),
      ...extraUrls.map(loadImg),
    ]).then(([bg, fg, ...extras]) => {
      this.images.bg = bg;
      this.images.fg = fg;
      this.images.extras = extras.filter(Boolean);
      if (bg && this.bg) this.bg.src = bg.src;
      if (fg && this.fg) {
        this.fg.src = fg.src;
        if (this.charFoil) {
          const url = `url("${fg.src}")`;
          this.charFoil.style.webkitMaskImage = url;
          this.charFoil.style.maskImage = url;
          this.charFoil.style.webkitMaskSize = "100% 100%";
          this.charFoil.style.maskSize = "100% 100%";
          this.charFoil.style.opacity = "";
        }
      }
      if (this.extras) {
        this.extras.innerHTML = "";
        this.images.extras.forEach((im) => {
          const el = document.createElement("img");
          el.className = "holo-extra";
          el.src = im.src;
          el.alt = "";
          this.extras.appendChild(el);
        });
      }
    });
  };

  CardView.prototype.setFlipped = function (on) {
    const next = !!on;
    if (next === this.flipped && !this.flipT0) return;
    this.flipFrom = this.flipAngle;
    this.flipTo = next ? 180 : 0;
    this.flipT0 = performance.now();
    this.flipped = next;
    // Keep data-flipped on the outgoing face until the turn finishes so
    // .holo-type (outside the flipper) does not pop in over the back.
    if (this.cardEl) this.cardEl.classList.add("is-flipping");
    this.root.querySelectorAll(".holo-face-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.face === (this.flipped ? "back" : "front"));
    });
    this.syncTypeChrome();
  };

  CardView.prototype.syncTypeChrome = function () {
    // Front overlay text sits outside the 3D flipper. Only show it when the
    // card is nearly face-up (last part of back→front), hide as soon as we leave front.
    const show = this.flipAngle < 28;
    if (this.type) {
      this.type.style.visibility = show ? "visible" : "hidden";
      this.type.style.opacity = show ? "1" : "0";
    }
    if (this.cardEl && !this.flipT0) {
      this.cardEl.dataset.flipped = this.flipped ? "1" : "0";
    }
  };

  CardView.prototype.bind = function () {
    const el = this.cardEl || this.root;
    const stage = this.root.closest("#viewer-stage") || this.root.closest(".float-card") || this.root;
    const opts = this._abort ? { signal: this._abort.signal } : false;
    const track = (e) => {
      if (this._dead) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.target.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.target.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    };
    stage.addEventListener("pointermove", track, opts);
    stage.addEventListener("pointerleave", () => {
      if (!this.down) {
        this.target.x = 0.5;
        this.target.y = 0.5;
      }
    }, opts);
    el.addEventListener("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, opts);
    el.addEventListener("pointerup", (e) => {
      if (this.mini) {
        this.down = null;
        return;
      }
      if (!this.down) return;
      const dist = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      this.down = null;
      if (dist > 9) return;
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      const chest = this.meta.chest || [];
      const hit = chest.some((c) => Math.hypot(nx - c.x, ny - c.y) <= (c.r || 0.09) * 1.35);
      if (!this.flipped && hit) {
        this.jig = 1;
        this.jigT = performance.now();
        return;
      }
      this.setFlipped(!this.flipped);
    }, opts);
    this.root.querySelectorAll(".holo-face-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setFlipped(b.dataset.face === "back");
      }, opts);
    });
  };

  CardView.prototype.tick = function (now) {
    if (this._dead || !this.root || !this.root.isConnected) return;
    this.ptr.x += (this.target.x - this.ptr.x) * 0.14;
    this.ptr.y += (this.target.y - this.ptr.y) * 0.14;
    const px = this.ptr.x;
    const py = this.ptr.y;
    const dx = (px - 0.5) * 2;
    const dy = (py - 0.5) * 2;
    const d = this.depth;
    const glow = this.glow;
    const holoAmt = this.foilAmt;
    const bob1 = this.floatOn ? Math.sin(now / 820) * 7 : 0;
    const bob2 = this.floatOn ? Math.sin(now / 640 + 1.1) * 11 : 0;
    // Animate flip with ease-in-out; soften pointer tilt while flipping
    if (this.flipT0) {
      const t = Math.min(1, (now - this.flipT0) / (this.flipDur || 680));
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.flipAngle = this.flipFrom + (this.flipTo - this.flipFrom) * e;
      if (t >= 1) {
        this.flipAngle = this.flipTo;
        this.flipT0 = 0;
        if (this.cardEl) {
          this.cardEl.classList.remove("is-flipping");
          this.cardEl.dataset.flipped = this.flipped ? "1" : "0";
        }
      }
    } else {
      this.flipAngle = this.flipped ? 180 : 0;
    }
    this.syncTypeChrome();
    const flipping = !!this.flipT0;
    const tiltMix = flipping ? 0.2 : 1;
    const rx = this.tilt ? dy * -16 * tiltMix : 0;
    const ry = this.tilt ? dx * 18 * tiltMix : 0;
    const flipY = this.flipAngle;
    // slight lift at mid-flip so it feels like a real card turn
    const mid = Math.sin((flipY % 180) * Math.PI / 180);
    const lift = mid * 0.045;
    const host = this.cardEl || this.root;
    host.style.setProperty("--px", `${(px * 100).toFixed(2)}%`);
    host.style.setProperty("--py", `${(py * 100).toFixed(2)}%`);
    host.style.setProperty("--dx", dx.toFixed(4));
    host.style.setProperty("--dy", dy.toFixed(4));
    if (this.flip) {
      this.flip.style.transform =
        `rotateY(${(flipY + ry).toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) scale(${(1 + lift).toFixed(4)})`;
    }
    const zBg = -28 - 90 * d;
    const zSub = 36 + 150 * d;
    const pos = `${(18 + px * 64).toFixed(1)}% ${(18 + py * 64).toFixed(1)}%`;
    const foilAmt = 0.16 + holoAmt * 0.72;
    const bgNudgeX = dx * -18 * d;
    const bgNudgeY = dy * -14 * d;
    const fgNudgeX = dx * 34 * d;
    const fgNudgeY = dy * 26 * d + bob1;
    const exNudgeX = dx * 48 * d;
    const exNudgeY = dy * 38 * d + bob2;
    if (this.bg) this.bg.style.transform = `translate3d(${bgNudgeX}px, ${bgNudgeY}px, ${zBg}px) scale(1.04)`;
    const subXf = `translate3d(${fgNudgeX}px, ${fgNudgeY}px, ${zSub}px)`;
    const popFilter = `drop-shadow(${dx * 10}px ${16 + dy * 8}px ${18 + glow * 20}px rgba(0,0,0,.55)) drop-shadow(0 0 ${8 + glow * 24}px rgba(180,220,255,${0.16 + glow * 0.35}))`;
    if (this.fg) {
      this.fg.style.transformOrigin = "50% 50%";
      this.fg.style.transform = subXf;
      this.fg.style.filter = popFilter;
    }
    if (this.chestCv) this.chestCv.style.transform = subXf;
    if (this.charFoil) {
      this.charFoil.style.backgroundPosition = pos;
      this.charFoil.style.opacity = String(foilAmt * 0.78);
      this.charFoil.style.transform = subXf;
    }
    if (this.eyesCv) this.eyesCv.style.transform = subXf;
    if (this.foil) {
      this.foil.style.opacity = String(foilAmt);
      this.foil.style.backgroundPosition = pos;
    }
    if (this.bars) {
      this.bars.style.opacity = String(0.18 + holoAmt * 0.35);
      this.bars.style.backgroundPosition = `${(18 + (1 - px) * 64).toFixed(1)}% ${(18 + (1 - py) * 64).toFixed(1)}%`;
    }
    if (this.spark) {
      this.spark.style.opacity = String(0.22 + holoAmt * 0.45);
      this.spark.style.backgroundPosition = pos;
    }
    if (this.glare) {
      this.glare.style.opacity = String(0.2 + holoAmt * 0.5);
      this.glare.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,.62), transparent 42%)`;
    }
    if (this.shine) {
      this.shine.style.opacity = String(0.28 + holoAmt * 0.5);
      this.shine.style.backgroundPosition = `50% 50%, ${pos}`;
    }
    if (this.frame) this.frame.style.transform = `translateZ(16px)`;
    if (this.shadow) {
      this.shadow.style.transform = `translate3d(${fgNudgeX * 0.4}px, ${8 + fgNudgeY * 0.3}px, 8px) scale(${0.9 + d * 0.4}, 1)`;
      this.shadow.style.opacity = String(0.35 + d * 0.5);
    }
    if (this.backFoil) {
      this.backFoil.style.opacity = String(0.22 + holoAmt * 0.55);
      this.backFoil.style.backgroundPosition = pos;
    }
    if (this.backGlare) {
      this.backGlare.style.opacity = String(0.28 + holoAmt * 0.4);
      this.backGlare.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,.7), transparent 46%)`;
    }
    if (this.backBars) {
      this.backBars.style.opacity = String(0.2 + holoAmt * 0.3);
      this.backBars.style.backgroundPosition = `${(18 + (1 - px) * 64).toFixed(1)}% ${(18 + (1 - py) * 64).toFixed(1)}%`;
    }
    if (this.backSpark) {
      this.backSpark.style.opacity = String(0.22 + holoAmt * 0.45);
      this.backSpark.style.backgroundPosition = pos;
    }
    if (this.extras) {
      [...this.extras.querySelectorAll("img")].forEach((el, i) => {
        const phase = i * 0.7;
        el.style.transform = `translate3d(${exNudgeX}px, ${exNudgeY + Math.sin(phase) * 2}px, ${zSub + 24}px)`;
        el.style.filter = `drop-shadow(0 0 ${10 + glow * 24}px rgba(255,255,220,.55))`;
      });
    }
    this.drawEyes();
    this.drawChest(now);
  };

  CardView.prototype.drawEyes = function () {
    const eyes = this.meta.eyes || [];
    const cv = this.eyesCv;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!this.gaze || !eyes.length || this.flipped) {
      ctx.clearRect(0, 0, cv.width || 1, cv.height || 1);
      return;
    }
    const box = this.cardEl || this.root;
    const w = (cv.width = Math.round(box.clientWidth * (devicePixelRatio || 1)));
    const h = (cv.height = Math.round(box.clientHeight * (devicePixelRatio || 1)));
    ctx.clearRect(0, 0, w, h);
    const dx = (this.ptr.x - 0.5) * 2;
    const dy = (this.ptr.y - 0.5) * 2;
    eyes.forEach((eye) => {
      const ex = eye.x * w;
      const ey = eye.y * h;
      const rad = Math.max(4, (eye.r || 0.03) * w);
      const lx = dx * rad * 0.48;
      const ly = dy * rad * 0.4;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ex, ey, rad * 1.05, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(6,8,16,.38)";
      ctx.beginPath();
      ctx.arc(ex + lx * 0.72, ey + ly * 0.72, rad * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(ex + lx * 1.05 - rad * 0.16, ey + ly * 1.05 - rad * 0.2, Math.max(1.4, rad * 0.17), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(ex + lx * 0.35 + rad * 0.22, ey + ly * 0.25 + rad * 0.24, Math.max(0.7, rad * 0.07), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  };

  CardView.prototype.drawChest = function (now) {
    const cv = this.chestCv;
    const chest = this.meta.chest || [];
    const img = this.images.fg;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!this.jig || !chest.length || !img || this.flipped) {
      ctx.clearRect(0, 0, cv.width || 1, cv.height || 1);
      if (this.fg) this.fg.style.opacity = "1";
      cv.style.opacity = "0";
      return;
    }
    const t = (now - this.jigT) / 1000;
    const damp = Math.exp(-3.2 * t);
    if (damp < 0.02) this.jig = 0;
    const wave = Math.sin(t * 22);
    const ampX = this.jig * damp * wave * 0.22;
    const ampY = -this.jig * damp * wave * 0.3;
    const box = this.cardEl || this.root;
    const w = (cv.width = Math.round(box.clientWidth * (devicePixelRatio || 1)));
    const h = (cv.height = Math.round(box.clientHeight * (devicePixelRatio || 1)));
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    chest.forEach((blob, i) => warp(ctx, w, h, blob, ampX, ampY, t, i * 0.9));
    this.fg.style.opacity = "0";
    cv.style.opacity = "1";
    cv.style.filter = this.fg.style.filter;
  };

  function warp(ctx, w, h, blob, ampX, ampY, time, phase) {
    const cx = blob.x * w;
    const cy = blob.y * h;
    const rx = Math.max(14, (blob.r || 0.09) * w * 1.15);
    const ry = rx * 0.92;
    const x0 = Math.max(0, Math.floor(cx - rx - 2));
    const y0 = Math.max(0, Math.floor(cy - ry - 2));
    const bw = Math.min(w, Math.ceil(cx + rx + 2)) - x0;
    const bh = Math.min(h, Math.ceil(cy + ry + 2)) - y0;
    if (bw < 4 || bh < 4) return;
    const src = ctx.getImageData(x0, y0, bw, bh);
    const dst = ctx.createImageData(bw, bh);
    dst.data.set(src.data);
    const s = src.data;
    const d = dst.data;
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);
    for (let iy = 0; iy < bh; iy++) {
      for (let ix = 0; ix < bw; ix++) {
        const dx = x0 + ix + 0.5 - cx;
        const dy = y0 + iy + 0.5 - cy;
        const e = dx * dx * invRx2 + dy * dy * invRy2;
        if (e >= 1) continue;
        const fall = (1 - e) * (1 - e);
        const kx = 1 / (1 + ampX * fall);
        const ky = 1 / (1 + ampY * fall);
        const jelly = Math.sin(e * 8.5 + time * 16 + phase) * fall * Math.abs(ampY) * 6;
        const sx = Math.max(0, Math.min(bw - 1.001, dx * kx + (cx - x0)));
        const sy = Math.max(0, Math.min(bh - 1.001, dy * ky + (cy - y0) + jelly));
        const i = ((sy | 0) * bw + (sx | 0)) * 4;
        const o = (iy * bw + ix) * 4;
        d[o] = s[i];
        d[o + 1] = s[i + 1];
        d[o + 2] = s[i + 2];
        d[o + 3] = s[i + 3];
      }
    }
    ctx.putImageData(dst, x0, y0);
  }

  CardView.prototype.fitMini = function () {
    const slot = this.root.closest(".slot");
    if (!slot) return;
    const pad = 6;
    const w = Math.max(72, (slot.clientWidth || 160) - pad);
    this.root.style.setProperty("--mini-s", String(w / 380));
  };

  CardView.prototype.destroy = function () {
    this._dead = true;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this._abort) {
      try { this._abort.abort(); } catch (e) {}
      this._abort = null;
    }
    if (this._ro) {
      try { this._ro.disconnect(); } catch (e) {}
      this._ro = null;
    }
    if (this.root) {
      try { this.root.innerHTML = ""; } catch (e) {}
    }
  };

  global.CardView = CardView;
})(window);
