(function (global) {
  const STR = {
    zh: {
      login: "Patreon 登录",
      goPatreon: "去 Patreon",
      logout: "退出",
      admin: "后台",
      editPage: "编辑页面",
      gate: "登录后打开你的个人典藏柜。当天仍在订的会员，卡会自动入柜。",
      statusGuest: "登录后打开你的柜子。当天仍在订的会员，卡会自动出现，不用领取。",
      statusUnpaid: "现在不会发新卡。柜子里已有的还在。",
      statusToday: "今天投放 {n} 张，已按获得时的框入柜。",
      statusNone: "今天没有新投放。",
      statusKeep: "升档不会改旧卡的框。",
      empty: "空位",
      owned: "已有 {n} 张",
      hideInfo: "收起属性",
      showInfo: "属性",
      setCover: "设为封面",
      clearPreview: "清屏预览",
      exitClearPreview: "退出清屏",
      wallpaperPhone: "手机壁纸",
      wallpaperDesk: "电脑壁纸",
      close: "关闭",
      front: "正面",
      back: "背面",
      upgrade: "升级 Patreon 等级",
      profileCards: "柜里 {n} 张",
      profileSlots: "占 {n} 格",
      profileSince: "加入 {d}",
      tier: { t2: "T2", t3: "T3 白银", t4: "T4 黄金", t5: "T5 幻彩", none: "未订阅" },
      frame: { silver: "银", gold: "金", prism: "幻彩", iron: "铁" },
      mock: "模拟",
      hint: "滚轮缩放 · 右键返回 · 点击胸部跳动",
    },
    en: {
      login: "Patreon log in",
      goPatreon: "Patreon",
      logout: "Log out",
      admin: "Admin",
      editPage: "Edit page",
      gate: "Log in to open your cabinet. Active patrons receive that day’s cards automatically.",
      statusGuest: "Log in to open your cabinet. Active patrons receive cards automatically — no claim button.",
      statusUnpaid: "No new cards will be issued. Cards you already have stay.",
      statusToday: "Today’s drop: {n} card(s), framed at the moment you received them.",
      statusNone: "No new drop today.",
      statusKeep: "Upgrading does not change old frames.",
      empty: "Empty",
      owned: "{n} card(s)",
      hideInfo: "Hide",
      showInfo: "Info",
      setCover: "Set as cover",
      clearPreview: "Clear view",
      exitClearPreview: "Exit clear",
      wallpaperPhone: "Phone wallpaper",
      wallpaperDesk: "Desktop wallpaper",
      close: "Close",
      front: "Front",
      back: "Back",
      upgrade: "Upgrade Patreon tier",
      profileCards: "{n} cards in cabinet",
      profileSlots: "{n} slots filled",
      profileSince: "Joined {d}",
      tier: { t2: "T2", t3: "T3 Silver", t4: "T4 Gold", t5: "T5 Prism", none: "Not subscribed" },
      frame: { silver: "Silver", gold: "Gold", prism: "Prism", iron: "Iron" },
      mock: "Mock",
      hint: "Scroll to zoom · right-click to go back · tap chest to bounce",
    },
    ja: {
      login: "Patreon ログイン",
      goPatreon: "Patreon へ",
      logout: "ログアウト",
      admin: "管理",
      editPage: "ページを編集",
      gate: "ログインすると個人キャビネットが開きます。有効な会員はその日のカードが自動で入ります。",
      statusGuest: "ログインしてください。有効な会員は受け取りボタンなしでカードが入ります。",
      statusUnpaid: "新しいカードは配布されません。所持分はそのままです。",
      statusToday: "本日 {n} 枚。受け取った時点の枠で入ります。",
      statusNone: "本日の配布はありません。",
      statusKeep: "アップグレードしても古い枠は変わりません。",
      empty: "空き",
      owned: "{n} 枚",
      hideInfo: "しまう",
      showInfo: "属性",
      setCover: "カバーにする",
      clearPreview: "クリア表示",
      exitClearPreview: "クリア解除",
      wallpaperPhone: "スマホ壁紙",
      wallpaperDesk: "PC壁紙",
      close: "閉じる",
      front: "表",
      back: "裏",
      upgrade: "Patreon ランクを上げる",
      profileCards: "所持 {n} 枚",
      profileSlots: "{n} 枠使用",
      profileSince: "参加 {d}",
      tier: { t2: "T2", t3: "T3 シルバー", t4: "T4 ゴールド", t5: "T5 プリズム", none: "未加入" },
      frame: { silver: "銀", gold: "金", prism: "虹", iron: "鉄" },
      mock: "テスト",
      hint: "ホイールで拡大 · 右クリックで戻る · 胸をタップでバウンド",
    },
  };

  const KEY = "collect-cards-lang";

  function lang() {
    const v = localStorage.getItem(KEY) || document.documentElement.lang || "zh";
    if (v.startsWith("ja")) return "ja";
    if (v.startsWith("en")) return "en";
    return "zh";
  }

  function setLang(v) {
    const L = v === "ja" || v === "en" ? v : "zh";
    localStorage.setItem(KEY, L);
    document.documentElement.lang = L === "zh" ? "zh-CN" : L;
    document.documentElement.dataset.lang = L;
  }

  function t(key, vars) {
    const pack = STR[lang()] || STR.zh;
    let s = pack[key];
    if (s && typeof s === "object") return s;
    if (s == null) s = (STR.zh[key] || key);
    if (vars) {
      Object.keys(vars).forEach((k) => {
        s = String(s).replaceAll("{" + k + "}", String(vars[k]));
      });
    }
    return s;
  }

  function tierLabel(tier) {
    const map = t("tier") || STR.zh.tier;
    return map[tier || "none"] || map.none;
  }

  function frameLabel(v) {
    const map = t("frame") || STR.zh.frame;
    return map[v] || "";
  }

  global.I18N = { STR, lang, setLang, t, tierLabel, frameLabel };
})(window);
