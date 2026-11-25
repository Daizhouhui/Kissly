# Kissly 字幕翻译速度与 DeepSeek 思考模式开发文档

> 工程：`C:\Users\KNNY\Desktop\Code\kiss-translator\mobile`
> 技术栈：Expo SDK 58 / React Native 0.88 / TypeScript
> 日期：2026-11-25
> 状态：**DeepSeek 思考模式开关已实现并默认关闭**；第 6 节速度优化已于 2026-11-25 实现并通过自动测试。
> 平台：纯 JS 改动，iOS 与 Android 共用同一套逻辑，无原生代码变更。

---

## 1. 一句话结论

手机端此前用 DeepSeek 翻译字幕时**不发送任何 thinking 参数**，而 DeepSeek 官方接口**默认开启思考模式、默认强度 high**。结果是每一小批字幕都要先写一篇思维链再返回 JSON，速度慢、费用高，还容易触发 20 秒超时重试。

本次给 DeepSeek 增加了一个「思考模式（深度思考）」开关，**默认关闭**，请求体显式发送 `thinking: { type: "disabled" }`，不再依赖服务端默认。开启时发送 `thinking: { type: "enabled" }`，思考强度沿用服务端默认（high）。

---

## 2. 背景：字幕翻译为什么慢

### 2.1 请求链路

1. `mobile/app/player.tsx` 加载字幕后调用 `translateCueList()`（`mobile/src/core/translate/index.ts`）。
2. `translateCueList()` 从第 0 条字幕开始，每 `TRANSLATE_BATCH_SIZE = 8` 条一批，**串行**处理：一批完成、写缓存、回调进度，再发下一批。
3. 每批调用 `translateTexts()`，选中 DeepSeek 时走 `deepseekConfig()` → `aiTranslate()` → `chat()`。
4. `chat()` 改造前的请求体只有 `model`、`temperature: 0.2`、`stream: false`、`messages`，`aiAnalyzeSentence()` 同形；本次仅为 DeepSeek 增加了 `thinking` 字段，其他引擎保持原样。
5. 请求超时由 `requestTimeoutMs` 控制，默认 20000 ms；超时后 `chat()` 会原样重试一次，仍失败时 `aiTranslate()` 会把这一批拆成 4 条一小块继续请求。

### 2.2 五个叠加原因

| 原因 | 代码证据 | 影响 |
| --- | --- | --- |
| 思考模式默认开启，强度 high | mobile 请求体无 thinking 字段；DeepSeek 文档：默认 enabled、effort high | 每批先产出 `reasoning_content`，耗时与 token 显著增加 |
| 严格串行 | `translateCueList()` 的 `for` 循环内 `await`（`index.ts:321` 起） | 300 条字幕约 38 个请求排队，总时间是单请求耗时之和 |
| 永远从第 0 条开始 | `for (let start = 0; ...)`（`index.ts:321`） | 拖到视频中段也要等前面全部翻完，体感最差 |
| 20 秒超时 + 原样重试 + 拆小批 | `ai.ts` 的 `chat()` 重试逻辑；`http.ts` 的 AbortController；`defaults.ts` 的 20000 | 一个 high 思考批次很容易超 20 秒；最坏 40 秒后再拆成 4 条小块，请求数暴涨 |
| 思考模式下 temperature 无效 | DeepSeek 文档：thinking 不支持 temperature 等参数 | 原本设置的 0.2 不起作用，译文风格更随机（不是速度问题，但属于隐性副作用） |

> 本文中的耗时数字均为按代码结构和单请求延迟估算，未做真机基准测试；实际以真机日志为准。

---

## 3. 本次实现：DeepSeek 思考模式开关

### 3.1 产品行为

- 位置：`翻译引擎 → 高级引擎 → DeepSeek → 接口配置`，模型输入框下方。
- 标题：`思考模式（深度思考）`。
- 说明：`默认关闭。开启后先推理再翻译：速度更慢、费用更高，长句和俚语可能更准`。
- 默认值：关闭（`false`）。
- 作用范围：**仅 DeepSeek**。字幕翻译、首页标题翻译、播放器里的句子分析，三处 DeepSeek 请求共用这个开关。
- 其他高级引擎（SiliconFlow / OpenRouter / OpenAI 兼容）不受影响，仍不发送任何思考参数，行为由各自平台与模型默认决定。

### 3.2 设置字段

`Settings` 新增：

```ts
deepseekThinking: boolean;
```

| 位置 | 行为 |
| --- | --- |
| `src/core/types.ts` | 类型定义，见 `deepseekModel` 之后 |
| `src/core/defaults.ts` | `deepseekThinking: false` |
| `src/core/settingsNormalize.ts` | 只有真正的 `true` 才保留，字符串、`1`、缺省值全部回落为 `false` |
| 旧版本升级 | `store` 用 `DEFAULT_SETTINGS` 深合并，缺字段自动补 `false`，无需迁移脚本 |
| 重置偏好 | `resetSettings()` 使用默认值，开关回到关闭 |
| WebDAV 同步 | **不同步**。`settingsSync.ts` 只同步 `sourceLang / targetLang / learningLang`，模型与引擎配置按现有策略保持设备本地 |
| 设置导出 / 导入 | 导出的是整个 `settings` 对象，字段会自动带上；导入经 `replaceSettings()` + `normalizeSettings()` 清洗 |

### 3.3 请求参数

`AiConfig` 新增可选字段：

```ts
thinking?: 'enabled' | 'disabled';
```

`deepseekConfig(key, model, timeoutMs, thinking = false)` 总是显式设置该字段：

- `thinking = false` → `thinking: 'disabled'`
- `thinking = true` → `thinking: 'enabled'`

`chat()` 与 `aiAnalyzeSentence()` 在请求体中按需注入：

```json
{
  "model": "deepseek-flash",
  "temperature": 0.2,
  "stream": false,
  "thinking": { "type": "disabled" },
  "messages": [ ... ]
}
```

说明：

- 关闭时**必须显式发 disabled**，因为 DeepSeek 服务端默认是开启；省略字段等于继续开思考。
- 开启时只发 `enabled`，不带 `reasoning_effort`，即使用 DeepSeek 默认强度 `high`。若以后要提供强度选择，在 `AiConfig` 增加 `reasoningEffort` 并在同一请求体注入即可，协议位置是顶层 `reasoning_effort`。
- 其他引擎的 `AiConfig.thinking` 为 `undefined`，请求体保持原样，不会误加字段。

### 3.4 装配链路

```
Settings.deepseekThinking
   └─> translateWithProvider()            (src/core/translate/index.ts)
        └─> deepseekConfig(key, model, timeoutMs, thinking)
             └─> AiConfig.thinking
                  ├─> chat()              字幕 / 标题翻译
                  └─> aiAnalyzeSentence() 句子分析
```

播放器的句子分析走 `getConfiguredAiConfig()`（`app/player.tsx`），DeepSeek 分支同样读取 `currentSettings.deepseekThinking`；没有选中 DeepSeek 时会回落到其他已配置引擎，那些引擎不带该字段。

### 3.5 缓存策略

缓存目的是避免重复付费，因此开关与缓存的关系按「关闭不失效、开启独立命名空间」处理：

| 场景 | 缓存作用域 |
| --- | --- |
| DeepSeek + 关闭思考（默认） | `deepseek:<model>`，与改造前的 key **逐字节一致** |
| DeepSeek + 开启思考 | `deepseek:<model>:thinking` |
| 自动模式 + 关闭思考 | `auto:{d,s,r,b,m,f,p}`，与改造前一致 |
| 自动模式 + 开启思考 | 上述对象增加 `t: true` |

设计理由：

- 默认关闭是本次发版的默认状态，如果改变 key，所有用户已缓存的 DeepSeek 字幕都会一次性失效并被重新翻译，反而制造一次明显变慢。保持 key 不变可以让升级当天继续命中旧缓存。
- 开启思考代表用户主动追求质量，此时使用独立命名空间，避免与关闭状态的译文混用；关闭回去时仍可复用原来的缓存。
- 标题缓存复用同一个 `providerCacheScope()`，因此同样区分；`useFeed` 的 `titleScopeOf` 已加入该字段，开启/关闭后会触发标题重新翻译。
- 历史包袱说明：升级前生成的旧缓存是在「思考默认开启」状态下产出的。默认关闭后这些缓存仍然可用。若希望用关闭思考的新结果覆盖，使用播放器菜单里的「重新翻译字幕」（会清掉该视频的 `cues:v3` / `cues:v4` 缓存）。

### 3.6 UI

`app/settings/translation.tsx` 的 DeepSeek 配置块中，模型输入框后插入复用组件 `SettingRow`：

- 组件已存在，与「翻译策略」卡片同一套视觉，不引入新样式。
- `value={settings.deepseekThinking}`，`onChange` 走 `patchSettings`，立即写入本地 store。
- 该页顶部「保存」只负责 API Key 的 SecureStore 写入，设置项本身无需再点保存。

### 3.7 涉及文件清单

| 文件 | 改动 |
| --- | --- |
| `src/core/types.ts` | `Settings` 增加 `deepseekThinking: boolean` |
| `src/core/defaults.ts` | 默认 `false` |
| `src/core/settingsNormalize.ts` | 严格归一化为布尔，脏数据回落 `false` |
| `src/core/translate/ai.ts` | `AiConfig.thinking`；`chat()` / `aiAnalyzeSentence()` 注入 `thinking`；`deepseekConfig()` 增加第 4 个参数 |
| `src/core/translate/index.ts` | 翻译链路把 `settings.deepseekThinking` 传入 `deepseekConfig()` |
| `src/core/translate/cacheKey.ts` | 开启思考时增加独立缓存命名空间 |
| `src/hooks/useFeed.ts` | 标题翻译作用域加入 `deepseekThinking` |
| `app/player.tsx` | 句子分析的 DeepSeek 配置传入开关 |
| `app/settings/translation.tsx` | 新增「思考模式（深度思考）」开关行 |
| `scripts/test-deepseek-thinking.mjs` | 新增请求体单元测试 |
| `scripts/test-settings-normalize.mjs` | 增加默认值 / 脏数据断言 |
| `scripts/test-translation-cache-key.mjs` | 增加缓存命名空间断言 |

### 3.8 本次不做的事

- 不给 SiliconFlow、OpenRouter、OpenAI 兼容增加思考开关。它们的参数形状不同（`enable_thinking` / `reasoning.effort` / 仅特定模型支持 `reasoning_effort`），需要逐家确认，不能复用同一个字段。
- 不提供思考强度（low / high / max）选择。开启即使用服务端默认 high。
- 不改变批大小、并发、翻译顺序、超时与重试策略，见第 6 节。

---

## 4. 预期效果

| 维度 | 关闭思考（默认） | 开启思考 |
| --- | --- | --- |
| 单批请求 | 直接输出 JSON 译文 | 先输出思维链，再输出 JSON |
| 单批耗时（估算） | 1～3 秒量级 | 5～15 秒量级，长批更久 |
| token 费用 | 只有译文与提示词 | 额外支付 `reasoning_content` |
| temperature 0.2 | 生效 | 被服务端忽略 |
| 20 秒超时风险 | 低 | 高，可能触发重试与拆批 |
| 适合场景 | 日常追剧、批量字幕 | 术语密集、俚语多、追求质量的单段翻译 |

---

## 5. 验证记录

### 5.1 自动脚本（已通过）

在 `mobile` 目录执行：

```
node scripts/test-deepseek-thinking.mjs
node scripts/test-settings-normalize.mjs
node scripts/test-translation-cache-key.mjs
node scripts/test-settings-sync.mjs
node scripts/test-auto-translation-order.mjs
```

结果：

- `deepseek-thinking: 6 assertions passed`
  - 关闭时请求体为 `thinking: { type: "disabled" }`
  - 开启时为 `thinking: { type: "enabled" }`
  - 非 DeepSeek 自定义配置不会被注入字段
  - `aiAnalyzeSentence()` 与翻译共用开关
- `settings-normalize: 30 assertions passed`
- `translation-cache-key: 15 assertions passed`，包含「关闭保持旧 key」「开启独立命名空间」「自动模式区分」三条新增断言
- `settings-sync: 13 assertions passed`
- `auto-translation-order: 13 assertions passed`

### 5.2 类型检查（已通过）

在 `mobile` 目录执行：

```
npm run typecheck
```

当前无报错。第 6 节实测时，`app/subscriptions.tsx` 的 `dragScrollDeltaRef` 引用也已随该文件改动移除，不再是阻塞项。

### 5.3 真机手动验收

1. 打开「翻译引擎 → DeepSeek」，确认「思考模式（深度思考）」默认灰色（关闭）。
2. 抓包或临时打印请求体，确认包含 `"thinking":{"type":"disabled"}`。
3. 同一视频、同一模型，对比升级前后「当前画面出现译文」的时间与全部翻完时间；预期明显缩短，且不再频繁出现 20 秒超时。
4. 打开开关后重试同一请求，确认变为 `"thinking":{"type":"enabled"}`；关闭开关后缓存仍能命中（同一视频再次打开无需重新请求）。
5. iOS 与 Android 各跑一遍上述 1～4。

### 5.4 第 6 节速度优化自动验证（已通过）

在 `mobile` 目录执行：

```
npm run typecheck
node scripts/test-cue-schedule.mjs
node scripts/test-cue-translation-scheduler.mjs
node scripts/test-ai-retry.mjs
node scripts/test-async-timeout.mjs
node scripts/test-deepseek-thinking.mjs
node scripts/test-auto-translation-order.mjs
node scripts/test-translation-cache-key.mjs
```

结果：

- `typecheck` 无报错。
- `cue-schedule: 6 assertions passed`：固定批范围、锚点定位、前向优先。
- `cue-translation-scheduler: 4 checks passed`：锚点批次先发、并发上限 2、乱序完成后按原索引回填、最终缓存快照完整；播放中跳转只重排未开始的批次；空白字幕行不会发给模型；供应商少返回几行时不会无限重试同一批。
- `ai-retry: 5 checks passed`：401 不重试、5xx 有界重试、超时立即拆半批且顺序不变、条数不匹配立即拆批且不原样重放、429 不立即重试。
- 其余既有测试全部通过（异步超时、DeepSeek thinking、引擎顺序、缓存 key）。

---

## 6. 后续速度优化（已于 2026-11-25 实现）

| 项目 | 实现结果 |
| --- | --- |
| 6.1 当前播放位置优先 | `TranslateOptions.anchorTime` + `getAnchorTime`；`player.tsx` 传入实时播放位置。选中批次先翻，然后向前扫完，最后补前面缺口；跳转只影响尚未开始的批次。 |
| 6.2 批大小 | `TRANSLATE_BATCH_SIZE = 12`。 |
| 6.3 有限并发 | 固定 2 路 worker；按原索引回填；缓存写入串行化，避免旧快照覆盖新译文；跳转不会取消在途请求，最多浪费 2 批。 |
| 6.4 超时与重试 | 超时不再原样重打，直接拆成两半；单批总预算 = 请求超时 + 8 秒拆批宽限；429 不立即重试，交给引擎回退链；调度层仅对一次 429/5xx 做延迟 2 秒的整批重试，超时不整批重试。模型返回条数不匹配时不做原样重试，直接拆批；条数错误最多递归拆 3 层；空白字幕行不发给模型。 |
| 6.5 流式 | 未启用。整批 JSON 协议下收益有限，保持 `stream: false`。 |

### 6.1 当前播放位置优先翻译

**现状**：`translateCueList()` 永远从索引 0 开始顺序翻；用户拖到 30 分钟处，仍要等前面全部批次。

**方案**：

- `TranslateOptions` 增加 `anchorTime?: number`（或 `anchorIndex?: number`）。
- `player.tsx` 调用时传入当前播放时间；`translateCueList()` 先计算锚点附近窗口（例如前后各 16 条），先翻这个窗口，再按原顺序补全其余。
- 已翻译的条目继续跳过；进度回调仍按全片计数。

**风险**：缓存与顺序回填必须按原索引，不能打乱数组；频繁拖动会产生多次窗口请求，需要去重与取消。

**验收**：拖到任意进度后，当前字幕在 1～2 个批次内出现译文；全片最终覆盖完整。

### 6.2 批大小从 8 调到 12～16

**现状**：`TRANSLATE_BATCH_SIZE = 8`，请求数多，system prompt 重复次数多。

**方案**：改为 12～16，配合 `maxChars` 上限；首屏窗口可继续保持 8 条，避免第一批等待变长。

**风险**：单批更长，超时概率上升；需与关闭思考一起上线。

**验收**：总请求数下降约 30%～50%，全片总时间下降，条数与顺序不变。

### 6.3 有限并发（2～3 路）

**现状**：`translateCueList()` 的 `for` 循环严格串行。

**方案**：固定并发窗口 2～3，完成一批即按索引回填并写缓存；`shouldStop` 每批检查；失败批次进入重试队列，不要整片 `Promise.all`。

**风险**：DeepSeek 有 RPM/TPM 限制，并发过高会 429，重试反而更慢更贵；移动网络抖动时并发收益不稳定。

**验收**：同一视频总时间约降到 1/2～1/3；日志无 429 激增；缓存与顺序正确。

### 6.4 超时与重试策略

**现状**：20 秒超时后原样重试一次，再拆成 4 条小块。

**方案**：

- 区分错误类型：超时不再原样重打，直接拆小批；429 只做退避，不立即重试。
- 给单批设置总预算，避免「20 秒 + 20 秒 + 拆批」叠乘。
- 关闭思考后 20 秒通常够用，不必盲目下调默认值；可在设置页暴露超时，已支持 5000～120000。

**验收**：异常网络下不会出现单批 40 秒以上空等；失败可恢复。

### 6.5 流式返回（可选项，优先级最低）

**现状**：`stream: false`，必须等完整 JSON 数组才能解析。

**结论**：仅打开 `stream: true` 对「整批 JSON」协议帮助有限，因为数组未闭合前无法解析；若要收益，需要把协议改成逐行 JSON/NDJSON，属于另一项改造。流式不增加 token 费用，只是传输方式变化，不建议优先做。

---

## 7. 风险与回滚

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| `thinking` 字段被旧模型拒绝 | 用户手动填写了不支持思考开关的旧模型名 | 设置页填写的是 DeepSeek 官方模型；如遇到 400，改回 `deepseek-flash` 或关闭开关 |
| 旧缓存沿用 | 升级前缓存的译文是思考开启时产出的 | 需要时用「重新翻译字幕」覆盖；不会造成功能错误 |
| 开关不同步 | 换设备后回到默认关闭 | 与现有模型/引擎配置策略一致，属预期行为 |
| 回滚 | 撤销本次改动 | 删除 `deepseekThinking` 字段与 UI 行，`deepseekConfig` 第 4 参数去掉，`chat/analyze` 的注入行删除；缓存 key 的 `:thinking` 分支删除即可，旧 key 不受影响 |

---

## 8. 附录

### 8.1 DeepSeek 接口事实

- 思考开关（OpenAI 格式）：`{"thinking": {"type": "enabled" | "disabled"}}`
- 思考强度：顶层 `reasoning_effort`，支持 `low / high / max`（其他值会映射）
- 默认行为：**thinking 默认开启，默认 effort = high**
- 思考模式下 `temperature`、`presence_penalty`、`frequency_penalty` 不生效
- 思维链通过 `reasoning_content` 与 `content` 同级返回
- 官方文档：<https://api-docs.deepseek.com/guides/thinking_mode/>

### 8.2 关键代码位置

| 内容 | 位置 |
| --- | --- |
| 设置字段 | `src/core/types.ts`，`deepseekModel` 之后 |
| 默认值 | `src/core/defaults.ts`，`deepseekThinking: false` |
| 归一化 | `src/core/settingsNormalize.ts`，`deepseekThinking: settings.deepseekThinking === true` |
| 思考字段注入 | `src/core/translate/ai.ts`，`chat()` / `aiAnalyzeSentence()` 的 body |
| DeepSeek 配置 | `src/core/translate/ai.ts`，`deepseekConfig()` |
| 翻译链路传参 | `src/core/translate/index.ts`，`translateWithProvider()` |
| 缓存作用域 | `src/core/translate/cacheKey.ts`，`providerCacheScope()` |
| 标题作用域 | `src/hooks/useFeed.ts`，`titleScopeOf()` |
| 播放器分析传参 | `app/player.tsx`，`getConfiguredAiConfig()` |
| 设置 UI | `app/settings/translation.tsx`，DeepSeek 配置块与 `SettingRow` |
| 批处理调度 | `src/core/translate/schedule.ts`，`translateCueList()` 的 2 路 worker |
| 批大小 | `src/core/translate/index.ts`，`TRANSLATE_BATCH_SIZE = 12` |
| 超时 | `src/core/http.ts`，`httpText()`；默认值 `src/core/defaults.ts` |

### 8.3 术语

- **思考模式 / 深度思考**：模型先输出推理过程（`reasoning_content`），再输出最终答案。
- **reasoning_effort**：思考强度，DeepSeek 支持 low / high / max。
- **SSE / 流式**：服务端边生成边推送，和「一次性返回完整 JSON」相对。
- **缓存作用域**：缓存 key 中用于区分引擎、模型、参数的一段字符串；作用域不同即视为不同缓存。
