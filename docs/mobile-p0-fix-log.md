# Kissly P0 修复记录



* 分支：`fix/p0-batch`

* 基线：`main`（`dedbe0ea feat(player): polish transcript reading and caption cache`）

* 日期：2026-11-22

* 范围：只修 P0；不构建 Release、不发布 Release

* 说明：每个 bug 一个独立提交，可单独回滚。自动化验证全部通过；设备端验收步骤见每条末尾。

## 总览



| 编号   | 问题                         | 提交                      | 状态            | 自动化验证              |
| ---- | -------------------------- | ----------------------- | ------------- | ------------------ |
| P0-1 | 观看进度被清零 / 倒退，历史时间被覆盖       | `33dffed8`              | 已修复           | 16 条断言通过           |
| P0-2 | “继续观看” 从 0 开始，进度条与续播点对不上   | `cd91da60`              | 已修复           | 16 条断言 + 桥脚本语法     |
| P0-3 | 句子收藏点进去永远从视频开头播            | `b8600662`              | 已修复           | 16 条断言 + typecheck |
| P0-4 | WebDAV 设置同步整文件覆盖，412 重试丢数据 | `aa1dbcff` + `d49051f6` | 已修复           | 12 条断言 + typecheck |
| P0-5 | 系统翻译把 `auto` 当英语，非英语字幕翻错   | `a64fb017`              | 已修复（Android）  | 5 条断言 + typecheck  |
| P0-6 | 播放器强制 1080p，弱网卡顿 / 加载慢     | `b8c9db73`              | 已修复           | 桥脚本语法 + typecheck  |
| P0-7 | Release 用 debug 签名，覆盖安装失败  | 未改代码                    | 阻塞：缺 keystore | 配置审查               |

统一验证命令（在 `mobile/` 下）：



```
npm run typecheck
node --no-warnings scripts/test-watch-progress.mjs
node --no-warnings scripts/test-settings-sync.mjs
node --no-warnings scripts/test-system-language.mjs
node ..\artifacts\check-bridge-syntax.cjs
```

当前结果：`tsc --noEmit` 无报错；三个测试脚本分别输出 `16 / 11 / 5 assertions passed`；桥脚本 `bridge syntax OK`。



***

## P0-1 观看进度被清零、历史时间被覆盖

### 现象



* 看完一段退出，再进首页，进度条回到 0，或显示的时间比实际更早。

* 视频结尾退出后，首页仍显示 “看到一半”。

* 同一视频反复打开，历史列表顺序和 “最近观看” 时间乱跳。

### 根因



1. 历史条目复用了收藏的 `FavoriteItem`，`savedAt` 同时承担 “收藏时间” 和 “最近观看时间”，每次写进度都会覆盖它。

2. 进入播放器就立刻写一条 `progress: 0`，把之前真实的进度冲掉。

3. 进度提交没有防抖 / 合并，多个定时器和卸载回调竞争，后写的 0 覆盖先写的真实值。

4. 界面按 `progress` 计算进度条，但续播实际用的是另一个位置，二者会不一致。

### 修复



* 新增 `HistoryItem`（`src/core/types.ts`）：`savedAt` 首次保存后不变，新增 `lastWatchedAt`、`progress`、`resumeAt`、`duration`。

* 新增纯函数模块 `src/core/watchProgress.ts`，把所有写入收敛到 `mergeHistoryEntry`：


  * `progress` 取历史最大值，只增不减；

  * `resumeAt` 只在播放确实前进（> 0.5 秒）时更新；

  * `savedAt` 不被覆盖，`lastWatchedAt` 每次更新；

  * `resumeTarget` 在距结尾 3 秒内回到 0，避免 “续播到结尾直接结束”。

* `store.recordHistory` 改为在 `set` 内与最新条目合并后再前插并截断 120 条，避免异步回调拿到旧数组。

* `player.tsx`：


  * 删除 “进入即写 `progress: 0`” 的 effect 和 `recordedRef`；

  * `progressRef` 增加 `ad` / `lastDuration`，广告期间、时长未知、位置 < 1 秒都不落盘；

  * 时长变化超过 20% 时跳过本次采样（清晰度切换 / 广告会临时改 duration）；

  * 暂停（`playing` 变 false）时补写一次，减少 “退出前最后几秒丢失”。

* 首页：进度条改用 `watchedFraction`（按 `resumeAt`），剩余时间用 `remainingSeconds`；没有 `duration` 时显示 “继续观看”。

* 历史页：文案改为 “最近观看 `lastWatchedAt`”。

### 改动文件



* `mobile/src/core/types.ts`

* `mobile/src/core/watchProgress.ts`（新增）

* `mobile/src/core/store.ts`

* `mobile/app/player.tsx`

* `mobile/app/(tabs)/index.tsx`

* `mobile/app/history.tsx`

* `mobile/scripts/test-watch-progress.mjs`（新增）

### 自动化验证



```
watch-progress: 16 assertions passed
```

覆盖：进度只增不减、首存时间不变、续播点只在前进时更新、结尾 3 秒归零、`startAt` 解析、剩余时间不为负。

### 真机验收步骤



1. 打开一个 10 分钟以上的视频，播放到约 3 分钟，暂停并退出。

2. 回首页，确认卡片进度条约 30%、剩余时间约 7 分钟。

3. 再次进入同一视频，确认从约 3 分钟开始（不是 0，也不是结尾）。

4. 播放到结尾前 2 秒退出，回首页确认进度条回到 0、显示 “继续观看”。

5. 隔天再打开首页，确认该视频的 “最近观看” 时间更新，但最初收藏时间没有变。

6. 历史页确认该条目的时间与首页一致，没有跳回旧时间。

### 风险与遗留



* `progress` 是 “看过的最远位置”，`resumeAt` 是 “最后停留位置”；如果用户跳着看，进度条会停在最远点，这是有意设计。

* 尚未处理 “多设备历史同步”，历史目前是本地的。



***

## P0-2 “继续观看” 从 0 开始

### 现象



* 首页 “继续观看” 卡片能显示进度，但点进去视频总是从 0 开始。

* 进度条显示 50%，播放器却从头播；手动拖到进度条位置后，下次再进又回到 0。

### 根因



* 路由只传了 `videoId/title/author`，播放器不知道应该从哪一秒开始。

* 播放器桥脚本（注入到 YouTube WebView 的 JS）只负责播放 / 暂停，没有 “设置初始位置” 的入口。

* WebView 重新加载或桥脚本重新注入时，`currentTime` 会被 YouTube 重置，RN 侧没有兜底。

### 修复



* `player.tsx` 路由参数新增 `startAt`，用 `parseStartAt` 解析成 `initialStartAt`，并保存到 `startAtRef`。

* `playerBridgeScript(startAt)`：


  * 桥对象增加 `startAt` / `startApplied`；

  * 新增 `applyStart(v)`：`readyState >= 1` 时按 `duration` 夹取目标位置，设置 `currentTime`，标记已应用并上报；

  * 在 `bind()` 和 `maybeStart()` 的 `play()` 之前调用；

  * 重新注入时，同值才继承 `startApplied`，否则重新定位。

* `injectedJavaScript` 和 `onLoadEnd` 重新注入都传 `startAtRef.current`；`retry()` 先把 `startAtRef` 设为当前进度再 reload。

* RN 侧看门狗：`ready` 后 1.5 秒，如果 `current < initialStartAt - 2` 且不是广告，补发一次 `window.__kiss.seek(...)`，处理 YouTube 重置。

* 首页卡片参数增加 `startAt`；历史行用 `resumeTarget(item)` 后传 `startAt`。

### 改动文件



* `mobile/app/player.tsx`

* `mobile/app/(tabs)/index.tsx`

* `mobile/app/history.tsx`

* `mobile/src/core/watchProgress.ts`（`parseStartAt` / `resumeTarget`）

* `mobile/scripts/test-watch-progress.mjs`

### 自动化验证



```
watch-progress: 16 assertions passed
bridge syntax OK, chars= 30587
```

### 真机验收步骤



1. 首页点 “继续观看”，确认视频从卡片显示的进度位置开始，而不是 0。

2. 进入后立刻看播放器左上角时间，确认与卡片剩余时间大致吻合。

3. 在播放器里手动拖到 80%，退出再进，确认从 80% 继续。

4. 播放中切后台再回来（触发 WebView 重新加载），确认仍在原来的位置附近。

5. 从历史列表点同一视频，确认同样从上次位置开始。

6. 从句子收藏点进去，确认从该句时间开始（这条同时验证 P0-3）。

### 风险与遗留



* YouTube 广告期间不能定位，代码会等广告结束后再应用。

* 如果视频实际时长与历史记录差异很大（例如视频被替换），`startAt` 会被 `duration - 1` 夹取，不会越界。



***

## P0-3 句子收藏点击后从视频开头播放

### 现象



* 在播放器里收藏一句字幕，去 “句子收藏” 点它，视频从 0 开始，需要手动拖到那句。

* 收藏条目里明明有 `start` 时间，但点击没有用它。

### 根因



* `favorites.tsx` 的句子收藏点击只传 `videoId/title/author`，没有把 `item.start` 带进路由参数。

* P0-2 增加了 `startAt` 参数后，这个入口没有接上。

### 修复



* 点击时先 `parseStartAt(item.start)`，大于 0 才把 `startAt` 放进路由参数，避免 0.5 秒以内的首句也触发定位。

* 复用 P0-2 的桥脚本定位逻辑，不新增第二套跳转代码。

### 改动文件



* `mobile/app/favorites.tsx`

### 自动化验证



```
watch-progress: 16 assertions passed
tsc --noEmit 通过
```

### 真机验收步骤



1. 打开一个视频，在某句字幕处点收藏（确认收藏的是句子，不是整个视频）。

2. 退出播放器，进入 “我的 → 句子收藏”，找到该句。

3. 点击该句，确认播放器从这句话开始，而不是 0。

4. 点另一句更靠后的收藏，确认跳到对应时间。

5. 点一句位于 1 秒以内的收藏，确认从 0 开始（这是有意的边界）。

### 风险与遗留



* 句子收藏没有 “所属字幕语言” 字段，若同一视频换了字幕语言，时间仍然正确，但句子文本可能对不上。



***

## P0-4 WebDAV 设置同步互相覆盖

### 现象



* 两台设备都开 WebDAV 同步：A 改了字幕字号，B 改了翻译语言；同步后其中一台的设置被另一台整份覆盖。

* 同步时遇到 412（文件被其他设备改过），重试后对方刚改的设置消失。

* 只改了主题 / 主题色，也会让整份设置变 “新”，把另一台的真实设置冲掉。

### 根因



1. `settings.json` 只有版本 1：一个 `updatedAt` 管所有设置，同步时 “谁的时间新，谁整份赢”。

2. `patchSettings` 任何改动（包括 `webdav`、`theme`、`themeAccent`）都会刷新 `settingsUpdatedAt`。

3. 412 重试只是用本地旧快照再 PUT 一次，没有重新合并服务器上的新内容。

4. `webdav` 里含密码，本来就不应该上传；`theme` 是设备本地外观，也不应该跨设备。

### 修复



* 新增 `src/core/settingsSync.ts`：


  * `SYNCED_SETTING_KEYS`：只同步 20 个业务设置，明确排除 `webdav`、`theme`、`themeAccent`；

  * `changedSettingKeys`：按顶层 key 做深比较，只有值真的变了才算改动；

  * `mergeSettings`：按 key 做 last-writer-wins，每个 key 有自己的时间戳；

  * `normalizeStamps`：兼容旧版 v1 文件（整份一个时间）和缺失 key；

  * `settingsFileChanged`：只有值或时间戳变化才上传，减少无意义 PUT。

* `store.ts`：


  * 新增持久化字段 `settingsStamps`；

  * `patchSettings` 只给 “实际改动的同步 key” 打时间戳；只改主题 / WebDAV 不再刷新 `settingsUpdatedAt`；

  * `replaceSettings` 接收第三个参数 `stamps`；

  * 持久化迁移：旧安装没有 `settingsStamps` 时，用 `settingsUpdatedAt` 给所有 key 回填，保持旧行为可升级。

* `sync/index.ts`：


  * `settings.json` 升级到 `version: 2`，写入 `stamps`；

  * 同步时按 key 合并，远端较新的 key 才覆盖本地；

  * 先落本地合并结果，再决定是否上传；

  * 412 后重新 GET、重新合并、再 PUT，并把重试结果写回本地；

  * 远端 v1 文件按 “整份 `updatedAt`” 处理，首次同步会自动升级为 v2。

* `webdav`、`theme`、`themeAccent` 始终保留本地值，不参与合并。

### 改动文件



* `mobile/src/core/settingsSync.ts`（新增）

* `mobile/src/core/store.ts`

* `mobile/src/core/sync/index.ts`

* `mobile/scripts/test-settings-sync.mjs`（新增）

### 自动化验证



```
settings-sync: 12 assertions passed
```

覆盖：不同 key 各自保留、同 key 新者胜、v1 兼容、旧本地无 stamps 时远端较新值生效、v2 缺 key 不覆盖本地、部分本地 stamps 不把未改 key 当成新值、敏感 / 外观字段不上传、嵌套 `subtitle` 改动识别、412 二次合并保留对方新 key。

### 真机验收步骤

> 需要两台设备（或一台设备 + 手动改 WebDAV 文件）才能完整验证。



1. 设备 A、B 都配置同一个 WebDAV，开启同步。

2. A 改字幕字号到 24；B 改翻译语言到日语；各自等待同步完成。

3. 在 A 上再点一次同步，确认 A 的字幕字号仍是 24、翻译语言也变成日语；B 同理。

4. 只改 A 的主题色，点同步；确认 B 的业务设置没有被覆盖，A 的主题色也没有被 B 覆盖。

5. 用文本编辑器打开 WebDAV 上的 `settings.json`，确认有 `"version": 2` 和 `"stamps"`，且没有 `webdav` / `theme` / `themeAccent` 字段。

6. 手动把文件改成一个旧版 `version: 1`（只有 `updatedAt`），再同步，确认能正常升级且不丢设置。

7. 两台设备几乎同时点同步（制造 412），确认双方刚改的 key 都保留。

### 风险与遗留



* 同步采用 “按 key 最后写入者胜”，同一 key 在两端同时改，仍然只有一份胜出；这是预期语义，不做字段级三方合并。

* 设备时钟严重不准时，时间戳会偏差；目前没有使用服务器时间。

* `settings.json` 里仍然不包含 API Key（密钥走单独的 secret 存储，不参与同步）。



***

## P0-5 系统翻译把 auto 当英语

### 现象



* 学习语言设为日语 / 韩语，字幕也是日语 / 韩语，但选用 “系统内置翻译” 后，译文是英文模型的乱码或英文。

* 下载语言包时提示下载英语包，而不是当前字幕语言包。

* 语言不支持时静默按英语处理，用户不知道发生了什么。

### 根因



1. `translate/system.ts` 里 `from === 'auto' ? 'en' : from`，把 “自动” 硬编码成英语。

2. 设置页下载语言包传的是 `settings.sourceLang`，默认就是 `auto`，所以下载的也是英→中。

3. Android 原生 `normalizeLanguage` 对未知语言 `?: TranslateLanguage.ENGLISH`，静默回退英语。

4. iOS 同样把 `auto` 回退成 `.english`，且未在 Mac 上编译验证。

### 修复



* 新增纯函数 `src/core/translate/language.ts` 的 `resolveSystemSource(from, learningLang)`：


  * `from` 是明确语言（如 `ja`）就用它；

  * `from` 为空或 `auto` 时用 `learningLang`（当前抓取的字幕语言）；

  * 两者都没有才回退 `en`。

* `system.ts` 翻译和下载语言包都先经过这个函数。

* Android `SystemTranslateModule.kt`：


  * `auto` 或空语言直接抛错，不再猜英语；

  * `TranslateLanguage.fromLanguageTag` 不认识的语言抛 “系统翻译不支持语言：xxx”，不再静默回退英语。

* 播放器本来就把字幕轨道的真实语言传给翻译层（`trackKey.split(':')[0]`），所以正常播放路径直接用真实语言；设置页下载语言包也走同一套解析。

### 改动文件



* `mobile/src/core/translate/language.ts`（新增）

* `mobile/src/core/translate/system.ts`

* `mobile/modules/kissly-system-translate/android/src/main/java/com/knny/systemtranslate/SystemTranslateModule.kt`

* `mobile/scripts/test-system-language.mjs`（新增）

### 自动化验证



```
system-language: 5 assertions passed
tsc --noEmit 通过
:kissly-system-translate:compileDebugKotlin BUILD SUCCESSFUL
```

覆盖：`auto` 用字幕语言、空值用字幕语言、明确语言优先、缺学习语言回退英语、空格清理。

### 真机验收步骤



1. 设置 → 语言 → 学习语言设为 “日本語”，翻译语言设为 “简体中文”。

2. 设置 → 翻译引擎 → 选 “系统内置翻译”，确认弹窗下载的是 “日语→中文” 语言包（不是英语）。

3. 打开一个日语字幕视频，确认原文是日语、译文是中文，不是英文乱码。

4. 换成韩语视频 / 韩语学习语言，重复一次，确认下载韩语包并正常翻译。

5. 把学习语言改成 ML Kit 不支持的语言（如果有），确认给出明确错误，而不是输出英文。

6. 断网后再次翻译已下载语言包的视频，确认仍可离线翻译。

### 风险与遗留



* iOS `SystemTranslateModule.swift` 的 `normalizeLanguage` 仍会把 `auto` 回退成 `.english`；JS 层已经保证不传 `auto`，但未知语言在 iOS 上仍可能回退。当前环境没有 macOS/Xcode，未改 Swift，也未编译验证，记为遗留。

* Android 端已跑 `:kissly-system-translate:compileDebugKotlin`，`BUILD SUCCESSFUL`；完整 APK 未构建，真机安装后再验证实际语言包下载与翻译结果。



***

## P0-6 播放器强制 1080p

### 现象



* 视频一开始就尝试锁 1080p，弱网下首帧很慢、频繁缓冲。

* 清晰度被固定在 1080p，流量大，低端机发热 / 掉帧。

* 播放器角标写死 “HD1080・优先”，与实际清晰度不符。

### 根因



* 桥脚本在 `playing` 后 1.8 秒调用 `setPlaybackQualityRange('hd1080','hd1080')`，并每 5 秒重复调用。

* 这段逻辑假设 “1080p 一定更好”，没有考虑网速、设备性能和 YouTube 的自适应策略。

* UI 角标在拿不到实际清晰度时直接显示 `HD1080`。

### 修复



* 删除桥脚本里的 `setQuality()`、`qualityTimer`、`hd1080` 强制调用、`qualityStarted` 标记。

* 保留 `report()` 里的 `quality` 回显（只读），用于显示 YouTube 当前实际选择的清晰度。

* 角标改为：有实际清晰度显示实际值，没有则显示 `AUTO · 自适应`。

* 不再每 5 秒打断 YouTube 的自动码率选择。

### 改动文件



* `mobile/app/player.tsx`

### 自动化验证



```
bridge syntax OK, chars= 30587
tsc --noEmit 通过
```

### 真机验收步骤



1. 用 4G / 限速网络打开一个视频，确认首帧比以前快、没有一上来就卡在 1080p。

2. 观察播放器角标：应显示 `AUTO · 自适应` 或 YouTube 实际清晰度（如 `HD720`），不再是固定的 `HD1080`。

3. 在设置里把 YouTube 清晰度改为 480p/720p，退出重进，确认 app 不会把它强行改回 1080p。

4. 播放 10 分钟，确认没有周期性卡顿（旧代码每 5 秒调一次清晰度）。

5. 用 WiFi 播放 1080p 视频，确认 YouTube 仍可自行升到 1080p（不是被禁用，只是不再强制）。

### 风险与遗留



* 现在完全交给 YouTube 自适应；如果想给0

* `quality` 字段仍在上报，若某些 WebView 版本不提供 `getPlaybackQuality`，角标会一直显示 `AUTO`。



***

## P0-7 Release 签名不固定（阻塞，未改代码）

### 现象



* GitHub Actions 每次构建出的 Release APK 签名可能不同。

* 用户从上一个 Release 覆盖安装新 Release 时提示 “应用未安装 / 签名不一致”，只能先卸载（会丢本地数据）。

### 根因



* `android/app/build.gradle` 的 `release` 使用 `signingConfigs.debug`。

* CI 没有配置 release keystore，debug keystore 由 runner 临时生成，每次指纹不同。

### 现状



* 本次按要求不构建、不发布 Release，所以没有改 CI / 签名配置。

* 真正修复需要一个固定的 release keystore（`.jks`）+ 四个 GitHub Secrets：`KEYSTORE_BASE64`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`，并在 `build.gradle` 增加 `signingConfigs.release`、CI 解码 keystore 后传入。

* 在提供 keystore 前，任何 “自动修复” 都只是把 debug 签名换个位置，不能解决覆盖安装问题。

### 待你决策



1. 生成一个新的 release keystore（推荐，密码由你保管），我用它改 Gradle + CI；

2. 或继续用 debug 签名，但接受 “升级必须卸载”；

3. 或改走 “每次发布前手动签名” 的流程。



***

## 网页端实测（Chrome + Node.js）

按你的要求，不改动 / 不控制默认桌面，也不启动模拟器。能在网页端复现的部分已经实测，结果如下。

### Chrome：播放器桥脚本（P0-2 / P0-6）

用 Chrome 打开本地测试页：真实的 `<video>` 元素 + `MediaRecorder` 生成约 2.4 秒的测试视频 + 伪造 YouTube `movie_player` 接口（记录所有清晰度调用），注入 `player.tsx` 里**原样提取**的桥脚本，`startAt=1`。

实测输出：



```
{
  "duration": 2.411,
  "seekedTime": 1.2937,
  "startApplied": true,
  "qualityCalls": [],
  "readyMessages": 1,
  "lastTime": {
    "current": 2.411,
    "duration": 2.411,
    "quality": "hd720",
    "ad": false
  },
  "checks": [
    ["startAt seeks near 1s", true],
    ["did not start at 0", true],
    ["startApplied flag", true],
    ["no forced 1080p calls", true],
    ["reports actual quality", true],
    ["ready reported once", true]
  ]
}
```

结论（Chrome 页面 `document.title = "pass"`，6 项断言全过）：



* 注入后 300ms 播放位置是 `1.2904`（从 1 秒开始并正常前进），不是 0，`startApplied=true`；P0-2 的定位逻辑在真实浏览器视频元素上生效。

* 播放超过 3 秒后 `qualityCalls=[]`。旧代码会在 `playing` 后 1.8 秒调用 `setPlaybackQualityRange('hd1080','hd1080')`，现在已经完全没有调用；P0-6 生效。

* `report` 消息里的 `quality` 是 `hd720`，角标可以显示 YouTube 实际清晰度，而不是写死 `HD1080`。

* 局限：测试页用的是合成视频和伪 YouTube player，覆盖不了真实 YouTube DOM、广告插入、WebView 生命周期与弱网码率切换；这些仍需真机。

### Node.js



```
watch-progress: 16 assertions passed
settings-sync: 12 assertions passed
system-language: 5 assertions passed
bridge syntax OK, chars= 30587
tsc --noEmit 通过
```



* P0-1：进度合并、续播点、结尾归零等纯逻辑已覆盖；持久化和 UI 定时器仍需真机。

* P0-4：按 key 合并、v1 兼容、412 二次合并等纯逻辑已覆盖；真实 WebDAV ETag / 网络请求仍需设备或双端联调。

* P0-5：`auto → 字幕语言` 解析已覆盖；ML Kit 语言包与原生代码必须 Android 真机。

### 网页端测不了、需要你真机实测的项



| 编号   | 为什么网页端测不了                                           | 真机要重点看                       |
| ---- | --------------------------------------------------- | ---------------------------- |
| P0-1 | AsyncStorage 持久化、退后台 / 杀进程、播放器卸载时序都发生在 RN 原生侧       | 退出重进进度不归零、历史时间不被覆盖           |
| P0-2 | 真实 YouTube WebView 的 DOM、广告、重新加载后的 `currentTime` 重置 | 点 “继续观看” 从正确位置开始；切后台回来不跳 0   |
| P0-3 | expo-router 路由参数和原生页面跳转                             | 句子收藏点进去从该句开始                 |
| P0-4 | 真实 WebDAV 的 ETag/412、两台设备并发、AsyncStorage 迁移         | 两端各改不同设置后都保留；只改主题不覆盖对方       |
| P0-5 | ML Kit 语言包下载、Google Play 服务、非英语字幕                   | 日语 / 韩语字幕翻成中文，不是英文乱码；下载对应语言包 |
| P0-6 | 真实网络码率、首帧时间、YouTube 自适应清晰度                          | 弱网首帧变快，角标显示 AUTO 或实际清晰度      |
| P0-7 | 需要构建 / 发布 Release，且缺 keystore                       | 暂不测；等你决定签名方案                 |

> 请你在手机上按上面每条的 “真机验收步骤” 操作，重点先验 P0-1/2（进度与续播）和 P0-6（弱网首帧）。P0-7 需要你先决定 release keystore 方案，我不会自动构建或发布 Release。

## 提交清单



```
33dffed8 fix(player): keep watch progress monotonic and preserve resume point
cd91da60 fix(player): resume from the stored position via startAt
b8600662 fix(favorites): open a saved sentence at its cue time
aa1dbcff fix(sync): merge settings per key instead of whole-file overwrite
d49051f6 fix(sync): treat missing per-key stamps as untouched
a64fb017 fix(translate): use the real caption language for system translation
b8c9db73 fix(player): let YouTube pick the quality instead of forcing 1080p
```