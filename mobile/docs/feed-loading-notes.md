# 订阅流与频道页加载说明

对应需求：`docs/feed-loading-spec.md`。本文件记录实现取舍、缓存键与验证方式。

## 1. 首页 "全部"

- 首屏先读 `feed:home-pool`，立即展示 `items` 的前 12 条，不等任何网络请求。
- 缓存 30 分钟内视为新鲜（`FEED_FRESH_TTL`），直接秒开；超过 30 分钟才在后台按 8 并发刷新，旧内容继续可见。
- `fetchHomeFeed` 每完成 8 个频道就回调一次 `onBatch`；调用方合并后立即按 `published` 倒序去重并截断到 2000 条。
- 每个频道优先走 innertube 第一页，只取前 20 条；失败才回退 RSS（RSS 约 15 条，不补第二次请求）。
- 每次单请求预算 8 秒，单频道失败不阻塞其他频道，也不额外重试。
- `loadMore` 先每次展开 10 条本地池；池耗尽后最多挑 3 个仍有 `continuation` 的频道续拉，每频道仍取 20 条。
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
- 首屏后静默预取下一页，结果放 `nextPageBufferRef`；预取失败不报错，滑到底会用同一个 token 重试。
- 首次无缓存时 RSS 与 innertube 并行：RSS 先到先展示，innertube 到后用 `videoId` 合并并补全 `duration` 等字段；两者都失败才显示错误。
- 已加载多页时，后台刷新按 `videoId` 合并，新数据在前，旧数据保留，不清掉用户已经滑出来的内容。
- 手动上滑没有 600 条上限，可以一直加载到 `continuation` 为空。

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
6. "一键加载全部" 未实现：工程没有 `expo-network` / NetInfo，而需求禁止新增第三方依赖，无法可靠判断 Wi-Fi/蜂窝网络。手动上滑本身不受 600 条限制，已覆盖核心的 "加载到 continuation 为空" 场景。
7. 首页池新鲜期内不重复发起 100 个 browse 请求；新增 1 个订阅时只补拉该频道（缓存/当前池能识别已覆盖频道）。

## 5. 验证

```bash
cd mobile
npx tsc --noEmit
node scripts/test-home-feed.mjs
node scripts/test-settings-sync.mjs
node scripts/test-collection-sync.mjs
node scripts/test-progress-sync.mjs
node scripts/test-subscription-sync.mjs
node scripts/test-webdav-folder.mjs
node scripts/test-cache-keys.mjs
```

`test-home-feed.mjs` 覆盖聚合池 2000 上限、按发布时间倒序、每频道 20 条分批、缓冲队列第 21–30 条不丢失、刷新合并保留已加载内容。
