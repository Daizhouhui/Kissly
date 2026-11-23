# YouTube 播放层重构：横竖屏 / 全屏切换卡顿

- 分支：`fix/p0-batch`（改动未提交）
- 基线：`6f8bbb9f fix(mobile): resolve playback, sync and settings regressions`
- 日期：2026-11-23
- 范围：只动"播放控制链路"。**播放界面样式、JSX 结构、配色、圆角、图标、字幕/听力/翻译/收藏/进度逻辑一行未改。**

---

## 一、先说结论：为什么之前修了七八次都没修掉

旧代码不是"某个参数没调好"，而是**结构上有多方互相打架的发令者**，并且**用毫秒数去猜原生布局什么时候结束**。只要真机时序稍微偏一点（机型、WebView 版本、CPU 负载都会影响），就会退回到卡顿。

| # | 旧逻辑的结构性问题 | 旧代码位置 | 真机后果 |
|---|---|---|---|
| 1 | 旋转"静默窗口"用固定 650ms：`orientationUntil = Date.now() + 650`，而且是在**调用 `lockAsync()` 的瞬间**开始计时，不是等系统真的转过去 | 旧 `player.tsx` `beginOrientation()`（原 1235-1247 行） | 窗口可能在 Chromium surface 真正 resize **之前**就过期，收尾的 play 正好撞在 resize 中间 |
| 2 | RN 侧再在 800ms / 1800ms **无条件注入** `reconcile()`；而桥脚本在窗口内收到 `reconcile` 只是"重新排一个定时器"，**不发任何命令** | 旧 `scheduleOrientationResume()`（原 1004-1022 行）+ `reconcilePlayback()` | 看起来 reconcile 了，实际经常什么都没做；这就是"改了没效果"的直接原因 |
| 3 | 一次旋转最多有 4~5 条 play 命令：`playFallback`(260/320ms)、`playConfirm`(700ms)、`orientationConfirm`(400ms)、RN 的两次 reconcile | 旧 `requestPlayerPlay` / `playNow` / `scheduleOrientationSettle` | `playVideo()` 与 `video.play()` 互相踩，表现为画面一顿一顿、有时直接停住 |
| 4 | 每次 render 都重建约 40KB 的注入脚本；每条 `time` 消息都整屏 `setState`（每秒 4~10 次） | 旧 `injectedJavaScript={playerBridgeScript(startAtRef.current)}` + `handleMessage` | 旋转那几百毫秒里 JS 线程被占满，掉帧、黑帧 |

---

## 二、新逻辑总览：把"猜时间"换成"布局握手 + epoch"

```
用户点全屏 / 设备自动旋转
        │
        ▼
RN gate.begin(epoch = N)  ──注入──►  bridge.layoutStart(N)      （进入 transition，禁止一切 play 命令）
        │                                   │
        │  React 先按新布局重排 → onLayout    │  Chromium surface 随后 resize → onLayout
        │  物理旋转 → useWindowDimensions 变  │  YouTube 可能在这之后再 pause 一次
        ▼                                   ▼
gate 判定：窗口尺寸变过 + 舞台尺寸静默 140ms  ──注入──►  bridge.layoutStable(N)（只认当前 epoch）
                                                    │
                                                    ▼
                                          phase = steady → 最多 2 条有界恢复命令
                                          （settle 1 条 + settle 后 900ms 内晚到 pause 1 条）
```

新增两个纯逻辑模块，`player.tsx` 只保留 UI 和调用点：

| 文件 | 职责 | 行数 |
|---|---|---|
| `mobile/src/player/bridgeScript.ts` | WebView 注入脚本（唯一写 `<video>` / YouTube player 的地方），含新的 transition 状态机 | 1428 |
| `mobile/src/player/transitionGate.ts` | RN 侧布局握手（纯函数 + 注入定时器，可单测），决定**何时**允许恢复 | 167 |
| `mobile/app/player.tsx` | 播放界面与业务；从 6467 行降到 5212 行（删掉内联的 1360 行桥脚本） | 5212 |

---

## 三、逐条对照表（核查用）

### A. 播放权威 / 状态

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| A1 | 谁说了算 | `playIntent` + `pauseReason` + `orientationUntil/orientationTimer/orientationConfirmTimer/orientationPlayRequested` 四个旋转字段 | `playIntent` + `pauseReason` 保留；旋转字段全部删除，换成 `phase: 'steady'\|'transition'` + `epoch` + `transitionPendingRecovery` | 桥 `bridgeScript.ts:82`、`1068` |
| A2 | RN 如何表达"我要播放" | `togglePlay` 发 `setPlaying(true/false)`；旋转时另发 `orientation()` | 不变：仍然只发**意图**（`setPlaying`）；旋转改成发 `layoutStart(epoch)` / `layoutStable(epoch)`，不再发 `orientation()` | `player.tsx:1037`、桥 `:1201`、`:1204` |
| A3 | 旧 API `orientation()` | 开始 650ms 静默窗口 | 保留但降级为"次要信号"：只开始 transition，结束必须靠 `layoutStable(epoch)` 或 1500ms 保底；RN 已不再调用 | 桥 `:1209` |

### B. "旋转什么时候算结束"

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| B1 | 结束判据 | `Date.now() + 650` 固定窗口 | **真实事件**：窗口尺寸变化（`useWindowDimensions`）+ 舞台 `onLayout` 后静默 140ms，两者都满足才结束 | `transitionGate.ts:96`、`:140`、`:152`、`player.tsx:1073`、`:1987` |
| B2 | 全屏按钮的两段式变化 | 只当一次变化处理 | 显式区分：点按钮时 React 会**先**重排（尺寸已变），**后**才物理旋转。所以 lock 触发的 transition 额外要求 `expectRotation`，只看到 layout 静默不算结束，避免在真旋转前就恢复播放 | `player.tsx:1123`、`:1140`、`transitionGate.ts:40-50` |
| B3 | 兜底上限 | 650ms（可能过早） | 1200ms（RN gate）/ 1500ms（桥自保），只会"少发命令"，不会"往 resize 里多发命令" | `transitionGate.ts:68`、桥 `:1125` |
| B4 | 重试 / 从后台回来 | 后台回来也走 650ms + 两次 reconcile | 从后台回来：不发布局握手，静默 140ms 直接收尾（`expectLayout:false`）；重试（reload）同理 | `player.tsx:1114`、`:1614` |

### C. 恢复命令的数量与时机

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| C1 | 旋转中收到 play | `if (orientationHoldActive()) { scheduleOrientationSettle(); return; }`（还会顺手把窗口再延长） | `if (inTransition()) { transitionPendingRecovery = true; return; }`：只记录诉求，**不发命令、不改窗口** | 桥 `:273-279` |
| C2 | 旋转后恢复几次 | settle(1) + `orientationConfirm`(1) + RN 800ms + RN 1800ms + 每次 `reconcile` 都可能再发 | 硬上限 **2 次**：`recoveryAttempts >= 2` 直接返回；第一次是 settle，第二次只给"settle 后 900ms 内晚到的 pause" | 桥 `:1081-1094`、`:1095-1104` |
| C3 | 广告中的恢复 | 不管 | 广告期间不修复（`isAdShowing()` 直接跳过），避免把广告玩坏 | 桥 `:1087` |
| C4 | `reconcile()` 在 transition 内 | 只 re-arm 定时器（空转） | 记 `transitionPendingRecovery`，等 settle 时一起执行（不再有空转路径） | 桥 `:1153-1176` |
| C5 | 迟到的 "stable" | 没有 epoch 概念，任何 reconcile 都会执行 | `epoch` 单调递增；`layoutStable(旧epoch)` 直接 `return false`，不会恢复错误布局 | 桥 `:1138-1141`、`transitionGate.ts:119` |
| C6 | 已经 steady 时又收到 stable | 会再次 reconcile | 直接 no-op 返回 true | 桥 `:1139` |

### D. `pause` 事件

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| D1 | 普通 pause | 一律不触发 play，只靠定时 reconcile | 仍然不直接 play（保留防抖原意） | 桥 `:556` |
| D2 | settle 之后才到达的 pause | **无人处理**（这是"转回来偶尔卡住/静止"的直接原因） | 若落在 settle 后 900ms 窗口内、`playIntent==='play'`、非广告 → 120ms 后补一次修复，仍受 2 次上限约束 | 桥 `:556-570`、`:1098` |

### E. 用户操作

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| E1 | 旋转中点了暂停 | `orientationPlayRequested=false`，语义含糊 | `pauseNow()` 清空 `transitionPendingRecovery`；settle 时先看 `playIntent`，是 pause 就什么都不做 | 桥 `pauseNow`、`:1144` |
| E2 | 旋转中点了播放 | 定时器碰运气 | 记 pending；settle 时按 intent 执行（不额外叠加确认定时器） | 桥 `playNow` `:367` |
| E3 | 盲听句末暂停 + 旋转 | 依赖"reconcile 不碰 pauseAt" | 规则保留并更强：`reconcile` 永不碰 `pauseAt`；pause 修复只针对 intent=play | 桥 `:1170-1172` |
| E4 | 返回键 / 退出全屏 | 先 `lockAsync` 再注入 orientation，收尾靠定时 | 先 `begin` 再 `lockAsync`，收尾靠舞台布局；`BackHandler` 逻辑未改 | `player.tsx:1123`、`:1140` |

### F. 生命周期

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| F1 | 进入 / 离开播放页 | `resetForEntry` / `pauseForScreen` | 完全保留（含 `sessionStorage` 清理） | `player.tsx` `useFocusEffect` |
| F2 | 从设置页返回 | `focusPlaybackAction` 三分支 | 保留 | `player.tsx` |
| F3 | 卸载 | 清 `orientationResumeTimers` + unlock | 改为 `gate.dispose()` + unlock；桥脚本换代时会清理旧定时器 | `player.tsx:1049`、桥 `:33-40` |

### G. 性能（这次顺带修掉的一半卡顿）

| # | 关注点 | 原逻辑 | 新逻辑 | 位置 |
|---|---|---|---|---|
| G1 | 注入脚本 | 每次 render 重建约 40KB 模板（每秒 4~10 次） | `useMemo`，只在 `videoId` 变化或 retry 时重建；`source` 也做了 memo | `player.tsx:1964`、`:1969` |
| G2 | 进度上报 | 每条 `time` 消息都 `setCurrent` + duration + buffer + ad + quality | `pushProgress()` 合并 <0.1s 且 <150ms 的重复；duration/buffer/ad/quality 同值不 `setState` | `player.tsx:296`、`:1541` |
| G3 | `playing` 镜像 | 每次都 `setPlaying` | 值不变直接返回（同值 setState 仍会走一次 render 调度） | `player.tsx:286-292` |
| G4 | seek 后的上报 | 无特殊处理 | `seekTo` / `cue-ended` 强制刷新节流基线，避免跳转后进度条卡住 | `player.tsx:1297`、`:1470` |

### H. 文件 / API 结构

| # | 原 | 新 |
|---|---|---|
| H1 | 6467 行 `player.tsx`，里面 1360 行是 JS 字符串脚本 | `player.tsx` 5212 行；脚本移到 `src/player/bridgeScript.ts`（可作为独立文件做语法检查） |
| H2 | `window.__kiss` = `play/pause/setPlaying/resume/reconcile/refresh/orientation/resetForEntry/pauseForScreen/toggle/seek/pauseAt/rate/mute/audio/captions` | 以上全部保留，**新增** `layoutStart(epoch)` / `layoutStable(epoch)`；`orientation()` 降级为次要信号 |
| H3 | 桥内字段 `orientationUntil / orientationTimer / orientationConfirmTimer / orientationPlayRequested` | 全部删除，换成 `phase / epoch / transitionSource / transitionGuardTimer / transitionPendingRecovery / settleWindowUntil / recoveryAttempts / recoveryTimer` |
| H4 | 旋转逻辑散在桥 + RN 两处定时器 | 唯一决策点 `transitionGate`；桥只执行、不判断 |

---

## 四、一次"竖屏 → 横屏 → 竖屏"的命令序列对比

**旧**

1. 点全屏 → 注入 `orientation()` → `orientationUntil = now+650`
2. `lockAsync(LANDSCAPE)`
3. 200~400ms 后物理旋转 → 布局变 → surface resize → 视频被 pause
4. +650ms 桥自己的 `orientationTimer` → `reconcile` → 发 play（可能正撞在 resize 中）
5. +800ms RN `reconcile`：若还在窗口内 → 只 re-arm（空转）；否则发 play
6. +1800ms RN `reconcile` → 再发 play
7. 若 YouTube 在 +2000ms 又 pause 一次 → 没人处理 → 画面停住/一顿
8. 再加 `playConfirm(700ms)` / `orientationConfirm(400ms)`，命令数不可控

**新**

1. 点全屏 → `gate.begin(epoch=1, expectLayout+expectRotation)` → 注入 `layoutStart(1)` → 桥 `phase=transition`
2. `lockAsync(LANDSCAPE)`
3. React 先按新布局重排 → 舞台 `onLayout`（**不结算**：还没物理旋转）
4. 物理旋转 → `useWindowDimensions` 变 → `gate.observeRotation()`
5. surface resize → `onLayout` 新尺寸 → 静默 140ms → settle → 注入 `layoutStable(1)`
6. 桥 `phase=steady` → 发**1 条** play（若本来就在播则不重复发）
7. settle 后 900ms 内若再来 pause → **1 条**修复，随后彻底停手
8. 全程最多 2 条 play，且都在 surface 稳定之后

---

## 五、这次为什么不会重犯

1. **命令有上界**：每次 transition 的 play 命令 ≤ 2（`recoveryAttempts` 硬限），不存在"多补几次总会好"的错误路径。
2. **不再用时间猜状态**：唯一保留的时间值都是**上限**（gate 1200ms、桥 1500ms）和**静默窗口**（140ms）。上限只会导致"少发命令"（最多多等 ≤1.2s），不会再往 resize 中间插命令。
3. **epoch 单调**：迟到的 `layoutStable` 不会恢复上一轮布局，晚到消息直接丢弃。
4. **意图与执行分离**：旋转里点播放/暂停只改 `playIntent`（或记 pending），执行永远发生在 settle 之后。

---

## 六、明确没有改动的东西（UI 承诺）

- 所有 JSX：`videoBlock`、竖屏 controls、横屏 `landscapeOverlay`、字幕行、进度条、倍速/字号/听力/AI 分析面板、toast、sheet、modeMenu 结构完全不变。
- 所有样式：`styles.*` 键值、颜色、圆角、`radiusStyle`、squircle、图标尺寸一律未改。
- 业务逻辑：字幕抓取/翻译/缓存、句子收藏、观看进度落库、导出 PDF、学习页、播客、设置同步均未改。
- 唯一"行为可见"的差异：进度条刷新从"每条上报都刷"变成"≥0.1s 或 ≥150ms 才刷"。数值精度足够（字幕高亮容差本来就是 0.12s），但如果你觉得进度条不够顺，这个阈值可以调小。

---

## 七、验证结果（本地）

```
npx tsc --noEmit                              通过
node artifacts/check-bridge-syntax.cjs        bridge syntax OK, chars = 51127
scripts/test-*.mjs 共 28 个脚本               全部通过
  test-player-playback-intent.mjs             27 条（原 12 条，新增 layout/epoch/有界恢复 15 条）
  test-player-transition-gate.mjs             11 条（新增，纯布局握手单测）
```

新增断言覆盖的关键行为：

- 旋转中（transition）任何 reconcile / play 都不发命令
- 过期 epoch 的 `layoutStable` 被丢弃，不恢复旧布局
- 丢失 stable 消息时由 guard 收尾，且只恢复一次
- settle 后连续 pause 最多再修一次，3000ms 后不再增长（无循环）
- 用户暂停在 transition 内不会被 settle 强行播放
- 全屏按钮场景必须等"窗口尺寸变化 + 布局稳定"两者都满足才恢复

---

## 八、真机验收清单（必须你做，自动化替代不了）

1. 竖屏播放 → 点全屏 → 横屏续播（画面不黑、不顿）
2. 横屏 → 点退出全屏 → 竖屏续播
3. 连续快速点 3 次全屏（不等动画结束）
4. 关闭系统方向锁定，物理旋转来回 3 次（不经过按钮）
5. 横屏按返回键退出
6. 旋转动画期间立刻点"暂停/播放"
7. 盲听模式句末暂停状态下旋转一次，确认回来仍停在句末
8. 按 Home 再回来（后台切换）
9. 弱网（限速 1Mbps）下旋转
10. 广告播放中旋转

逐条结果请对照"是否还有 ≥300ms 的黑帧 / 音频断一下 / 进度回退"，这三项是旧逻辑的典型症状。

---

## 九、风险与未验证

1. **没做真机验证**：以上只有类型检查 + 27→28 个脚本的结构/时序断言，不能替代设备验收。
2. **iOS 未验证**：`ScreenOrientation.lockAsync` 行为与 Android 不同，iOS 上全屏是"布局变化"而非"窗口旋转"，此时 `expectRotation` 可能永远不满足 → 走 1200ms guard 收尾，仍能恢复，但会多等约 1s。若 iOS 实测偏慢，建议给 `begin` 传 `expectRotation: Platform.OS !== 'ios'`。
3. **若某机型 `lockAsync` 不触发 `useWindowDimensions` 变化**：同样走 guard 兜底（多等 ≤1.2s），不会卡死。
4. **`onLayout` 完全不触发**（极端情况）：1200ms guard 收尾，行为等同于旧版的最长等待。
5. **广告期间**：跳过恢复是刻意的取舍；若你希望广告后立刻恢复正片，需要额外监听 ad-ended，本次未做。

---

## 十、改动文件

```
新增  mobile/src/player/bridgeScript.ts          WebView 注入脚本 + transition 状态机
新增  mobile/src/player/transitionGate.ts        RN 布局握手（纯逻辑，可单测）
新增  mobile/scripts/test-player-transition-gate.mjs
改    mobile/app/player.tsx                      删除内联脚本；接入 gate；memo 脚本/source；状态去重
改    mobile/scripts/test-player-playback-intent.mjs   取桥路径 + 14 条新断言
改    mobile/scripts/test-player-buffer.mjs             取桥路径 + 缓冲断言随实现同步
改    mobile/scripts/test-precision-pause.mjs           取桥路径
改    artifacts/check-bridge-syntax.cjs                 改读新模块路径
```



