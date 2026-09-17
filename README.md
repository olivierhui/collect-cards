# 收集卡系列 · 展示柜

独立网页：登录 → 认是不是付费会员 → 当天的卡自动进柜。  
钱仍在 Patreon 收。这个站只认人、开柜、盖框。

本地：`start.cmd` → http://127.0.0.1:8788

## 已经锁定的规则

- **T3 / T4 / T5** 当天仍有效才会拿到当天投放的卡。T1 / T2 / 没订 / 过期：能登录也只看空柜或旧卡，不再发新卡。
- **没有领取按钮**，没有 24 小时窗口，不在 Patreon 帖发卡。
- 框 = **第一次入柜那天的档位**（内部字段 silver / gold / prism）。升档不改旧框。降档旧卡保留。
- 柜面 **不写 T3 T4 T5**。顾客看到的是卡和框。
- 一天张数不固定。`drops` 可以是字符串或数组，例如 `"2026-09-16": ["S1-001-1", "S1-002-1"]`。
- 月中才升到 T3：升档前那些投放日没有登录记录 = **空槽**，不补。
- 同一天改档位：以 **当天第一次入柜** 的档位锁框。
- 编号 `S1-001-1` = 第 1 季 · 角色 001 · 该角色第 1 张。同一角色续卡 `S1-001-2` 仍占 001 那一格，角标「已有 2 张」。新面孔才开新格。一季软顶 100 个角色位；柜默认 24 格，角色多了再扩。
- **一份原卡 ZIP**，不要按档位导出三份。外框由柜按获得日档位盖。
- 这周只有 A 面正常卡。不做未审查 B 面。

### 续约补给（函数已留，满月判定后做）

会员满一个月并且续上下一个月：从她柜里 **空着的已投放号** 里随机抽 2 张，框按补给当天的档位。  
见 `store.grant_renewal_bonus`。模拟登录柜上有「测试续约补给」。真正的连续订阅满月以后接。

### 隐藏卡（这周不发卡）

文案：连续订满 2 个月以上，每月一张隐藏卡。卡面未定，没有资源，没有发放逻辑。

### Shop（这周不收银、不进柜）

可卖「过去某个月的卡包集合」，价格贵。Shop 包 **不含隐藏卡**。购买跳 Patreon。网站暂时认不出 Shop 小票。

## 不要做的

- 网页收款、比 Patreon 便宜、引导取消 Patreon。
- 随机 10 张真钱抽包、NFT / 链。
- 未登录页展示任何卡面或角色墙。
- 图片公开可猜路径（必须登录且拥有该卡才能读 `/api/assets/...`）。
- 登录页以外的公开 NSFW。
- Discord 可以以后当通知，不替代柜。

## 闪卡播放（锁定）

`frontend/card.js` 与工作室预览已对齐，**不要为了入柜去改播放**。  
备份：`backup/card-fx-locked-2026-09-16/`。预览参数在每张卡的 `meta.json`（`depth` `glow` `foil` `foilStyle` `foilTarget` `tilt` `float` `gaze` `eyes` `chest`）。

## 自动入柜

`ensure_entitlements(pid)` 在登录和拉 `/api/cabinet` 时运行：

- 记录每次登录的档位到 `users.json` 的 `tierLog[日期]`。
- 对 `drops` 里 `date <= today` 的每张卡：该日 log 是 t3/t4/t5，或「今天仍是 t3+ 且 date==today」，则入柜。
- 没有历史 log 的旧日 = 空槽。
- 库存写在 `data/inventory.json`（会从旧的 `claims.json` 迁一次）。一天多张是数组。

## 把工作室的卡放进来

出卡仍是一份 ZIP：

```
S1-00X-N.zip
  original.png
  background.png
  subject.png
  meta.json
  extra_*.png   （可选）
```

`meta.json` 的 `date` **必须是投放日**。`grade` 不当会员框；会员框只来自获得日档位。

工作室点「导出并入柜」会自动：

1. 把图层写到 `data/cards/S1-001-1/`
2. 把编号加进 `catalog.json` 当天的 drops
3. 再下载一份 ZIP 当备份

编号必须写成 `S1-001-1`。日期栏空着就用当天。一天多张会追加进同一天名单，不会互相覆盖。

## 放到 Render（公网）

仓库：https://github.com/olivierhui/collect-cards

- Language：Python（不要 Docker）
- Build：`pip install -r requirements.txt`
- Start：`uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
- 套餐：Free（$0）即可
- Root Directory：空着
- 环境变量可先只加 `APP_SECRET`（自己编一长串）
- Patreon 的 ID 等网址出来再加

仓库里能看到 `backend/main.py` 再点 Deploy。空仓库会失败。

## 本地怎么跑

```
复制 .env.example → .env
start.cmd
打开 http://127.0.0.1:8788
没填 PATREON_CLIENT_ID 时用页面上的模拟 T3 / T4 / T5 / 未订
```

验证：

- 模拟 T3：今天 drops 里的卡自动在柜，银框，无领取按钮。
- 同一账号再模拟 T4：旧卡仍银框，不会同一天刷档改框。
- 模拟未订：今日不发新卡，旧卡仍在。
- 未登录：看不到任何 png。
- 一天 drops 两张：两个新角色 = 两格；同一角色第二张 = 一格「已有 2 张」。

## Patreon（这周不阻塞）

`.env`：`PATREON_CLIENT_ID/SECRET`、`PATREON_REDIRECT_URI`、`PATREON_CAMPAIGN_ID`、`PATREON_TIER_T3/T4/T5`（档位数字 ID）。  
OAuth scope：identity + `memberships.currently_entitled_tiers`。  
网站不收款。订阅按钮跳回 Patreon。
