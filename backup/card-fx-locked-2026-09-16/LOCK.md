# 闪卡播放 · 锁定备份 2026-09-16

工作室预览与展示柜已对齐。下面这些文件是卡面效果，**不要为了入柜/Patreon/柜面去改它们**。

| 活文件 | 本备份 |
|---|---|
| `frontend/card.js` | `card.js` |
| `frontend/styles.css` 里所有 `.holo-*` | `holo-styles.css` |
| `frontend/holo/` | 仍以活目录为准（纹理未改） |

恢复：把本目录的 `card.js` 拷回 `frontend/card.js`，把 `holo-styles.css` 里的规则贴回 `frontend/styles.css` 的闪卡段。

柜面、登录、入柜只动 `app.js` / `index.html` / `backend/` / `data/`。
