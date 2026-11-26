# Kissly 手机端字幕翻译深度优化开发文档（实施版）

> 工程：
> `C:\Users\KNNY\Desktop\Code\kiss-translator\mobile`
> 技术栈：
>
> Expo SDK 58 / React Native 0.88 / TypeScript /iOS + Android
> 文档日期：2026-11-26
> 文档性质：
> **设计稿 + 实施规格，尚未改代码**
> 与旧文档的关系：本文是
> **新文档**
> 。旧的
> `mobile/docs/subtitle-translation-speed.md`
> 保持原样，不修改；旧文档第 6 节的部分状态已经过时，本次实现以本文和当前代码为准。



***

## 0. 给执行 AI 的先行摘要

这份文档要解决的不是 “把翻译并发调大” 这么简单，而是把手机端字幕翻译从 “打开视频就排队翻全片” 改成 “只翻当前位置附近，播放推进再补，接近完整时自动补完”。

必须同时满足以下约束：



1. iOS 与 Android 共用同一套 JS 逻辑，不新增原生依赖。

2. 只改字幕翻译相关链路，不改动未提及的首页、订阅、播放器其它业务。

3. 不改 DeepSeek 思考模式现有的默认关闭逻辑；本次只是在翻译调度层做优化。

4. 免费引擎必须有限流保护，不能因为并发提高而被封禁。

5. 默认对所有视频启用懒加载，不新增用户开关。

6. 先做 A、B、C，D（YouTube 原字幕渐进显示）作为可选项后置，默认关闭。

已确认的产品选择：



| 项目          | 结论                                                |
| ----------- | ------------------------------------------------- |
| 文档覆盖范围      | A 窗口懒加载 + 90% 自动补全、B 请求闸门、C 按引擎批大小、D 原字幕渐进显示，全部纳入 |
| 懒加载默认       | 默认开启，所有视频都启用                                      |
| 免费引擎批大小     | **前台 6 条，后台 12 条**                                |
| 付费引擎批大小     | **前台 12 条，后台 18 条**                               |
| Google 免费限流 | **2 个在途 / 200ms 间隔**                              |
| 自动补全阈值      | **90%**，不是 95%（理由见 4.3）                           |
| 自动补全时机      | 仅前台稳定播放 / 暂停时；退后台、拖动进度条、广告期间暂停                    |
| 新增设置项       | 不新增。默认行为固定，保留代码常量便于回退                             |



***

## 1. 目标与非目标

### 1.1 目标



1. **首句更快**：打开视频后，第一个翻译请求必须从 “当前播放位置” 开始，而不是从第 0 条开始排队。

2. **少花额度**：用户只看 30 分钟，就不应该把 2 小时视频的 3000 条字幕全部翻译。

3. **不被限流**：免费引擎有明确的并发上限、请求间隔和 429 冷却。

4. **避免长期不完整**：当全片字幕已经翻译到 90% 左右，自动把剩余部分补完。

5. **拖动进度条不卡死**：跳到新位置后，新位置的字幕优先，旧位置最多允许 1～2 个在途请求收尾。

6. **缓存兼容**：旧版本已经翻译好的完整缓存仍然直接命中，不重新花钱。

### 1.2 非目标

以下方案已经评估过，明确不建议在本次实施：



* 不做 Web 端那种 400ms 聚合队列。手机端字幕是已知全量列表，不需要 “等一等再拼单”。

* 不做 10 路批次并发。手机网络、免费接口和 DeepSeek 的 RPM/TPM 都受不了。

* 不给免费引擎套思考模式、上下文提示词、流式返回。接口本身不支持，套了只会更慢。

* 不把 YouTube `timedtext` 按时间区间分批拉取。该接口一次返回整条轨道，没有稳定的时间切片参数。

* 不因为本次优化去改设置同步、WebDAV、订阅、首页 feed 等无关逻辑。

### 1.3 验收总则

完成后必须能回答 “是”：



* 2 小时、3000 条字幕的视频，打开时不会立刻请求 3000 条。

* 当前播放位置的字幕是第一批被翻译的内容。

* 免费引擎任意时刻的在途请求数不超过本文表格上限。

* 播放 30 分钟后，已翻译字幕明显少于全片。

* 覆盖率达到 90% 且前台稳定时，剩余字幕会自动补完。

* 拖动进度条后，新位置的字幕不会被旧窗口长时间挡住。

* iOS、Android 行为一致。

* `npm run typecheck` 通过，新增单元脚本通过。



***

## 2. 当前代码事实（实施基线）

这一节是 “现在到底是什么样”，执行 AI 必须先按这些事实理解代码，不要按旧文档的过时描述实现。

### 2.1 翻译主链路

`mobile/src/core/translate/index.ts` 当前行为：



| 事实   | 当前实现                                                                  |
| ---- | --------------------------------------------------------------------- |
| 单批大小 | `TRANSLATE_BATCH_SIZE = 12`                                           |
| 并发   | `TRANSLATE_CONCURRENCY = 2`，两个 worker                                 |
| 重试   | 一个批次允许延迟 2 秒重试 1 次（`TRANSLATE_RETRY_DELAY_MS = 2000`）                 |
| 翻译范围 | `translateCueList()` 对**全片所有字幕**建批次，直到全部翻完才 resolve                   |
| 位置优先 | 只是 “排序优先”：`pickNextCueBatch()` 从当前位置向前找，找完再回头补前面的；**不是只翻附近**          |
| 缓存   | 每批完成后写整部视频的完整快照；写操作串行化，避免旧快照覆盖新快照                                     |
| 缓存键  | `cues:v4:<videoId>:<trackKey>:<source>:<target>:<providerScope>`，30 天 |
| 空字幕  | 源文本为空的 cue 不请求，避免模型返回条数不匹配                                            |

关键结论：**当前不是单线程，也不是 “只翻附近”**。它是 “2 个 worker 按当前位置排序，但仍然会把全片排完”。所以用户看到 “字幕一直在慢慢加载”，根因不是单线程，而是 “全片都进了队列”。

### 2.2 播放器调用方式

`mobile/app/player.tsx`：



* 字幕加载完成后调用一次 `translateCueList(videoId, cues, key, options, onProgress)`。

* 传入 `anchorTime: startAtRef.current` 和 `getAnchorTime: () => progressRef.current.current`。

* `onProgress` 里直接 `setTranslatedCues(partial)`，状态显示 `正在翻译字幕… ${done}/${cues.length}`。

* `translationPending` 一直为 `true`，直到整部视频翻译结束。

* 播放进度来自 WebView 的 `time` 消息，`progressRef.current.current` 会实时更新。

* `progressRef` 里还有 `duration`、`bufferedStart`、`bufferedEnd`、`ad` 等字段。

这意味着：**播放器已经在提供实时位置**，新方案不需要重新造一套进度系统，只需要把 “一次性调用” 换成 “会话式调用”。

### 2.3 各引擎当前内部行为



| 引擎                                           | 当前内部行为                                                  | 对批大小的含义                              |
| -------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| Google 免费                                    | `google.ts` 对每条文本单独发请求，`mapLimit(texts, 3)`             | 不支持批量；批大小只影响调度，不减少 HTTP 请求数          |
| Google2                                      | `google2.ts` 每 12 条一个 HTTP 请求，`mapLimit(batches, 2)`    | 前台 6 / 后台 12，均通常一个请求                 |
| Microsoft                                    | `microsoft.ts` 每批最多 12 条 / 900 字符，批内串行                  | 前台 6 / 后台 12，均通常一个请求；字符超 900 会再拆     |
| 系统内置                                         | `system.ts` 一次原生调用整批                                    | 可以吃 6/12 条                           |
| DeepSeek / SiliconFlow / OpenRouter / OpenAI | `ai.ts` 内部 `batches(texts, 1600, 18)`，每 18 条或 1600 字符再拆 | 前台 12 条一个请求；后台 18 条一个请求，字符超 1600 会再拆 |
| Auto                                         | `autoOrder.ts` 先免费链，再付费链                                | 批大小按 “免费优先” 取保守值，避免 auto 命中免费引擎时超限   |

### 2.4 字幕获取现状

`mobile/src/core/youtube/innertube.ts` 的 `fetchCaptionCues()`：



1. 先顺序尝试 `original` 和 `json3-android`，每个 4 秒超时。

2. 如果拿到 “足够完整” 的轨道，直接返回。

3. 否则并行尝试 `json3`、`vtt-android`、`vtt`、`srv3-android`、`srv3`，每个 8 秒。

4. 都失败才走 WebView 回读，40 秒超时。

结论：**YouTube 原字幕没有可靠的 “按时间分批” 接口**。一次请求就是整条轨道；所谓 “分批获取” 只能做成 “先显示第一版可用字幕，后台再补更完整轨道”，这属于可选增强，不是本次核心。

### 2.5 缓存现状



* `loadCachedEntry` 读取带时间戳的缓存；超过 30 天删除。

* `pickBestCueCache` 只在 “缓存 cue 列表与当前字幕完全一致” 时才采用；它选翻译行数最多的那一份，不按行混合不同引擎。

* `saveCueCache` 每次写整部视频的快照。3000 条字幕反复写会带来明显的 AsyncStorage 压力，新方案必须做写入节流。



***

## 3. 总体设计

### 3.1 一句话架构

把 “一次性全片翻译” 换成 “一个跟随播放位置的翻译会话”：



```
播放器 time 消息
   │
   ▼
SubtitleTranslationSession
   │  setAnchor(time) / setPlaybackState(...)
   ▼
窗口规划 WindowPlanner
   │  当前位置前 15 秒 ~ 后 120 秒，最多 40 条
   ▼
任务队列
   ├─ 前台队列：当前字幕优先，其次最近回看，再向前
   └─ 后台队列：覆盖率达到 90% 后补全剩余
   │
   ▼
按引擎批大小切任务（免费前台 6 / 后台 12；付费前台 12 / 后台 18）
   │
   ▼
ProviderGate（每引擎并发、间隔、429 冷却）
   │
   ▼
translateTexts() / 各 provider
   │
   ▼
按原始 cue index 合并译文 → 节流写缓存 → onProgress 回播放器
```

### 3.2 新增模块

建议新增以下文件，职责单一，方便另一个 AI 分步实现：



| 文件                                  | 职责                                                                 |
| ----------------------------------- | ------------------------------------------------------------------ |
| `src/core/translate/config.ts`      | 所有常量、开关、引擎分类                                                       |
| `src/core/translate/window.ts`      | 根据播放时间计算窗口和 cue 索引范围                                               |
| `src/core/translate/batching.ts`    | 按前台 / 后台、免费 / AI 切任务；空字幕过滤；当前优先排序                                  |
| `src/core/translate/requestGate.ts` | 每引擎并发、最小间隔、429 冷却                                                  |
| `src/core/translate/session.ts`     | 翻译会话：加载缓存、worker、窗口更新、自动补全、缓存写节流                                   |
| `src/core/translate/index.ts`       | 保留 `translateTexts` / `translateOne`；导出会话工厂；兼容旧 `translateCueList` |
| `app/player.tsx`                    | 把一次性 `translateCueList` 改为会话式调用，接入时间、播放 / 暂停、前后台、广告、seek           |

### 3.3 会话接口（实施契约）

执行 AI 可以按下面的接口落地，命名可微调，但语义不能变：



```
export type TranslationPhase = 'window' | 'auto-fill' | 'idle';

export type SubtitleProgress = {
  cues: Cue[];
  provider: ProviderId;
  phase: TranslationPhase;
  /** 前台窗口是否还有未完成任务。自动补全不算 pending。 */
  pending: boolean;
  translated: number;
  total: number;
};

export type SubtitleSessionOptions = {
  videoId: string;
  cues: Cue[];
  trackKey: string;
  contextTitle?: string;
  from?: string;
  to?: string;
  ignoreCache?: boolean;
  initialAnchorTime?: number;
  durationSeconds?: number;
  onProgress?: (progress: SubtitleProgress) => void;
  onError?: (error: unknown, scope: 'window' | 'auto-fill') => void;
};

export type SubtitleTranslationSession = {
  start(): void;
  /** 播放位置变化；内部做 1 秒节流，不要每帧调用。 */
  setAnchor(time: number): void;
  /** 播放/暂停、前台/后台、广告、拖动中。 */
  setPlaybackState(state: {
    playing: boolean;
    foreground: boolean;
    ad: boolean;
    seeking: boolean;
  }): void;
  /** 暂停、退后台、卸载时调用；会 flush 缓存并停止新任务。 */
  stop(): Promise<void>;
  /** 手动全片翻译入口，可选；没有 UI 入口时不要自动调用。 */
  translateAll(): Promise<void>;
};
```

> 注意：
> `onProgress.pending`
> 只表示 “前台窗口还有任务”。自动补全在后台跑时，不要把播放器的 “翻译中” 状态一直挂着。

### 3.4 状态机



| 状态              | 进入条件                                        | 行为                             |
| --------------- | ------------------------------------------- | ------------------------------ |
| `idle`          | 没有前台任务，也没有自动补全                              | 等待 anchor 变化或播放状态变化            |
| `window`        | 当前窗口有未翻译 / 未尝试的 cue                         | 两个 worker 只做前台任务               |
| `auto-fill`     | 前台窗口完成，覆盖率 ≥ 90%，前台稳定                       | 最多 1 个后台任务；前台任务一来立即让路          |
| `paused`        | `foreground=false`、`ad=true`、`seeking=true` | 停止发起新任务；在途任务允许收尾；flush 缓存      |
| `done`          | 所有非空字幕都有译文                                  | 状态清空，缓存已是完整快照                  |
| `partial-error` | 某个任务重试后仍失败                                  | 保留已翻译内容；状态提示 “部分字幕翻译失败”；下次打开再试 |



***

## 4. 参数总表与取舍

### 4.1 参数表

所有常量放在 `src/core/translate/config.ts`，不要散落在 `player.tsx`。



| 常量                           | 建议值    | 说明                            |
| ---------------------------- | ------ | ----------------------------- |
| `LAZY_TRANSLATION_ENABLED`   | `true` | 总开关；回退时改 false                |
| `WINDOW_BEFORE_SEC`          | `15`   | 当前位置往前保留 15 秒，方便回看            |
| `WINDOW_AHEAD_SEC`           | `120`  | 当前位置往后预翻 120 秒                |
| `WINDOW_REFILL_AHEAD_SEC`    | `30`   | 剩余预翻不足 30 秒时扩展窗口              |
| `WINDOW_MAX_CUES`            | `40`   | 单窗口最多 40 条，防止密集字幕一次铺太多        |
| `SEEK_JUMP_SEC`              | `10`   | 位置跳出当前窗口 10 秒以上，视为 seek，重建窗口  |
| `BATCH_SIZE_FREE_FOREGROUND` | `6`    | 免费 / 系统引擎前台单批                 |
| `BATCH_SIZE_FREE_BACKGROUND` | `12`   | 免费 / 系统引擎后台补全单批               |
| `BATCH_SIZE_AI_FOREGROUND`   | `12`   | AI 引擎前台单批                     |
| `BATCH_SIZE_AI_BACKGROUND`   | `18`   | AI 引擎后台补全单批                   |
| `AUTO_COMPLETE_COVERAGE`     | `0.90` | 覆盖率达到 90% 自动补全                |
| `AUTO_COMPLETE_CONCURRENCY`  | `1`    | 自动补全同时最多 1 个任务                |
| `TRANSLATE_CONCURRENCY`      | `2`    | 会话总 worker 数，保持 2             |
| `TRANSLATE_RETRY_DELAY_MS`   | `2000` | 单个任务延迟重试 1 次                  |
| `CACHE_WRITE_THROTTLE_MS`    | `3000` | 缓存写入节流，避免每批重写大 JSON           |
| `PROGRESS_THROTTLE_MS`       | `300`  | 进度回调节流，避免 3000 条数组频繁 setState |

### 4.2 为什么免费前台 6 / 后台 12、付费前台 12 / 后台 18

这是最终口径：



* **免费 / 系统引擎：前台 6 条，后台 12 条。**

* **付费 AI：前台 12 条，后台 18 条。**

* `auto`：按 “免费优先” 使用前台 6 / 后台 12；回落到付费 AI 时，仍按 AI 的 12 / 18 逻辑执行。

这样定的原因：



1. **免费前台 6 条是为了首句更快。** 当前句只要等 6 条返回，不用等 12 条；Google2 / Microsoft 的 6 条仍然在 12 条安全上限内，通常还是一个请求。

2. **免费后台 12 条是为了减少补全请求。** 12 正好对齐 Google2 和 Microsoft 的现有上限，后台补全通常一个请求；Google 免费仍然是 12 条调度 = 12 个单条请求。

3. **免费前后台分开，是因为目标不同。** 前台要 “当前这句尽快出来”，后台要 “少切批、少请求”；统一 12 会牺牲首句速度，统一 6 又会增加后台请求数。

4. **代价是前台请求数会增加。** 同样 12 条字幕，前台 6 条会变成两个批、两个请求（Google2 / Microsoft）；Google 免费无论 6 还是 12，都是一条文本一个请求。首句更快，但总请求数略多，这是有意的取舍。

5. **付费 AI 前台 12 条**是一个请求能稳定返回的保守值；后台 18 条正好落在 `ai.ts` 的 `maxItems=18` 上限内，通常也是一个请求。

6. **Google 免费仍然是一条文本一个请求。** 前台 6 条就是 6 个请求，后台 12 条就是 12 个请求；靠请求闸门限制为 2 个在途、200ms 间隔，不是 6/12 个并发。

### 4.3 为什么自动补全从 95% 降到 90%

结论：**95% 偏高，建议 90%。**

原因：



* 95% 意味着用户几乎看完整部视频才会触发；剩下 5% 可能一直不完整，自动补全的意义变小。

* 90% 仍然是 “接近完整”，但能更早把最后 10% 补掉，体验更完整。

* 不建议低于 85%。低于 85% 时，懒加载很容易提前退化成 “全片翻译”，省额度效果消失。

* 如果以后更在意额度，可以把常量改回 `0.95`；更在意完整，可改 `0.88`。默认 `0.90`。

### 4.4 AI 后台 18 条的真实含义

`aiTranslate()` 内部仍然是 `maxItems=18 / maxChars=1600`。所以：



* 18 条是**调度层逻辑批**，通常正好一个 HTTP 请求。

* 如果这 18 条的字符总数超过 1600，会按字符再拆成两个或更多请求。

* 这样做的好处是后台任务切换少，且不会像更大的逻辑批那样固定拆成多个请求。

* 如果实测发现 18 条补全仍然偏慢，优先检查是不是字符超限导致拆批，而不是继续加大条数。



***

## 5. 窗口懒加载详细设计（A）

### 5.1 窗口定义

窗口是 “时间范围”，不是 “固定 40 条从 0 开始”：



```
windowStartTime = max(0, anchorTime - WINDOW_BEFORE_SEC)
windowEndTime   = min(duration, anchorTime + WINDOW_AHEAD_SEC)
```

再由时间范围映射到 cue 索引：



* `startIndex`：第一条 `end >= windowStartTime` 的 cue。

* `endIndex`：最后一条 `start <= windowEndTime` 的 cue。

* 如果 `endIndex - startIndex + 1 > WINDOW_MAX_CUES`，以 anchor 为中心截断到 40 条，保证当前 cue 一定在窗口内。

边界：



* `duration` 未知时，用最后一条 cue 的 `end` 作为视频结束。

* 视频很短、总 cue 数 ≤ 40 时，窗口就是全片，等价于原来的全量翻译；这是允许的。

* 没有字幕或全是空文本时，直接 `done`，不发请求。

### 5.2 初次打开



1. 用 `initialAnchorTime`（播放器已有的 `startAtRef.current`）计算窗口。

2. 先加载缓存；如果缓存已经覆盖全片，直接 `done`，不建窗口。

3. 否则建立前台任务，**第一个任务必须包含当前 anchor 所在的 cue**。

4. 当前 cue 已经在缓存里有译文时，第一个任务从它后面最近的未翻译 cue 开始。

### 5.3 任务顺序（关键）

不要简单 “从窗口头到尾”。用户最需要的是：



1. 当前这句；

2. 最近一个前台批（免费 6 条 / 付费 12 条），方便马上回看；

3. 当前往后的内容；

4. 更早的内容。

推荐前台任务顺序：



```
1. 包含 anchor 的任务（按前台批大小凑满：免费 6 条 / 付费 12 条）
2. anchor 前面紧邻的 1 个任务（约一个前台批）
3. anchor 后面继续向前
4. 窗口内剩余更早的任务
```

这样用户拖回 5 秒，不会看到一大段原文；同时当前字幕仍然最先发出。

### 5.4 播放推进时扩窗

播放器每次 `time` 消息更新 `anchorTime`。会话内部做 1 秒节流，不需要每帧处理。

扩窗条件：



* `anchorTime + WINDOW_REFILL_AHEAD_SEC > windowEndTime`，并且视频还没结束；

* 或者当前窗口内 “anchor 往后 30 秒” 已经没有未翻译 cue。

扩窗动作：



* 新 `windowEndTime = min(duration, anchorTime + WINDOW_AHEAD_SEC)`；

* 保留已翻译的 cue，不重复请求；

* 只把新增范围生成新任务；

* 不因为扩窗而回头重翻已完成的批次。

### 5.5 拖动进度条 /seek

`setAnchor(time)` 里判断：



* 如果新位置仍在当前窗口内，或只偏离不到 `SEEK_JUMP_SEC`，只更新 anchor 和任务优先级，不重建窗口。

* 如果跳出当前窗口超过 `SEEK_JUMP_SEC`，执行 `windowVersion += 1`，重建窗口和前台任务队列。

* 旧窗口已经发出的请求不强行取消；它们返回后仍然按原始 cue index 合并，译文有效就保留。

* 新窗口任务不能被旧窗口的排队任务挡住。实现上：清空旧的前台队列；旧的在途任务最多 `TRANSLATE_CONCURRENCY` 个，允许收尾；worker 下一轮优先取新窗口任务。

* 如果真机上 seek 后等待仍然明显（例如超过 3 秒），再考虑给 `httpText` 增加外部 `AbortSignal`，把旧窗口的在途请求真正中断。第一阶段先不做，避免改动过大。

### 5.6 暂停、退后台、广告



* `playing=false`：不停止当前窗口收尾，但不再扩大窗口；自动补全仍然允许（因为用户可能只是暂停）。

* `foreground=false`（App 退到后台）：停止发起新任务；在途任务允许收尾；`flush` 缓存。回到前台后按当前位置恢复。

* `ad=true`：广告期间不按广告时间计算窗口，停止新任务；广告结束后用内容时间重建 anchor。

* `seeking=true`：拖动期间不发起新任务；`seeked` 后按新位置恢复。

* 组件卸载 / 切换视频：`stop()`，取消定时器，flush 缓存，置 `stopped=true`。

### 5.7 短视频、空字幕、完整缓存



| 场景            | 行为                                  |
| ------------- | ----------------------------------- |
| 总 cue 数 ≤ 40  | 窗口覆盖全片，按前台批顺序翻完；这不算 “全量预翻”，因为视频本身很短 |
| 没有字幕 / 全是空文本  | 直接 `done`，状态清空                      |
| 缓存已覆盖全部非空 cue | 直接 `done`，不发任何翻译请求                  |
| 缓存只覆盖一部分      | 先显示已有译文，再按窗口补缺                      |
| 视频时长未知        | 用最后一条 cue 的 `end` 作为结束时间            |
| cue 时间重叠 / 重复 | 按 cue index 合并译文，不按时间合并；重复文本仍分别占位   |
| 某条字幕翻译为空字符串   | 视为未完成，允许下一次重试；不要把它当成功               |

### 5.8 去重与重试



* 每个 cue 同时只能在一个在途任务里，用 `inFlight: Set<number>` 标记。

* 已完成 cue 用 `completed: Set<number>` 标记；只有 `text.trim()` 非空且 `translation.trim()` 非空才算完成。

* 失败任务延迟 2 秒重试 1 次；仍失败则标记 `failed`，本次会话不再无限重试，避免坏 key 导致死循环。

* 超时错误不要原样重打；沿用 `ai.ts` 现有的 “拆半” 策略。

* 429 错误由请求闸门冷却，不在 provider 内部快速重试。

### 5.9 播放器状态与文案

不要继续显示 `正在翻译字幕… 0/3000`，这会让用户以为要等全片。

建议：



* 前台窗口有任务：`正在翻译当前字幕…`

* 前台窗口完成、自动补全中：`正在补全全文字幕… ${translated}/${total}`（可选，不强制）

* 前台窗口完成、无自动补全：状态清空，`translationPending=false`

* 部分失败：`部分字幕翻译失败，稍后会自动重试`

* 缓存完整：不显示翻译中

`onProgress` 的 `pending` 只在前台窗口有任务时为 true；自动补全不挂起播放器 UI。



***

## 6. 90% 自动补全（A 的后半部分）

### 6.1 覆盖率定义



```
total     = cues 中 text.trim() 非空的数量
translated = total 中 translation.trim() 非空的数量
coverage  = translated / total
```

注意：



* 空字幕不计入分母。

* 译文为空字符串、纯空格，都算未完成。

* 不要用 `cues.length` 直接做分母，否则空行会拉低覆盖率。

### 6.2 触发条件

同时满足才启动自动补全：



1. `coverage >= AUTO_COMPLETE_COVERAGE`（默认 0.90）。

2. 前台窗口没有未完成任务（`foregroundPending === 0`）。

3. `foreground === true`（App 在前台、播放器页面可见）。

4. `ad === false`、`seeking === false`。

5. 当前没有自动补全任务在跑。

“稳定播放 / 暂停” 都算；退后台、广告、拖动中不算。

### 6.3 队列与并发



* 自动补全使用**后台队列**，从第一个未翻译 cue 开始，按 `BATCH_SIZE_FREE_BACKGROUND=12` 或 `BATCH_SIZE_AI_BACKGROUND=18` 切任务。

* 后台同时最多 1 个任务；总 worker 仍是 2 个。

* 前台任务一来，后台不再取新任务；已经在途的 1 个后台任务允许完成，但它的结果仍然有效，不丢。

* 前台任务优先级永远高于后台；不要让后台的大批任务把当前字幕拖住。

### 6.4 暂停与恢复



* 用户 seek：后台任务暂停取新任务；前台新窗口优先。seek 结束后如果覆盖率仍 ≥ 90%，且前台稳定，继续补全。

* 用户退后台：停止后台任务；回前台后重新判断覆盖率。

* 用户暂停：允许继续补全（属于 “前台稳定暂停”）。

* 视频结束：如果覆盖率 ≥ 90%，继续补完；如果覆盖率很低，不强制全片翻译。

### 6.5 完成与缓存



* 所有非空 cue 都有译文后：`phase='done'`，`pending=false`，立即 flush 缓存。

* 完成后的缓存是完整快照，下次打开直接命中，不再发请求。

* 自动补全中途退出：缓存里是部分译文；下次打开按同一覆盖率规则继续。

* 不要因为自动补全完成就清除缓存；缓存键和 TTL 保持现状。

### 6.6 失败处理



* 后台任务失败重试 1 次；仍失败则记录 `failed`，不阻塞前台。

* 不要因为后台失败把整个会话标成失败；用户当前窗口仍然可用。

* 下次打开视频时，失败部分会重新进入窗口 / 补全流程。



***

## 7. 按引擎批大小（C）

### 7.1 调度层批大小



| 引擎                                           | 前台 | 后台            | 实际 HTTP 情况                                  |
| -------------------------------------------- | -- | ------------- | ------------------------------------------- |
| Google 免费                                    | 6  | 12            | 前台 6 条 = 6 个请求；后台 12 条 = 12 个请求；靠闸门限制 2 个在途 |
| Google2                                      | 6  | 12            | 前台 6 条一个请求；后台 12 条一个请求                      |
| Microsoft                                    | 6  | 12            | 前台 6 条一个请求；后台 12 条一个请求；字符超 900 会再拆          |
| 系统内置                                         | 6  | 12            | 一次原生调用，通常 6/12 条一个调用                        |
| DeepSeek / SiliconFlow / OpenRouter / OpenAI | 12 | 18            | 前台 12 条一个请求；后台 18 条一个请求；字符超 1600 会再拆        |
| Auto                                         | 6  | 12（免费）/18（付费） | 按免费优先前台 6；实际回落到付费 AI 时用后台 18                |

### 7.2 为什么 provider 内部上限先不动



* Microsoft / Google2 的 12 条上限是现有代码里的安全值；免费前台 6 条、后台 12 条都在上限内，通常都是一个请求，不要超过 12。

* AI 的 18 条 / 1600 字符是为了避免模型合并、漏行、JSON 截断；后台 18 条正好落在上限内，通常一个请求，不要再为了 “更大批” 调到 40。

* Google 免费没有批量能力，前台 6 条就是 6 个请求，后台 12 条就是 12 个请求，实际仍是一条文本一个 HTTP 请求。

* 因此：**调度层按免费前台 6 / 后台 12、付费前台 12 / 后台 18 切；provider 内部上限先保持原样**。

### 7.3 可选调优（需要真机验证）

如果后续确认接口稳定，可以再做：



1. 如果以后要把免费后台批从 12 提高到 16 或 20，再把 Google2 `MAX_ITEMS` 同步试到 16/20；要求返回条数一致、无 400/429、单请求耗时下降。

2. 如果以后要把 Microsoft 提到 16，`MAX_ITEMS` 从 12 试到 16，`MAX_CHARS` 从 900 试到 1200；要求同上。

3. AI `maxItems` 保持 18；后台 18 条已经正好落在上限内，不要为了 “更大批” 改到 40。

4. 任何调优都必须有开关和回退，不要直接把常量写死。



***

## 8. 请求闸门（B）

### 8.1 目标

解决 “免费引擎并发过高被封、429 后疯狂重试” 的问题。闸门只作用于**翻译请求**，不要套到字幕、封面、视频信息等请求上。

### 8.2 每引擎参数



| 引擎          | 最大在途 | 最小间隔  | 429 冷却 | 说明               |
| ----------- | ---- | ----- | ------ | ---------------- |
| Google 免费   | 2    | 200ms | 5s     | 每条文本一个请求         |
| Google2     | 2    | 150ms | 5s     | 每次 HTTP 请求算一个    |
| Microsoft   | 2    | 100ms | 3s     | 每次 HTTP 请求算一个    |
| 系统内置        | 2    | 0     | 0      | 本地调用，不涉及网络       |
| DeepSeek    | 2    | 100ms | 2s     | 尊重 `Retry-After` |
| SiliconFlow | 2    | 100ms | 2s     | 尊重 `Retry-After` |
| OpenRouter  | 2    | 100ms | 2s     | 尊重 `Retry-After` |
| OpenAI 兼容   | 2    | 100ms | 2s     | 尊重 `Retry-After` |

说明：



* 最大在途是 “每个引擎全局”，不是每个会话各一份。切视频后仍然生效。

* 最小间隔是 “两次请求开始时间” 的间隔，不是请求结束后等多久。

* 429 冷却上限 30 秒；`Retry-After` 可以是秒数，也可以是 HTTP 日期，解析失败就用默认冷却。

* 冷却期间，前台任务也要等；这是为了避免越封越久。

### 8.3 实现方式



```
withProviderGate(provider, fn):
  1. 如果该 provider 在冷却中，等到 cooldownUntil。
  2. 等待一个并发槽位（最多 maxInFlight）。
  3. 距离上一次请求开始不足 minInterval，就 wait 差值。
  4. 调用 fn()，也就是真正的 httpText / provider 请求。
  5. 如果 response.status === 429：
       - 读取 Retry-After
       - 设置 cooldownUntil = now + clamp(retryAfter ?? defaultCooldown, 0, 30s)
  6. finally 释放槽位，记录 lastStartAt。
```

关键细节：



* **超时从拿到槽位后开始**，不要把排队等待算进 `requestTimeoutMs`。否则排队 5 秒后请求还没发就超时。

* `httpText` 的 `AbortController` 不负责排队；gate 在外面等。

* 不要在 `httpText` 全局入口加锁，否则字幕、封面也会被拖慢。

* `googleTranslate` 内部有 `mapLimit(texts, 3)`，每个文本都会过 gate；两个 worker 同时跑时，gate 仍把 Google 免费的全局并发压到 2。

* 后台任务在发起前检查前台是否 pending；有前台任务时，后台不再入 gate 队列。已经在途的后台任务允许完成。

### 8.4 与现有重试的关系



* `google.ts` / `microsoft.ts` 内部有 2 次 300ms/600ms 重试；gate 会把 429 冷却放在这两次重试之间，避免快速打穿。

* `ai.ts` 的 `chat()` 有 2 次重试和拆半逻辑；429 由 gate 冷却，不要在外层再立即重试。

* 会话层对失败任务只做一次 2 秒延迟重试；如果仍是 429，交给 gate 冷却，不要叠加重试放大请求量。

### 8.5 调试与观测

开发环境建议打印（不要在生产日志刷屏）：



```
[gate] provider=google wait=200ms inflight=2
[gate] provider=google2 429 retry-after=8s cooldown=8s
[gate] provider=deepseek inflight=2
```

验收时统计：



* 任意 1 秒窗口内，每引擎在途请求不超过表值。

* 429 后至少等待冷却时间才再次请求。

* 冷却期间没有新的同引擎请求发出。



***

## 9. 缓存与持久化

### 9.1 缓存键不变

继续使用现有 `cues:v4:...`，不要新建一套缓存体系。原因：



* 旧版本完整缓存仍然可用，用户升级后不用重翻。

* `auto` 模式仍然可以复用任意引擎的历史缓存。

* 清除缓存、WebDAV、设置变更的现有逻辑不需要跟着改。

### 9.2 部分缓存



* 会话启动时仍然用 `pickBestCueCache` 选一份最完整的缓存。

* 只显示已有译文，未翻译的 cue 保持空字符串；播放器会回落到原文。

* 缓存里的 cue 列表必须与当前字幕完全一致才采用；不一致就不用，避免错位。

### 9.3 写入节流

现状是每批写完就 `saveCached` 整部快照。3000 条字幕时这会很重。改为：



* 内存里维护 `translations: string[]`。

* 每完成一个任务，标记 `dirty=true`。

* 用 `CACHE_WRITE_THROTTLE_MS=3000` 做节流：最多每 3 秒写一次。

* 以下时机立即 flush：


  * 前台窗口完成；

  * 用户暂停；

  * App 退后台；

  * 视频切换 / 组件卸载；

  * 自动补全完成。

* 写入仍然串行化，避免旧快照覆盖新快照。

* 写入失败不抛出到 UI；字幕已经显示，缓存失败只影响下次打开。

### 9.4 完整缓存与自动补全



* 自动补全完成后，flush 一次完整快照。

* 下次打开如果 `pickBestCueCache` 命中完整列表，直接 `done`，不再发请求。

* 不要因为 “懒加载” 只缓存窗口；缓存仍然存整部 cue 列表，只是大部分 translation 为空。这样下次打开可以继续补。

### 9.5 “重新翻译” 按钮

现有 `retranslate()` 会清掉 `captions` 和 `cues:v3/v4`，然后重新加载。改造后要明确：



* 保持 “重新翻译”= 清缓存后从当前位置重新开始懒加载，不要静默变成全片翻译。

* 如果产品后续需要 “翻译全片”，单独加一个带确认的入口，调用 `session.translateAll()`；不要混进现有按钮。

* 不要在本次实现里擅自改按钮文案或行为。



***

## 10. YouTube 原字幕渐进显示（D，可选）

### 10.1 先明确限制



* YouTube `timedtext` 一次返回整条轨道，没有可靠的 `begin/end` 时间区间参数。

* 因此**做不到真正的 “按时间分批下载原字幕”**。

* 能做的只有 “渐进显示”：先用较快返回的一版可用字幕，让用户先看到内容；后台继续拉更完整的轨道，最终替换 / 补全。

### 10.2 建议的优先级



* P3，默认关闭，开关 `CAPTION_PROGRESSIVE_ENABLED=false`。

* 先完成 A、B、C 并观察真机收益，再决定是否开启。

* 原因：实现复杂、可能跳变、会改变 trackKey / 缓存匹配；收益在多数网络下不明显。

### 10.3 如果实现，接口建议



```
export async function fetchCaptionCuesProgressively(
  track: CaptionTrack,
  durationSeconds: number,
  visitorData: string,
  onPartial: (cues: Cue[], meta: { variant: string; provisional: boolean }) => void,
  signal?: AbortSignal
): Promise<Cue[]>;
```

流程：



1. 先请求 `original`，超时 4 秒。

2. 如果返回非空且覆盖率 ≥ 50%，调用 `onPartial`，播放器先显示这批字幕。

3. 继续走现有候选阶梯（`json3-android`、并行 5 种格式）。

4. 找到更完整的轨道后返回最终列表。

5. 如果最终列表与临时列表不同，做一次译文重映射：

* 按 `start` 误差 ≤ 0.25 秒 + 文本相同 / 高度相似匹配；

* 能匹配上的保留原译文；

* 匹配不上的留空，由当前窗口重新翻译。

1. 重映射后仍使用同一个 `trackKey`；缓存内容替换为最终 cue 列表。

2. 如果最终列表和临时列表完全相同，不重启会话，避免闪烁。

风险：



* 临时轨道可能是滚动字幕 / 重复行，替换时可能跳变。

* 缓存 cue 列表变化会让旧的完整缓存失效；必须用重映射，不能直接丢译文。

* 低覆盖率临时轨道可能让用户先看到错误时间轴；建议只在覆盖率 ≥ 50% 时显示。

* 如果实现后真机出现闪烁或错位，直接关掉开关，不影响 A、B、C。



***

## 11. 播放器接入（`app/player.tsx`）

### 11.1 替换一次性调用

现状：



```
load() -> translate(cues, key, title, from, ignoreCache) -> await translateCueList(...)
```

改为：



```
load() -> createSubtitleSession(...) -> session.start()
```

`translate()` 这个内部函数可以保留名字，但内部改成创建会话并保存到 `sessionRef`。切换视频、重新加载、组件卸载时先 `session.stop()`。

### 11.2 时间与播放状态



* `handleMessage` 的 `message.type === 'time'` 分支里，更新 `progressRef` 后调用：



```
sessionRef.current?.setAnchor(message.current)
sessionRef.current?.setPlaybackState({
  playing: message.playing === true,
  foreground: appState.current === 'active',
  ad: message.ad === true,
  seeking: seekingRef.current,
})
```



* `setAnchor` 内部做 1 秒节流，播放器不需要自己去重。

* `playing`、`ad`、`seeking`、AppState 变化时也要主动调用一次 `setPlaybackState`，不要只在 `time` 消息里调用。

* 广告期间 `ad=true`；广告结束后用内容时间重新 `setAnchor`。

### 11.3 进度回调

`onProgress` 里：



* `setTranslatedCues(progress.cues)`：维持现有渲染链路不变。

* `setProviderLabel(providerDisplayName(progress.provider))`。

* `setTranslationPending(progress.pending)`：只在前台窗口有任务时为 true。

* 状态文案按 5.9 的规则；不要再用 `0/${cues.length}`。

* 对 `progress.cues` 的 setState 做 300ms 节流；首个任务完成时立即刷新一次，保证当前字幕尽快出现。

### 11.4 前后台



* 用 `AppState` 监听 `active` / `background`。

* 退后台：`setPlaybackState({ foreground:false })`，会话停止新任务并 flush 缓存。

* 回前台：`foreground:true`，按 `progressRef.current.current` 恢复窗口。

* 不要因为退后台就清空 `translatedCues`；回来还要继续显示。

### 11.5 清理

在字幕加载 `useEffect` 的 cleanup 里：



```
cancelled = true
sessionRef.current?.stop()
sessionRef.current = null
```

`stop()` 要：



* 置 `stopped=true`；

* 清掉扩窗 / 进度 / 缓存定时器；

* 等待在途任务收尾（或最多等一个超时）；

* flush 缓存；

* 不再调用 `onProgress`。

### 11.6 与现有设置的联动

现有 `useEffect` 依赖里已经包含 `settings.provider`、目标语言、模型、超时等。改造后：



* 这些依赖变化时，先 `stop()` 旧会话，再创建新会话。

* 不要复用旧会话的 `translations`，因为 provider / 语言 / 模型变了，缓存键也可能变。

* `deepseekThinking` 变化也应重建会话；它已经在现有设置依赖里，确认不要漏掉。



***

## 12. 文件级改动清单



| 文件                                      | 类型   | 改动                                                 |
| --------------------------------------- | ---- | -------------------------------------------------- |
| `src/core/translate/config.ts`          | 新增   | 所有常量、引擎分类、开关                                       |
| `src/core/translate/window.ts`          | 新增   | `computeWindow()`、cue 索引范围、扩窗、seek 判断              |
| `src/core/translate/batching.ts`        | 新增   | 前台 / 后台任务切分、当前优先排序、空字幕过滤                           |
| `src/core/translate/requestGate.ts`     | 新增   | 每引擎并发 / 间隔 / 429 冷却                                |
| `src/core/translate/session.ts`         | 新增   | 会话状态机、worker、缓存、自动补全、进度回调                          |
| `src/core/translate/index.ts`           | 修改   | 导出会话工厂；`translateCueList` 保留兼容；`translateTexts` 不变 |
| `src/core/translate/google.ts`          | 修改   | `httpText` 外包 `withProviderGate('google', ...)`    |
| `src/core/translate/google2.ts`         | 修改   | 同上，按 HTTP 请求计数                                     |
| `src/core/translate/microsoft.ts`       | 修改   | 同上                                                 |
| `src/core/translate/ai.ts`              | 修改   | `chat()` 的 `httpText` 外包 gate；不改 18/1600 内部拆分      |
| `src/core/translate/system.ts`          | 不改   | 本地调用，不经过网络 gate；如果需要统一 worker 并发，可在会话层控制           |
| `app/player.tsx`                        | 修改   | 会话接入、时间 / 状态、进度文案、cleanup                          |
| `src/core/youtube/innertube.ts`         | 可选修改 | D 阶段新增渐进获取函数；默认不启用                                 |
| `scripts/test-subtitle-window.mjs`      | 新增   | 窗口 /seek/ 扩窗单测                                     |
| `scripts/test-translation-batching.mjs` | 新增   | 批大小 / 顺序 / 空字幕单测                                   |
| `scripts/test-request-gate.mjs`         | 新增   | 并发 / 间隔 / 429 单测                                   |
| `scripts/test-auto-complete.mjs`        | 新增   | 覆盖率 / 触发条件单测                                       |

不改：



* `src/core/types.ts`（除非要加会话类型，建议加在 `session.ts`）

* `src/core/defaults.ts`（不新增设置项）

* `src/core/settingsNormalize.ts`、`settingsSync.ts`

* 首页、订阅、WebDAV、播放器 UI 样式



***

## 13. 测试计划

### 13.1 单元测试（Node 脚本，沿用现有 `.mjs` 风格）

`test-subtitle-window.mjs`：



1. anchor=0，窗口 0–120 秒，40 条上限。

2. anchor=60，窗口 45–180 秒。

3. anchor 接近视频结尾，窗口不越过 duration。

4. 密集字幕 200 条，窗口截断到 40 条且包含当前 cue。

5. seek 跳出 10 秒，`windowVersion` 增加；5 秒内不动。

6. 短视频 20 条，窗口覆盖全片。

`test-translation-batching.mjs`：



1. 免费引擎前台 6、后台 12；AI 前台 12、后台 18。

2. `auto` 免费优先时使用前台 6 / 后台 12；回落到付费 AI 时使用前台 12 / 后台 18。

3. 空文本不进入任务；已完成 cue 不重复。

4. 任务顺序：当前 → 前一个 → 后方 → 更早。

5. AI 后台 18 条逻辑批进入 provider 后通常一个请求；如字符超 1600 会再拆（由现有 `ai.ts` 测试覆盖，至少断言调度层传入 18）。

`test-request-gate.mjs`：



1. 最大在途不超过配置。

2. 两次请求开始间隔不小于 `minInterval`。

3. 429 设置冷却，冷却结束前不发新请求。

4. `Retry-After` 秒数和 HTTP 日期都能解析；异常值 clamp 到 30 秒。

5. 请求抛错也释放槽位，不永久占坑。

6. Google 免费单独验证：最大 2 个在途，请求开始间隔不小于 200ms。

`test-auto-complete.mjs`：



1. 空字幕不计入分母。

2. 覆盖率 0.89 不触发，0.90 触发。

3. 前台窗口未完成时不触发。

4. 退后台 / 广告 /seek 时不触发。

5. 自动补全只允许 1 个后台任务。

### 13.2 真机手工测试（iOS + Android 各一遍）

只测相关功能，不打开无关界面：



1. 2 小时、约 3000 条字幕的视频，免费 Microsoft：

* 打开后当前字幕出现时间；

* 状态不再是 `0/3000`；

* 观察 1 分钟，确认没有一次性翻全片。

1. 同一视频，免费 Google：

* 当前字幕优先；

* 请求闸门日志不超 2 个在途。

1. 同一视频，DeepSeek（思考关闭）：

* 前台 12 条一批；

* 后台 18 条逻辑批，通常一个请求；字符超 1600 会再拆；

* 不出现 429 风暴。

1. 播放到 30 分钟，统计已翻译条数，确认明显少于全片（目标 25%–40%）。

2. 拖动到 10 分钟处：

* 新位置当前字幕优先；

* 旧窗口最多 2 个在途任务收尾；

* 不出现长时间空白。

1. 暂停 1 分钟：

* 当前窗口收尾；

* 覆盖率 ≥ 90% 时自动补全继续；

* 退后台后停止补全。

1. 广告：

* 广告期间不按广告时间扩窗；

* 广告结束恢复内容位置。

1. 覆盖率到 90%：

* 自动补全启动；

* 只有 1 个后台任务；

* 补完后再次打开视频直接命中缓存，无请求。

1. 缓存：

* 已完整缓存的视频打开后不请求；

* 部分缓存先显示已有译文；

* 清除缓存 / 重新翻译后从当前位置重新开始。

1. 边界：

* 无字幕视频；

* 短视频（< 40 条）；

* 空字幕行；

* 拖动到结尾；

* 切换视频；

* App 退后台再回来。

### 13.3 命令



```
cd C:\Users\KNNY\Desktop\Code\kiss-translator\mobile
npm run typecheck

node scripts/test-subtitle-window.mjs
node scripts/test-translation-batching.mjs
node scripts/test-request-gate.mjs
node scripts/test-auto-complete.mjs
node scripts/test-deepseek-thinking.mjs
node scripts/test-settings-normalize.mjs
node scripts/test-translation-cache-key.mjs
```

### 13.4 验收指标



| 指标                 | 目标                          |
| ------------------ | --------------------------- |
| 首个翻译请求             | 必须包含当前 anchor cue；不能先翻第 0 条 |
| 打开 2h/3000 条视频的首窗口 | 最多 40 条进入任务，不是 3000 条       |
| 播放 30 分钟后的翻译量      | 明显少于全片，目标 25%–40%           |
| 免费引擎并发             | 不超过第 8 节表格                  |
| 429 后              | 至少等待冷却再请求                   |
| seek 后             | 新位置当前字幕优先；旧窗口最多 2 个在途       |
| 90% 覆盖率            | 前台稳定时 5 秒内启动自动补全            |
| 自动补全并发             | 同时最多 1 个后台任务                |
| 缓存                 | 完整后再次打开 0 请求；部分缓存不丢         |
| 双端                 | iOS/Android 行为一致，无原生改动      |



***

## 14. 风险与回滚



| 风险            | 表现               | 规避                               |
| ------------- | ---------------- | -------------------------------- |
| 窗口太小          | 用户快速往前拖，字幕还没翻    | seek 后按新位置重建；窗口 120 秒；当前优先       |
| 自动补全太早        | 额度消耗接近全片         | 默认 90%，可改 95；低于 85% 不建议          |
| 缓存写太频繁        | AsyncStorage 卡顿  | 3 秒节流 + 关键时机 flush               |
| 闸门把前台拖慢       | 后台请求占坑           | 后台最多 1 个任务；前台优先；必要时加 AbortSignal |
| Google 免费请求数高 | 后台 12 条 = 12 个请求 | gate 2 在途 + 200ms 间隔；后台 1 任务     |
| AI 18 条字符超限   | 单任务拆成多个请求        | 检查 1600 字符上限；必要时把长句单独切           |
| 渐进字幕跳变        | 临时轨道被替换          | D 默认关闭；只在覆盖率 ≥50% 显示；重映射译文       |
| 旧缓存不兼容        | 用户升级后重翻          | 缓存键不变；只改调度，不改 payload 格式         |
| 旧 “重新翻译” 误解   | 用户以为会翻全片         | 保持懒加载；全片入口单独做并确认                 |

回滚开关：



```
// src/core/translate/config.ts
export const LAZY_TRANSLATION_ENABLED = true;      // false -> 回退旧 translateCueList
export const AUTO_COMPLETE_ENABLED = true;         // false -> 不自动补全
export const REQUEST_GATE_ENABLED = true;          // false -> 直接请求
export const CAPTION_PROGRESSIVE_ENABLED = false;  // true -> 开启 D
```

回滚方式：



* 关闭 `LAZY_TRANSLATION_ENABLED`，`player.tsx` 走旧的 `translateCueList` 全片路径。

* 关闭 `REQUEST_GATE_ENABLED`，provider 直接调 `httpText`，恢复旧行为。

* 关闭 `AUTO_COMPLETE_ENABLED`，只保留窗口翻译。

* D 不启用时，`innertube.ts` 不改，保持现状。

* 所有改动都是 JS/TS，无原生代码；可用 git 回退。



***

## 15. 实施顺序（建议给执行 AI 的排期）

### P0：安全与基础



1. `requestGate.ts` + provider 接入（先防止免费引擎被限流）。

2. `config.ts`、`window.ts`、`batching.ts` 纯函数 + 单测。

3. `npm run typecheck`。

### P1：窗口会话



1. `session.ts`：缓存加载、前台任务、worker、进度回调、缓存节流。

2. `player.tsx` 接入：替换一次性调用、时间 / 状态、cleanup、状态文案。

3. 真机验证首句、seek、暂停、退后台。

4. 单测：window/batching。

### P2：自动补全与批大小



1. 90% 覆盖率判断 + 后台队列 + 1 并发。

2. 免费前台 6 / 后台 12；AI 前台 12 / 后台 18 落地。

3. 缓存 flush、完整缓存命中。

4. 单测：auto-complete、gate。

5. 真机验证 90% 触发、补全完成、缓存命中。

### P3：YouTube 原字幕渐进显示（可选）



1. `fetchCaptionCuesProgressively()`。

2. 临时字幕显示、最终轨道替换、译文重映射。

3. 默认关闭，真机对比开启 / 关闭的收益和跳变。

4. 如果收益不明显或跳变明显，保持关闭，不阻塞发布。



***

## 16. 明确不建议的做法

执行 AI 不要做以下事情：



1. 不要为了 “看起来快” 把 `TRANSLATE_CONCURRENCY` 提到 4/6/10。手机端和免费接口受不了。

2. 不要给免费引擎加 `thinking`、上下文、流式。它们的接口不是 OpenAI 兼容格式。

3. 不要用 400ms 聚合队列。字幕列表是已知的，窗口调度比 “等一等拼单” 更直接。

4. 不要按时间区间请求 YouTube `timedtext`。接口不支持，硬做会得到整轨或空响应。

5. 不要把缓存改成 “只存窗口”。下次打开会丢上下文；仍然存整部 cue 列表，只是大部分为空。

6. 不要在未确认的情况下改 “重新翻译” 按钮为全片翻译。

7. 不要新增用户设置开关。默认对所有视频启用；需要回退时改常量。

8. 不要改动未提及的首页、订阅、WebDAV、UI 样式。



***

## 17. 交付物与完成定义

执行 AI 完成后必须交付：



1. 代码改动清单（按第 12 节）。

2. `npm run typecheck` 输出。

3. 新增单测脚本的运行输出（window/batching/gate/auto-complete）。

4. 真机测试记录：iOS、Android 各一段，至少覆盖首句、30 分钟翻译量、seek、90% 自动补全、缓存命中。

5. 未验证项清单（例如 Google2/Microsoft 12 条接口是否稳定、D 阶段是否开启）。

6. 回滚说明（四个开关）。

完成定义：



* 用户打开长视频，不再 “从第 0 条慢慢翻全片”。

* 只看一部分时，只花这部分附近的额度。

* 免费引擎不被短时间打爆。

* 接近完整时自动补完，不会长期停在 90% 多。

* 双端一致，类型检查通过。



***

## 附录 A：当前关键代码位置



| 内容         | 位置                                                                               |
| ---------- | -------------------------------------------------------------------------------- |
| 翻译主入口      | `src/core/translate/index.ts` → `translateCueList()`                             |
| 当前批大小 / 并发 | `src/core/translate/index.ts` → `TRANSLATE_BATCH_SIZE` / `TRANSLATE_CONCURRENCY` |
| 任务排序       | `src/core/translate/schedule.ts` → `pickNextCueBatch()`                          |
| AI 内部拆批    | `src/core/translate/ai.ts` → `batches(texts, 1600, 18)`                          |
| Google 免费  | `src/core/translate/google.ts` → `mapLimit(texts, 3)`                            |
| Google2    | `src/core/translate/google2.ts` → 12 条 / 批                                       |
| Microsoft  | `src/core/translate/microsoft.ts` → `MAX_ITEMS=12` / `MAX_CHARS=900`             |
| 系统内置       | `src/core/translate/system.ts` → 原生批量                                            |
| 缓存选择       | `src/core/translate/cacheSelection.ts` → `pickBestCueCache()`                    |
| 缓存键        | `src/core/translate/cacheKey.ts` → `cues:v4:...`                                 |
| 播放器调用      | `app/player.tsx` → `translate()` / `translateCueList()`                          |
| 播放器进度      | `app/player.tsx` → `progressRef`、`message.type === 'time'`                       |
| 字幕获取       | `src/core/youtube/innertube.ts` → `fetchCaptionCues()`                           |
| 字幕缓存       | `src/core/youtube/captionCache.ts` → `captions:v2:...`                           |

## 附录 B：一句话给执行 AI

> 把 “打开视频就翻全片” 改成 “只翻当前位置前后一小段，播放推进再扩窗；免费前台 6 / 后台 12，AI 前台 12 / 后台 18；所有引擎按表限流；覆盖率达到 90% 且前台稳定时，用 1 个后台任务把剩余补完；拖动进度条时新位置优先，旧窗口最多收尾 2 个在途请求；不新增设置项，不改无关业务，iOS/Android 共用一套逻辑。”