# 订阅流与频道页加载说明

对应需求：`docs/feed-loading-spec.md`。本文件记录实现取舍、缓存键与验证方式。

## 1. 首页 "全部"

- 首屏先读 `feed:home-pool`，立即展示 `items` 的前 12 条，不等任何网络请求。
- 缓存 30 分钟内视为新鲜（`FEED_FRESH_TTL`），直接秒开；超过 30 分钟才在后台按 8 并发刷新，旧内容继续可见。
- `fetchHomeFeed` 每完成 8 个频道就回调一次 `onBatch`；调用方合并后立即按 `published` 倒序去重并截断到 2000 条。
- 每个频道优先走 innertube 第一页，只取前 20 条；失败才回退 RSS（RSS 约 15 条，不补第二次请求）。
- 每次单请求预算 20 秒（与频道页一致）；8 秒在 YouTube 首包较慢时会提前回退 RSS，导致首页只有约 12 条且没有 `continuation`。单频道失败不阻塞其他频道，也不额外重试。
- `loadMore` 先每次展开 10 条本地池；池耗尽后最多挑 8 个仍有 `continuation` 的频道并发续拉，并优先选择尚未加载首屏或最久未拉取的频道，避免首页永远只更新前几个频道。
- 首页 `hasMore` 先看 `visible < pool.length`，再看 2000 条池上限：缓存池已满时仍然可以继续展开未展示的条目，避免重启后只显示 12/102 条就停在“已加载全部”。
- 下拉刷新 `force = true`：重新拉全部频道。部分频道失败时保留这些频道的旧内容，成功频道用新数据替换，避免一次弱网刷新把整页清空。

### 缓存结构

`feed:home-pool`：

```ts
{
  at: number;          // 最近一次池写入时间，也是 30 分钟新鲜度基准
  updatedAt: number;   // 最近一次有效刷新时间，UI 展示用
  items: VideoItem[];  // 最多 2000 条
  cursors?: Record<string, { continuation?: string; exhausted: boolean; firstPageLoaded: boolean }>;
}
```

`cursors` 是额外字段，用于重启后继续从第 31 条续拉，避免再把首页已经展示过的第 21–30 条重复带入。基础结构仍是 `{ at, updatedAt, items }`。

## 2. 频道页与首页频道筛选

两处共用 `useChannelFeed(channelId, { channelTitle, channelAvatar, enabled })`。

- 进入时先读 5 分钟内存页缓存，再读 7 天持久化缓存 `channel:first:{channelId}`。
- 有缓存立即展示首屏 20 条，并在后台 `force = true` 刷新；没有缓存才显示 `ActivityIndicator`，不会先清空列表造成闪空。
- 首屏 innertube 一页约 30 条全部进入缓冲队列，展示前 20 条，剩余 10 条留给下一次上滑。
- 每次上滑从缓冲队列取 20 条；不足 20 且还有 `continuation` 时先补一页再取。最后一批允许不足 20。
- 首屏后静默预取下一页，结果放 `prefetchedRef`；预取可能只返回少量新视频，首次上滑时若仍不足 20 条，会再用 `continuation` 补一页；预取失败不报错，滑到底会用同一个 token 重试。
- 首次无缓存时 RSS 与 innertube 并行：RSS 先到先展示，innertube 到后用 `videoId` 合并并补全 `duration` 等字段；两者都失败才显示错误。
- 已加载多页时，后台刷新按 `videoId` 合并，新数据在前，旧数据保留，不清掉用户已经滑出来的内容。
- 频道页只保留手动上滑，不设 600 条上限，可以一直加载到 `continuation` 为空；“加载全部”按钮因与上滑重复已移除。
- 频道页统计改为“发布视频 / 订阅者 / 最近更新”：发布视频和订阅者优先读频道 header 的 `metadataRows`，读不到时回退订阅记录里的原始计数文本；旧缓存没有频道信息时后台刷新补齐。
- 播放列表 tab 直接渲染频道播放列表（标题、缩略图、数量），点击打开原有播放列表详情；支持上滑续页和详情内视频续页。数量优先读 metadata，读不到时读缩略图角标（如 `11 videos`）。

## 3. 缓存键与清理

| 键 | 内容 | TTL |
| --- | --- | --- |
| `feed:{channelId}` | 单频道 RSS 列表 | 10 分钟 |
| `channel:first:{channelId}` | 频道页 innertube 首页（含 continuation） | 7 天 |
| `feed:home-pool` | 首页聚合池快照 | 7 天，30 分钟后后台刷新 |

启动清理：

- `feed:` 统一改为 7 天，但排除 `feed:home-pool`。
- `feed:home-pool` 单独按 7 天清理；7 天内不会因启动被删。
- `channel:first:` 按 7 天清理。
- 全局缓存清理 `GLOBAL_CACHE_PREFIXES` 已加入 `channel:first:`。

## 4. 已知取舍

1. RSS 最多约 15 条，首页兜底时该频道不足 20 条，属预期。
2. innertube 第一页 30 条，首页只取 20 条并保留第 31 条开始的 `continuation`；因此第 21–30 条不会出现在首页 "加载更多" 中。缓存额外保存 `cursors`，重启后也保持该语义。
3. 2000 条池只保存轻量 `VideoItem`，不预载缩略图；FlatList 仍然虚拟化渲染。
4. 首屏缓存超过 30 分钟会后台刷新；刷新失败保留旧数据，不阻塞列表。
5. 标题翻译仍只处理当前可见条目，最多 80 个标题，不会翻译整池。
6. "加载全部"按钮已移除：上滑本身会持续续拉，按钮是重复入口；频道页不做网络类型判断，也不设 600 条上限。
7. 首页续拉改为最多并发 8 个频道，并优先选择最久未拉取的频道；失败后保留 `hasMore`，下一次上滑继续重试，避免第一次失败就永久停住。
8. 续页 token 选择已修正：YouTube 首包同时包含视频网格、顶部筛选 chip 和简介面板的 continuation，旧实现取最后一个会拿到简介面板的 token，导致频道只加载 30 条；现在按路径优先选 `richGridRenderer.contents` / `playlistVideoListRenderer.contents`，并兼容新的 `continuationItemViewModel` 结构。
9. 首页池新鲜期内不重复发起 100 个 browse 请求；新增 1 个订阅时只补拉该频道（缓存/当前池能识别已覆盖频道）。
10. RSS 兜底时 cursor 不标记 exhausted：首页即使暂时只有约 12 条，底部仍显示可上滑，下一次上滑会再试 innertube 而不是永久停在 12 条。

## 5. 验证

```bash
cd mobile
npx tsc --noEmit
node scripts/test-home-feed.mjs
node scripts/test-channel-continuation.mjs
node scripts/test-channel-metadata.mjs
node scripts/test-settings-sync.mjs
node scripts/test-collection-sync.mjs
node scripts/test-progress-sync.mjs
node scripts/test-subscription-sync.mjs
node scripts/test-webdav-folder.mjs
node scripts/test-cache-keys.mjs
node scripts/test-feed-policy.mjs
```

`test-home-feed.mjs` 覆盖聚合池 2000 上限、按发布时间倒序、每频道 20 条分批、缓冲队列第 21–30 条不丢失、刷新合并保留已加载内容。`test-channel-continuation.mjs` 覆盖视频网格 token 优先于顶部 chip / 简介面板 token，以及新旧两种 continuation 结构。`test-channel-metadata.mjs` 覆盖频道订阅者数、发布视频数的 M/K/万 解析。`test-feed-policy.mjs` 覆盖 RSS 不标记 exhausted，以及缓存池满 2000 条时仍未展示项仍可继续上滑。
