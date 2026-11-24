# 需求：首页订阅流与频道页视频加载改造（Kissly 手机端）

> 交付对象：实现型 AI / 审查者。本文件既是最初需求，也是现状核对清单。
> 当前状态：核心改造、续页 token 修复与 5.7 的 “加载全部” 按钮均已实现并推送到 `dev`；最新提交以分支记录为准。
> 涉及工程：
> `C:\Users\KNNY\Desktop\Code\kiss-translator\mobile`
> 技术栈：Expo SDK 58 / React Native 0.88 / TypeScript
> 分支：
> `dev`
> （完成后推送到
> `origin/dev`
> ，不构建 APP、不发 Release）



***

## 0. 术语约定（避免方向歧义）



* **上滑**：手指从屏幕下方往上方滑动，列表内容随之向上滚动，用于查看更靠后的视频。本文所有 "加载更多" 都指这个动作。

* **上滑到列表底部**：列表滚到末端，对应 FlatList 的 `onEndReached`。

* **下拉**：手指从屏幕上方往下拉，用于触发刷新（`RefreshControl`）。

* 本文不使用 "下滑" 一词，避免和 "下拉刷新" 混淆。



***

## 1. 背景与现状

> 本节行号对应改造前提交
> `8c3baa5b`
> ；改造后的文件与函数位置见第 10 节。

### 1.1 首页订阅流



* 入口：`mobile/app/(tabs)/index.tsx:99` → `useFeed()`（`mobile/src/hooks/useFeed.ts:63`）

* 数据：无频道筛选时调用 `fetchSubscriptionFeed(selected, force)`（`useFeed.ts:191`）

* 实现：`mobile/src/core/youtube/rss.ts:130`，`mapLimit(subscriptions, 4, ...)` 串行分批拉每个频道的 RSS

* RSS 缓存：内存 `memory` + `AsyncStorage feed:{channelId}`，TTL 均 `FEED_TTL = 10 * 60 * 1000`（`rss.ts:16`）

* 启动清理：`mobile/app/_layout.tsx:33` 的 `pruneExpiredCaches` 按 `feed:` 前缀 + 10 分钟 TTL 删除，冷启动超过 10 分钟即全量重拉

* 首屏：只显示 `HOME_PAGE_SIZE = 12` 条（`useFeed.ts:10`），但必须等 `fetchSubscriptionFeed` 全部频道批次跑完才 `setPool`

* 单请求超时 15 秒（`rss.ts:118`），无整体预算，最慢频道决定整体完成时间

* 标题翻译：`translateVisibleTitles` 对可见条目最多 80 个标题调用 `translateTitles`（`useFeed.ts:110-143`），属后台异步，不阻塞首屏

**现状问题**：订阅 100+ 时，100 个请求 / 4 并发 = 25 轮，进入 App 需 3–5 秒；冷启动无本地首屏兜底。

### 1.2 频道页



* 页面：`mobile/app/channel.tsx`

* 首屏：`channel.tsx:89-129`，先 `setItems([])`、`setLoading(true)`，再 `fetchChannelVideosPage(channelId, { force: true })`

* `force: true` 绕过 `pageCache`（TTL 5 分钟，`channelVideos.ts:24`），失败后串行 fallback `fetchChannelFeed(channelId, true)`（再 15 秒）

* 分页：`PAGE = 10`（`channel.tsx:32`）；`loadMore`（`channel.tsx:131`）在 `visible < items.length` 时只增加 `visible`、不发请求；本地 30 条全部展示后，才用 `continuation` 拉下一页

* `fetchChannelVideosPage`（`channelVideos.ts:255`）走 YouTube innertube `browse` POST，超时 20 秒，一页约 30 条

* `continuation` token 来自 `node.continuationItemRenderer.continuationEndpoint.continuationCommand.token`（`channelVideos.ts:160-163`）

**现状问题**：点进频道页要等网络，列表先被清空，感知为 "卡在原界面"；上滑到列表底部时，前两次只是把本地 30 条从 10 条展开到 20、30 条，第三次才发网络请求，感知为 "只有 30 条"。



***

## 2. 本次改造目标



| 编号 | 目标                                           | 验收方式                              |
| -- | -------------------------------------------- | --------------------------------- |
| G1 | 每频道取 **20 条** 作为基准数据量                        | 代码常量为 20，且行为可测                    |
| G2 | 首页 "全部" 聚合池上限 **2000 条**，滚动逐步展示              | 池长度不超过 2000；未达上限时上滑到列表底部可继续展开     |
| G3 | 点开订阅头像（首页筛选态）或进入频道详情页，**可灵活滑动加载该博主全部视频**，不丢条 | 连续上滑可持续获得新视频，直到 `continuation` 为空 |
| G4 | 订阅 100 人时，冷启动进入 App **≤ 1 秒看到内容**（有本地池缓存时）   | 有缓存 ≤ 1 秒；无缓存首批 8 个频道完成 ≤ 2 秒     |
| G5 | 频道页点进去 **≤ 1 秒出列表**（缓存命中时 < 300ms）           | 秒表 / 日志时间戳                        |



***

## 3. 数据量规格（核心调整）

### 3.1 常量定义

在 `mobile/src/core/youtube/constants.ts`（新建）或就近文件定义并导出：



```
export const CHANNEL_BATCH_SIZE = 20;        // 每频道 / 每批展示条数
export const HOME_POOL_LIMIT = 2000;         // 首页"全部"聚合池上限
export const HOME_FIRST_BATCH = 8;           // 首屏优先拉取的频道数
export const HOME_CONCURRENCY = 8;           // 首页并发请求数
export const HOME_REQUEST_TIMEOUT_MS = 20000; // 单请求超时
export const FEED_FRESH_TTL = 30 * 60 * 1000;      // 30 分钟：超过则后台刷新
export const FEED_STORE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天：本地保留上限
export const HOME_POOL_CACHE_KEY = 'feed:home-pool';
```

### 3.2 数量换算（明确约定）



* 每频道取 20 条 → 100 个订阅的候选数据最多 2000 条

* 合并去重、按 `published` 倒序后，**首页池保留最多 2000 条**（`HOME_POOL_LIMIT`）

* 首页首屏只渲染 12 条（沿用 `HOME_PAGE_SIZE`），滚动每次 +10 条，从池中展开

* 如果后续需要调整上限，只改 `HOME_POOL_LIMIT`，其余逻辑不变

> 注意：
> `HOME_POOL_LIMIT`
> 是 "内存池上限"，不是 "一次性渲染 2000 条"。FlatList 仍按需渲染。

### 3.3 数据源约束（必须处理）

YouTube RSS（`youtube.com/feeds/videos.xml`）**最多只返回约 15 条**，无法通过参数改成 20。

因此首页要满足 "每频道 20 条"，必须改用 innertube：



* 主路径：`fetchChannelVideosPage(channelId, { channelTitle, channelAvatar })`，返回一页约 30 条 → 客户端取前 20 条

* 兜底：innertube 失败时回退 `fetchChannelFeed(channelId, force, HOME_REQUEST_TIMEOUT_MS)`，取前 20 条（实际只有 15 条，允许不足 20）；RSS 兜底后的 cursor 不标记 exhausted，下一次上滑会再试 innertube，避免首页永久停在约 12 条

* 不允许为了凑 20 条而发两次请求



***

## 4. 首页改造（`useFeed.ts` + `rss.ts` / 新增 `homeFeed.ts`）

### 4.1 首屏缓存秒开（P0）



1. `useFeed.load()` 开始时，先从 `AsyncStorage` 读取 `HOME_POOL_CACHE_KEY` 的池快照（结构：`{ at: number, updatedAt: number, items: VideoItem[], cursors?: Record<string, HomeCursorSnapshot> }`）

2. 读到后立刻 `setPoolSafe(cached.items.slice(0, HOME_POOL_LIMIT))`，并 `setVisibleCount(Math.min(HOME_PAGE_SIZE, cached.items.length))`（若本次会话已展开更多，保留当前 `visibleCount`）

3. 同时设置 `updatedAt = cached.at`，UI 可显示 "更新于 X 分钟前"

4. 然后照常发起后台刷新；刷新完成后用新池替换并写回缓存

5. 缓存读取失败 / 为空时保持现有 loading 行为

要求：缓存读写包 try/catch，任何缓存异常不得阻塞首屏。

### 4.2 流式合并，首屏不等全部频道

新增 `fetchHomeFeed`（已实现；`fetchSubscriptionFeed` 保留给旧调用）：



```
fetchHomeFeed(subscriptions, {
  force,
  onBatch: (batch: {
    items: VideoItem[];
    pages: HomeChannelPage[];
    done: number;
    total: number;
  }) => void
}): Promise<{ items: VideoItem[]; pages: HomeChannelPage[] }>
```



* 内部仍按 `HOME_CONCURRENCY = 8` 分批

* 首批 `HOME_FIRST_BATCH = 8` 个频道全部完成后，立即调用一次 `onBatch`；剩余频道每完成 8 个再调用一次

* `useFeed` 在 `onBatch` 里执行 `mergeHomePool(poolRef.current, batch.items, HOME_POOL_LIMIT)`，并 `setPoolSafe`

* 首批到达即完成首屏渲染，剩余频道继续后台补齐

* 最终 `Promise` 返回完整池（仍受 `HOME_POOL_LIMIT` 截断）

### 4.3 每频道取 20 条

在首页的取数函数里：



```
const page = await fetchChannelVideosPage(sub.channelId, {
  channelTitle: sub.title,
  channelAvatar: sub.avatar,
  force,
  timeoutMs: HOME_REQUEST_TIMEOUT_MS,
});
return page.items.slice(0, CHANNEL_BATCH_SIZE);
```

失败回退：



```
const feed = await fetchChannelFeed(sub.channelId, force, HOME_REQUEST_TIMEOUT_MS);
return feed.slice(0, CHANNEL_BATCH_SIZE);
```

### 4.4 请求预算



* 单请求超时统一 `HOME_REQUEST_TIMEOUT_MS = 20000`（首页路径与频道页一致；8 秒在 YouTube 慢速首包时会提前回退 RSS，导致首页只有约 12 条且没有 continuation）

* 并发 `HOME_CONCURRENCY = 8`

* 单个频道失败返回空数组，不重试、不阻塞其他频道

* 首页整体不设硬超时；靠 "首批 8 个频道" 保证首屏

### 4.5 池截断与排序



* 合并规则：按 `videoId` 去重，按 `published` 倒序

* 每次合并后立即 `slice(0, HOME_POOL_LIMIT)`

* `loadMore` 仍先消费本地池（每次 +10，`NEXT_PAGE_SIZE = 10` 是首页滚动步长，与每频道 20 条不冲突），池耗尽后再向各频道续拉（沿用现有 `ChannelCursor` 逻辑，最多 3 个频道 / 轮）

* 续拉时每频道仍取 20 条

### 4.6 下拉刷新

`refresh()` 保持 `force = true`：跳过所有缓存、重新拉取全部频道；完成后用新数据替换已刷新的频道，未返回的频道保留旧数据，并写回缓存。

### 4.7 标题翻译

保持现状：只翻译当前可见的前 N 条（`translateVisibleTitles`），不随池大小增加。池扩到 2000 条时，禁止对整池做翻译。

### 4.8 首页头像筛选态与频道页必须统一

改造前是两个不同入口、两套不同逻辑，现已收敛成一套（`useChannelFeed`，已实现）：



| 入口      | 现有行为                                                                        | 代码位置                                                                             |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 首页点订阅头像 | **不跳页**，`setChannelFilter(sub.channelId)` 在首页内过滤，走 `useFeed(channelFilter)` | `app/(tabs)/index.tsx:236`（改造前 `useFeed.ts:171-189`）                             |
| 频道详情    | `router.push('/channel')` 跳到独立页面，走 `channel.tsx`                            | `app/subscriptions.tsx:915`、`app/add-subscription.tsx:561`、`app/player.tsx:4787` |

要求：



1. 共享 hook `mobile/src/hooks/useChannelFeed.ts`（已实现），入参 `(channelId, { channelTitle, channelAvatar, enabled })`，内部实现第 5.2 / 5.3 节的「20 条 / 批 + 缓冲队列 + 预取下一页」，并返回 `{ items, loading, loadingMore, hasMore, loadMore, refresh }`

2. `channel.tsx` 改为调用该 hook，不再自己维护 `items/visible/continuation`

3. `useFeed` 的 `channelFilter` 分支也改为调用该 hook，删除现在 "只拉第一页 30 条 + 每次展开 10 条" 的逻辑

4. 两个入口都必须能连续上滑，直到 `continuation` 为空；条数一致、顺序一致、不丢第 21–30 条

5. 两处只有 UI 不同：首页是内嵌列表，频道页有页头、统计和标签

验收：同一个博主，从首页头像进入和从订阅列表进入 `/channel`，加载条数、已加载全部时的总条数、每批 20 条的节奏必须一致。



***

## 5. 频道页改造（`channel.tsx` + `channelVideos.ts`）

### 5.1 先缓存后刷新（P0，已实现）

取数顺序：



1. 先查内存 `pageCache`（`peekChannelVideoPage`，5 分钟），命中立即展示

2. 未命中再查持久化缓存 `channel:first:{channelId}`（TTL 用 `FEED_STORE_TTL`，AsyncStorage 结构 `{ at, value: { items, continuation } }`）

3. 任一命中 → 立即展示并结束 loading；后台 `force = true` 再拉第一页，成功后按 5.4 合并（保留已加载的更多页）

4. 两者都没有 → 按 5.5 并行发起 RSS 与 innertube 第一页，谁先返回先展示；等待期间显示骨架屏 / 占位行，不要先 `setItems([])` 造成 "闪空"

禁止：进入页面无条件 `force: true` + `setItems([])`。

### 5.2 每批 20 条 + 缓冲队列（关键，防止丢视频）

innertube 一页约 30 条，`continuation` 指向第 31 条。若直接 `slice(0, 20)` 丢弃后 10 条，则第 21–30 条永久丢失。

必须用缓冲队列：



```
bufferRef: VideoItem[]        // 已请求到、尚未展示
continuationRef: string | undefined
```

展示逻辑：



1. 首屏请求第一页（30 条）→ 全部进 `bufferRef` → 从 buffer 取 `CHANNEL_BATCH_SIZE = 20` 展示

2. 上滑到列表底部（`onEndReached`）：

* 若 `bufferRef.length >= 20` → 直接从 buffer 再取 20 展示

* 若 `bufferRef.length < 20` 且 `continuation` 存在 → 先并入已预取的页（`prefetchedRef`），不足 20 再用 `continuation` 拉下一页（30 条）append 进 buffer，最后取 20 展示

* 若 buffer 空、无 `continuation`、且无预取页 / 在途预取 → 显示 "已加载全部 N 条"

1. 每次从 buffer 取出后，UI 的 `items` 追加这批，`visible` 同步增加

这样第 21–30 条会在第二批自然出现，不丢失。

### 5.3 预取下一页（体验核心）



* 首屏展示完成后，**后台静默**用当前 `continuation` 预取下一页，结果存入 `prefetchedRef`（含 `items` 与新的 `continuation`）

* 用户上滑到列表底部时若 `prefetchedRef` 有数据，先并入 `bufferRef` 再取 20 条展示，**同时**再预取下一页

* 预取请求失败静默忽略，上滑到列表底部时重试

* 预取一次只允许 1 页在途，用 `prefetchingRef` 防重入

### 5.4 刷新与已加载数据的合并

后台 `force` 刷新返回第一页时：



* 若用户尚未加载更多页（`items` 仍是首屏那批）→ 直接替换

* 若用户已加载多页 → 用 `videoId` 合并：新数据在前，旧数据去重保留，避免刷新把用户已滑出来的内容清掉

### 5.5 RSS 兜底并行

现有逻辑是 "innertube 20 秒超时失败 → 才走 RSS 15 秒"，最坏 35 秒。改为：



* 先发起 `fetchChannelFeed(channelId, false)`（RSS，快且稳定），拿到就先展示

* 同时发起 innertube 第一页，成功后替换 / 补全（RSS 无 `duration`，innertube 有）

* 两者都失败才显示错误

### 5.6 快捷入口

频道页头部 "播放最新" 按钮逻辑不变。

### 5.7 频道页“加载全部”按钮（已实现）

频道页底部 "上滑自动加载更多" 旁提供 "加载全部" 按钮，串行拉取后续所有 `continuation`：



* 加载中显示 "已加载 N 条，正在加载…"

* Wi-Fi 与蜂窝网络都可以使用，不做网络类型判断；不设 600 条 / 20 页上限

* 连续两批没有新增才停止，防止异常 token 造成死循环

状态：已实现。手动上滑与按钮都不受 600 条限制，一直加载到 `continuation` 为空。



***

## 6. 缓存与清理策略

### 6.1 两层 TTL



| 用途         | 常量                       | 行为                     |
| ---------- | ------------------------ | ---------------------- |
| 判断是否需要后台刷新 | `FEED_FRESH_TTL = 30 分钟` | 超过则发起网络刷新，但**不删除**本地数据 |
| 本地持久化保留    | `FEED_STORE_TTL = 7 天`   | 超过才允许清理                |

### 6.2 启动清理

修改 `mobile/app/_layout.tsx` 的 `pruneExpiredCaches`：



* `feed:` 前缀的 TTL 从 10 分钟改为 `FEED_STORE_TTL`（7 天）

* 该规则必须设置 `excludePrefixes: [HOME_POOL_CACHE_KEY]`，否则 `feed:home-pool` 会被前缀规则命中

* 为 `HOME_POOL_CACHE_KEY` 单独加一条规则，TTL 也用 `FEED_STORE_TTL`

* 新增 `channel:first:` 前缀，同样 7 天

### 6.3 缓存键



* `feed:{channelId}`：单频道 RSS 缓存（沿用）

* `channel:first:{channelId}`：频道页 innertube 首页缓存（新增）

* `feed:home-pool`：首页聚合池快照（新增，结构 `{ at, updatedAt, items, cursors? }`；启动清理必须用 `excludePrefixes` 排除，否则会被 `feed:` 规则命中）

写入 `feed:home-pool` 的时机：首批合并完成、每轮 `onBatch` 后、`loadMore` 后、`refresh` 完成后。用 300ms 防抖，避免高频写。



***

## 7. 明确不做（不要碰）



1. 不改 WebDAV 同步任何逻辑（`src/core/sync/*`、`src/core/settingsSync.ts`、`store.ts` 的墓碑与 replace 方法）

2. 不改播放器（`app/player.tsx`）

3. 不改设置页与关于页

4. 不改订阅增删的 UI 与存储逻辑、不改导入导出；允许调整 `useFeed` 的增量拉取策略（见 9.3）

5. 不引入新的第三方依赖；缓存与并发沿用现有 `AsyncStorage`、`mapLimit`、`httpJson`

6. 不改主题、UI 组件、图标

7. 不改标题翻译的 provider / 模型选择 / 语言逻辑

8. 不构建 APP、不发 Release、不打 tag



***

## 8. 已知取舍与风险（实现时保留注释说明）



1. **RSS 只有 15 条**：首页 20 条必须走 innertube；innertube 失败时该频道最多 15 条，且 RSS 没有 `continuation`，该频道在首页 "加载更多" 中会被视为已到底，属预期

2. **innertube 一页 30 条**：频道页用缓冲队列规避丢条；首页每频道只取前 20 条，`continuation` 从第 31 条开始，第 21–30 条在首页 "加载更多" 路径中不出现（首页语义是最新内容，可接受，需注释）

3. **100 个 browse POST 的限流风险**：靠 `HOME_CONCURRENCY = 8`、20 秒超时、30 分钟新鲜度、首屏只拉 8 个频道来降低频率；不做额外重试

4. **2000 条内存池**：只存 `VideoItem` 轻量字段，不预加载缩略图；FlatList 虚拟化渲染

5. **首屏缓存可能过期**：首页用 `updatedAt` 显示 "X 前更新"；刷新失败时保留旧数据，当前没有显式的 "刷新失败" 提示，属已知取舍

6. **"全部视频" 的范围**：频道页只覆盖 YouTube 的 `videos` 标签页（长视频），Shorts 在独立标签页，不在本需求范围；`continuation` 为空时即视为该标签页已到底

7. **频道页无人工条数上限**：手动上滑和 "加载全部" 按钮都可一直加载到 `continuation` 为空，不做 600 条截断



***

## 9. 验收标准

### 9.1 功能



* [ ] 首页 "全部" 聚合池 ≤ 2000 条；每频道贡献 ≤ 20 条

* [ ] 订阅 3 人时，首页池 = 3 × min (20, 实际条数)

* [ ] 订阅 100 人时，首页池在后台补齐后达到 2000 条（或全部频道实际条数总和，取小）

* [ ] 频道页连续上滑可持续加载，无跳条、无重复；直到 `continuation` 为空显示 "已加载全部 N 条"

* [ ] 频道页每批展示 20 条（最后一批可不足 20）

* [ ] 频道页第 20–30 条（被缓冲的那批）在第一次上滑（第二批展示）时出现，不丢失

### 9.2 性能



* [ ] 冷启动（缓存存在且 < 7 天）：首屏内容在 1 秒内出现

* [ ] 冷启动（无缓存，100 订阅）：首批 8 个频道完成后首屏出现，目标 ≤ 2 秒

* [ ] 频道页二次进入（5 分钟内）：< 300ms 出列表

* [ ] 频道页首次进入：RSS 与 innertube 并行，RSS 先返回则先展示，目标 ≤ 1.5 秒

### 9.3 回归



* [ ] 下拉刷新能拿到全新内容，且不被旧缓存覆盖

* [ ] 新增 / 删除订阅后，首页 `subsKey` 变化能正确重载；新增 1 个订阅不应导致全部 100 个频道重拉（只补拉新增频道）

* [ ] 频道筛选态（`useFeed(channelId)`）与 `/channel` 页行为一致：每批 20 条、可连续上滑到 `continuation` 为空

* [ ] 同一博主从首页头像进入与从订阅列表进入，已加载全部时的总条数一致

* [ ] `npx tsc --noEmit` 通过（在 `mobile/` 下执行）

* [ ] 现有测试全绿：`node scripts/test-settings-sync.mjs`、`test-collection-sync.mjs`、`test-progress-sync.mjs`、`test-subscription-sync.mjs`、`test-webdav-folder.mjs`、`test-cache-keys.mjs`、`test-home-feed.mjs`、`test-channel-continuation.mjs`



***

## 10. 改动文件清单

状态说明：以下文件已在提交 `ad7b0b6b` 中实现，本清单用于核对现状与回归；如需继续改动，先确认现有实现，不要重复新建或覆盖。



| 文件                                          | 改动                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `mobile/src/hooks/useFeed.ts`               | 首屏缓存读取、`onBatch` 流式合并、池截断、`loadMore` 续拉 20 条；`channelFilter` 分支改用共享 hook                                              |
| `mobile/src/hooks/useChannelFeed.ts`（已实现）   | 单频道浏览共享 hook：20 条 / 批 + 缓冲队列 + 预取下一页，供首页筛选态与频道页共用                                                                     |
| `mobile/src/core/youtube/homeFeed.ts`（已实现）  | `fetchHomeFeed`（并发 8、每批回调、池截断）、`loadHomePoolCache` / `saveHomePoolCache`                                              |
| `mobile/src/core/feedBatches.ts`（已实现）       | `uniqueVideoItems` / `mergeHomePool` / `mergeChannelItems` / `takeChannelBatch` 纯函数                                   |
| `mobile/src/core/youtube/rss.ts`            | `fetchChannelFeed` 增加可选 `timeoutMs` 参数；`fetchSubscriptionFeed` 保留给旧调用                                                 |
| `mobile/src/core/youtube/channelVideos.ts`  | `fetchChannelVideosPage` 增加可选 `timeoutMs`；新增 `peekChannelVideoPage` / `loadChannelFirstPage` / `saveChannelFirstPage`；续页 token 改为按主内容路径选择 |
| `mobile/src/core/youtube/continuation.ts`（已实现） | 兼容 `continuationItemRenderer` 与 `continuationItemViewModel`，并排除顶部 chip / 简介面板 token |
| `mobile/app/channel.tsx`                    | 先缓存后刷新、改用 `useChannelFeed`、RSS 并行兜底（“加载全部”按钮已实现）                                                                     |
| `mobile/app/_layout.tsx`                    | `pruneExpiredCaches` 的 TTL、`excludePrefixes` 与新增前缀                                                                    |
| `mobile/src/core/youtube/constants.ts`（已实现） | 第 3.1 节所有常量                                                                                                           |
| `mobile/scripts/test-home-feed.mjs`（已实现）    | 常量、聚合池上限、每频道 20 条、缓冲队列不丢条的断言                                                                                          |
| `mobile/scripts/test-channel-continuation.mjs`（已实现） | 视频网格 token 优先级、新旧 continuation 结构断言                                                                                     |
| `mobile/docs/feed-loading-notes.md`（已实现）    | 记录第 8 节取舍与缓存键说明                                                                                                       |



***

## 11. 实现顺序建议



1. 常量文件 + 首页每频道 20 条 + `HOME_POOL_LIMIT` 截断（可独立验证）

2. 首屏缓存（`feed:home-pool`）+ 启动清理 TTL 调整

3. `fetchHomeFeed` 流式 `onBatch` + 并发 8 + 20 秒超时

4. 新建 `useChannelFeed`：20 条 / 批 + 缓冲队列 + 预取下一页

5. `channel.tsx` 接入 `useChannelFeed` + 先缓存后刷新

6. `useFeed` 的 `channelFilter` 分支接入 `useChannelFeed`

7. 频道页 RSS 并行兜底

8. “加载全部”按钮（已实现，任意网络、无 600 条上限）

9. 测试脚本 + `tsc --noEmit` + 推送 `dev`

当前进度：1–7、9 已完成并提交（`ad7b0b6b`、`dc9fff4b`）；第 8 步未做。

每步完成后可独立运行验证，不要一次性全改完再测。
