# Kissly P1 修复记录

分支：`fix/p0-batch`  
基线：P0 批次最后提交 `4dd7c73c`  
本轮范围：首批 5 个 P1 问题 + 后续三批小修复与性能优化，全部已单独提交

## 总览

| 编号 | 问题 | 提交 | 网页/Node 验证 | 真机验证 |
| --- | --- | --- | --- | --- |
| P1-1 | 翻译缓存不区分模型/端点，过期缓存不回收 | `595b709e` | 7 条断言 + tsc 通过 | 需要 |
| P1-2 | 冷启动隐藏 WebView 探测 YouTube 登录 | `8b8ac34a` | 4 条断言 + tsc 通过 | 需要 |
| P1-3 | WebDAV 路径未编码、412 后远端结果不落地 | `d5286f91` | 7 条断言 + tsc 通过 | 需要 |
| P1-4 | CI 只构建，不跑类型检查和测试 | `5cc92f9a` | YAML 解析通过、本地全量测试通过 | Actions 实跑 |
| P1-5 | 字幕位置/背景/显示开关/翻页是假设置 | `941b7109` | 4 条断言 + tsc 通过 | 需要 |

---

## P1-1 翻译缓存按模型/端点隔离，并回收过期缓存

### 现象

- 换掉 DeepSeek 模型、SiliconFlow 模型，或换掉 OpenAI 兼容端点以后，重新打开旧视频仍然显示旧模型翻译的译文，最长可复用 30 天。
- 字幕、译文、RSS 缓存过期后只返回 `null`，但不删除，AsyncStorage 会一直变大。
- 标题翻译缓存永久保存且没有上限。

### 根因

`translateCueList` 的缓存 key 只有 `videoId + trackKey + targetLang + provider`，没有模型名和端点；`translateTitles` 的 key 也只有 `provider + target + 文本哈希`。切换模型或端点后 key 不变，旧译文继续命中。

`loadCached()` 在 TTL 过期时直接 `return null`，没有删除对应 key。

### 改动

- 新增 `mobile/src/core/translate/cacheKey.ts`：
  - `providerCacheScope()` 把 provider、DeepSeek/SiliconFlow 模型、OpenAI Base URL 和模型拼进缓存作用域。
  - 字幕缓存 key 和标题缓存 key 都改用这个作用域。
- `mobile/src/core/storage.ts`：`loadCached()` 发现过期时调用 `removeKey()` 删除，再返回 `null`。
- `mobile/src/core/translate/index.ts`：标题缓存加上限 3000 条，超出后删最旧的键，内存 Map 同步收缩。

### 验证

```text
node --no-warnings scripts/test-translation-cache-key.mjs
translation-cache-key: 7 assertions passed

npm run typecheck
tsc --noEmit 通过
```

覆盖：同模型复用、换 DeepSeek 模型失效、换 OpenAI 端点失效、换 OpenAI 模型失效、端点末尾斜杠视为同一地址、非 AI 引擎忽略无关模型字段、标题 key 带作用域。

### 真机步骤

1. 选 DeepSeek，打开一个已经翻译过的视频，记下译文。
2. 到设置里把 DeepSeek 模型改成另一个，再打开同一个视频。
3. 预期：重新请求翻译，不再秒出旧模型译文。
4. 换回原模型再打开，预期可以命中旧模型缓存。
5. 长时间使用后可在系统设置里观察 App 存储，不应因字幕缓存无限增长。

### 风险

- 旧格式缓存 key 不会被新代码读取，会作为一次性历史数据留在本地，等系统清理或后续加统一回收。当前修复只保证新写入不会无限增长。
- 模型名大小写、空格会按原样进入 key；如果服务商改名但实际同一模型，会多请求一次。

---

## P1-2 启动期隐藏 WebView 登录探测改为按页面触发

### 现象

冷启动时，即使停在“发现/视频”页，App 也会在屏幕外挂一个 360×640 的 WebView，加载完整的 `m.youtube.com/feed/channels`。国内无代理时可能白等 12 秒，耗流量和内存，还可能在启动阶段触发 Google 风控。

### 根因

`app/_layout.tsx` 在根布局里常驻 `<YoutubeLoginProbe enabled={hydrated} />`。`YoutubeLoginProbe` 只要状态未知或超过 3 小时 TTL，就立即 `setActive(true)`，与当前页面无关。

### 改动

- 新增 `mobile/src/ui/youtube-login-probe-path.ts`：只有路径是 `/me`（或 `/(tabs)/me`）时才允许探测。
- `YoutubeLoginProbe` 用 `usePathname()` 读取当前路由，非“我的”页直接卸载隐藏 WebView。
- “YouTube 账户”页本身已有可见 WebView 检测登录，不需要额外的隐藏探测。

### 验证

```text
node --no-warnings scripts/test-youtube-login-probe-path.mjs
youtube-login-probe-path: 4 assertions passed

npm run typecheck
tsc --noEmit 通过
```

覆盖：视频页/播放器/设置页不挂载，`/me` 挂载，查询字符串和末尾斜杠不影响判断。

### 真机步骤

1. 冷启动 App，默认停在视频页，确认不会出现 12 秒的隐藏网络等待。
2. 切到“我的”页，等待几秒，确认 YouTube 登录状态会从“检测中”变成已登录/未登录。
3. 打开“YouTube 账户”页，确认页面自己的检测仍然正常。

### 风险

- 如果用户把默认 Tab 设成“我的”，冷启动仍会探测，这是预期行为。
- 登录状态在“我的”页之外不再后台刷新；超过 3 小时后需要回“我的”页才会重新检测。

---

## P1-3 WebDAV 路径编码与 412 合并结果落地

### 现象

- WebDAV 文件夹或文件名包含中文、空格、`#`、`?` 时，请求 URL 可能被截断或 404。
- 两台设备同时同步时，412 重试虽然把远端新内容合并后 PUT 了，但本地仍然用第一次的 `merged`，远端新增的订阅不会出现在本机。
- 同步期间用户新加的订阅可能被同步结束时的 `replaceSubscriptionSync` 覆盖。
- 设置同步也有同样的旧快照问题：同步请求期间改的设置可能被启动时的快照覆盖。

### 根因

`WebdavClient.url()` 和 `folderUrl()` 直接拼字符串，没有逐段 `encodeURIComponent`。

`syncNow()` 在开始时把 `subscriptions/settings` 快照存进局部变量；412 重试和最终 `replace*` 都用旧快照，没有重新读取 store。

### 改动

- `mobile/src/core/sync/webdav.ts`：
  - 新增 `encodeWebdavPath()` 和 `buildWebdavUrl()`，文件夹和文件名逐段编码。
  - `WebdavClient` 的 `url()` / `folderUrl()` 统一走这两个函数。
- `mobile/src/core/sync/subscriptions.ts`：把订阅合并纯函数拆出来，便于 Node 测试。
- `mobile/src/core/sync/index.ts`：
  - 412 重试前重新读取最新本地订阅，与重试拿到的远端再次合并；`finalMerged` 使用重试结果。
  - 最终应用本地前，用最新本地状态和 `finalMerged` 再合并一次，保留同步期间的新增/删除。
  - 设置合并也改为在远端 GET 之后重新读取最新 `settings/settingsStamps/settingsUpdatedAt`；设置 412 重试同样读最新状态。

### 验证

```text
node --no-warnings scripts/test-subscription-sync.mjs
subscription-sync: 7 assertions passed

npm run typecheck
tsc --noEmit 通过
```

覆盖：412 期间新增频道保留、期间删除频道保持删除、无变化不重复替换、相同远端不重复上传、中文/空格/`#`/`?` 路径编码、base 末尾斜杠不产生双斜杠、文件夹本身编码。

### 真机步骤

1. 在 WebDAV 设置里把文件夹改成带中文和空格的名字（例如 `Kissly 备份/中文`），保存并同步。
2. 预期：不报 404/400，服务器上出现对应目录和 `subscriptions.json`、`settings.json`。
3. 两台设备都开启同步，A 加一个订阅，B 同时点同步；重复几次，确认两边最终都有这个订阅。
4. 同步时快速在 A 再加一个订阅，等同步完成，确认新订阅没有被“同步完成”覆盖掉。
5. 同步时改一个设置（例如字幕字号），完成后确认没有被远端旧值覆盖。

### 风险

- 如果用户之前手动在文件夹名里写了 `%E4%B8%AD` 这种已编码字符串，会被再次编码成 `%25...`；正常用户输入原始中文/空格不受影响。
- 同步期间的新增订阅会被本地保留，但如果首次 PUT 已经完成，它要等下一次同步才会上传；本轮没有再加一次“同步尾追 PUT”，避免增加网络竞态。

---

## P1-4 CI 增加 typecheck 与单元测试

### 现象

GitHub Actions 只跑 `expo prebuild` 和 Gradle/Xcode 构建，不跑 `tsc` 和现有测试。类型错误或测试回归要等构建阶段才暴露。

### 改动

`.github/workflows/mobile.yml` 的 Android 和 iOS job 在 `npm ci` 之后都增加：

```yaml
- name: Typecheck
  run: npm run typecheck
- name: Run unit tests
  run: |
    set -e
    for test in scripts/test-*.mjs; do
      echo "== $test"
      node --no-warnings "$test"
    done
```

### 验证

- YAML 用 `js-yaml` 解析通过：`jobs: android, ios, release`。
- 本地全量测试通过：settings-sync 12、subscription-sync 7、system-language 5、transcript-scroll 4、translation-cache-key 7、watch-progress 16、youtube-login-probe-path 4。
- `npm run typecheck` 通过。
- 尚未在 GitHub Actions 实跑；需要用户在 Actions 页面手动跑一次 `android`。

### 风险

- 新增测试步骤会让每次构建多花 1～2 分钟；如果某个测试在 CI 环境失败，会直接阻断构建，这是预期的质量门禁。
- `scripts/test-*.mjs` 是通配符，后续新增测试会自动纳入，不需要改 YAML。

---

## P1-5 播放器接通字幕位置/背景/显示开关/翻页

### 现象

设置页里的这些选项只写进 store 并参与设置页预览，播放器不读取：

- “底部/顶部”：横屏字幕永远在底部。
- 背景不透明度：横屏字幕背景永远是 `rgba(16,13,24,0.6)` 或 `rgba(0,0,0,0.28)`。
- “在视频画面上显示字幕”：关掉后横屏仍然显示。
- “显示逐句稿”：关掉后竖屏仍然渲染整列字幕。
- “翻页”：选完后滚动行为与“置顶”完全一样。

### 根因

`player.tsx` 只读取了 `scrollMode`，但没有分支；`position/backgroundOpacity/showOnVideo/transcript` 根本没有被读取。横屏字幕容器 `landSubWrap` 只设置 `bottom`，背景色硬编码。

### 改动

- `player.tsx` 读取 `showOnVideo`、`transcript`、`position`、`backgroundOpacity`。
- 横屏字幕：
  - `showOnVideo=false` 时不渲染字幕层。
  - `position='top'` 时贴顶部，控制栏可见时自动下移避免遮挡；`bottom` 保持原行为。
  - 背景色按 `backgroundOpacity` 生成，0 时透明。
- 竖屏逐句稿：`transcript=false` 时不渲染 `transcript`。
- 翻页模式：
  - 新增 `src/ui/transcriptScroll.ts`。
  - `top` 模式保持“当前句滚到顶部”。
  - `page` 模式只在当前句即将超出视口底部时才整页跳，跳后当前句上方留 24px。
  - 当前句仍在视口内时不动，避免每句都抖一下。

### 验证

```text
node --no-warnings scripts/test-transcript-scroll.mjs
transcript-scroll: 4 assertions passed

npm run typecheck
tsc --noEmit 通过
```

覆盖：当前句可见不跳、到视口底部才跳、布局高度未知不跳、跳转目标留 24px。

### 真机步骤（重点）

1. 横屏播放，设置字幕位置“底部”，确认在底部；改成“顶部”，确认移到顶部，且控制栏出现时不被完全遮挡。
2. 背景不透明度依次选“无 / 30% / 55% / 80%”，横屏字幕背景应逐级变化；“无”时应完全透明。
3. 关闭“在视频画面上显示字幕”，横屏不应再出现字幕层；重新打开应恢复。
4. 关闭“显示逐句稿”，竖屏字幕列表应消失；重新打开应恢复。
5. 字幕滚动选“置顶”，播放时当前句应基本固定在顶部；选“翻页”，当前句在视口内时不应频繁滚动，接近底部时才整页跳。
6. 长按/手动上滑逐句稿，确认“回到当前”按钮仍能恢复跟随。

### 风险

- “在视频画面上显示字幕”按设置页文案只控制横屏叠加层；竖屏仍以逐句稿呈现，不会在竖屏视频上叠加字幕。
- 顶部字幕在控制栏可见时会下移，横屏小屏设备可能压缩字幕空间，需要真机看是否遮挡。
- 翻页模式依赖 `cueOffsets` 和 `transcriptHeight`；首次布局前不会跳，属于预期。

---

## 第二批：稳定性与小功能

| 编号 | 问题 | 提交 | 改动要点 | 验证 |
| --- | --- | --- | --- | --- |
| P1-6 | 任一页面渲染异常会直接白屏/闪退 | `086dfc35` | 根布局加 `ErrorBoundary`，显示错误摘要和“重试” | tsc |
| P1-7 | 句子收藏满 500 条后静默丢最旧一条，仍提示已收藏 | `569810ee` | `toggleSentenceFavorite` 返回 `added/removed/limit`，满额时播放器明确提示 | tsc |
| P1-8 | “翻译视频标题”开关不生效 | `8a6f6a1e` | feed 同时判断 `translateTitles` 和 `titleTranslationMode`，关闭后不再请求标题翻译 | tsc |
| P2-1 | 设置页把微软翻译写成“微语” | `d7e80cfc` | 统一为“微软翻译”，与播放器来源标签一致 | tsc |

## 第三批：弱网与长视频性能

| 编号 | 问题 | 提交 | 改动要点 | 验证 |
| --- | --- | --- | --- | --- |
| P1-9 | 视频元数据 4 个 innerTube client 串行，弱网要等满 4 次超时 | `9abec5c7` | `racePlayerMetadata()` 并行竞速，先成功者胜出；总超时 15s | tsc |
| P1-10 | 字幕 7 种格式串行请求，最坏要等 7 次超时 | `9abec5c7` | 7 种字幕格式并行请求，总超时 8s；仍按原优先级选第一条可用轨道 | tsc |
| P1-11 | 每个播放 tick 线性扫描全部字幕找当前句 | `9e466ba6` | 新增 `cueIndex.ts` 二分查找，1000+ 条字幕从 O(n) 降到 O(log n) | `test-cue-index.mjs` 7 条 |
| P1-12 | 启动只清理字幕/译文/RSS 中的一部分缓存 | `28699bd6` | 新增 `cacheExpiry.ts`，启动时按前缀统一删除过期项，坏 JSON 和旧格式保留 | `test-cache-expiry.mjs` 5 条 |
| P1-13 | 视口外每一行字幕都创建 `Animated.Value` 并跑动画 | `6d7d14f6` | `CueFade` 拆成静态包装层 + `CueFadeAnimated`，只有视口内行挂动画 | tsc |

P1-13 说明：这次只去掉离屏行的动画开销，`Text` 本身仍全部挂载；真正的窗口化（只渲染视口附近若干行）尚未做。

## 第四批：导出时间与历史上限说明

| 编号 | 问题 | 提交 | 改动要点 | 验证 |
| --- | --- | --- | --- | --- |
| P2-2 | 历史 CSV 只有 `savedAt`，会把“很久以前第一次打开”误当成最近观看 | `1e3df4c5` | 增加 `lastWatchedAt` 列，导出 `item.lastWatchedAt ?? item.savedAt` | tsc |
| P2-3 | 历史超过 120 条后旧记录静默消失 | `25e0517a` | 抽出 `HISTORY_LIMIT`，历史页到达上限时明确显示“更早的记录会自动清理” | tsc |

## 全量回归

```text
watch-progress 16
settings-sync 12
system-language 5
translation-cache-key 7
youtube-login-probe-path 4
subscription-sync 7
transcript-scroll 4
cache-expiry 5
cue-index 7
合计 67 条断言通过
npm run typecheck 通过
```

## 仍未处理

- **P0-7 发布签名**：Android release 仍使用 debug keystore，CI 每次签名可能不同，覆盖安装可能失败。需要用户决定固定 release keystore + GitHub Secrets，或接受升级必须卸载。按用户要求，未自动构建/发布 Release。
- **长视频真正的窗口化**：当前只做了当前句二分查找、离屏行动画静态化、请求并行和缓存清理；1000～2000 条字幕的 `Text` 仍全部挂载，逐帧 `setCurrent` 仍会让整个播放器组件重渲染。要进一步优化需要把字幕列表拆成独立 memo 组件并按视口窗口渲染，属于结构性改动，建议单独一轮做并配真机性能对比。
- **iOS 系统翻译的未知语言回退**：JS 层已不再传 `auto`，但 `SystemTranslateModule.swift` 的 `normalizeLanguage` 仍会把空值/`auto` 回退成英语；未知语言在 iOS 上仍可能落到英语。Windows 环境无法编译 iOS，暂不改。
- **历史保留条数**：已达到上限时会明确提示“更早的记录会自动清理”，但仍然是 120 条产品上限；如需保留更多历史，需要同时评估 AsyncStorage 体积和历史页加载性能。
- **死代码/半成品**：`fetchTranslatedCaptionCues`、`clearChannelVideoCache`、`updateSubscription`、`setSubscriptions`、`PlayerPayload`、`originalTiming`、播客 Tab 的音频模式、订阅分组 UI、语速/音调仅试听生效、`interfaceLang` 仅展示。这些不是当前可复现 bug，未在本轮删除或补全。
- **CI 只构建 arm64-v8a**，不覆盖 32 位设备；本地 `mobile/android` 是旧生成物，versionCode/versionName 低于 `app.json`，直接本地打包会版本降级。
- **GitHub Actions 尚未实际运行**：`fix/p0-batch` 的 push 不会自动触发工作流，需要到 Actions 页面手动选分支、选 `android` 运行一次。

## 本轮提交

```text
595b709e fix(cache): scope translations by model and prune expired entries
8b8ac34a fix(auth): only probe YouTube login on the me tab
d5286f91 fix(sync): encode WebDAV paths and apply 412 merge results
5cc92f9a ci: run typecheck and unit tests before building
941b7109 fix(player): honor subtitle position, background and transcript settings
086dfc35 fix(app): add a root error boundary with retry
569810ee fix(favorites): stop silently evicting the oldest saved sentence
8a6f6a1e fix(feed): wire the title translation switch to the feed
d7e80cfc fix(copy): label Microsoft translation correctly
9abec5c7 perf(youtube): race player clients and caption formats in parallel
9e466ba6 perf(player): binary search the active subtitle cue
28699bd6 fix(cache): prune expired caption and feed caches on startup
6d7d14f6 perf(player): keep off-screen subtitle rows static
1e3df4c5 fix(export): include the last watched time in history csv
```
