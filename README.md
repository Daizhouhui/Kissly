# Kissly

Kissly 是一个 Android / iOS 的 YouTube 双语字幕播放器：在 App 内播放视频，按句抓取字幕、翻译，并把收藏、订阅和历史留在本地。

- **发现 / 学习 / 我的** 三个 Tab
- **播放器**：观看页 WebView + 原生控制层，竖屏逐句稿、横屏沉浸字幕
- **学习**：收藏聚合、最近观看、历史记录
- **订阅**：频道 RSS、`@handle` / UC ID / CSV 导入
- **翻译**：微软 / 谷歌免费接口优先，可切 DeepSeek、SiliconFlow、OpenAI 兼容
- **同步**：WebDAV 合并订阅与设置

## 代码与构建

移动端代码在 [`mobile/`](mobile/README.md)，构建说明也在那里。GitHub Actions 会同时产出：

- Android：`app-release.apk`
- iOS：`Kissly-unsigned.ipa`（需要用 Sideloadly 自签）

推送 `main` 或手动触发 **Actions → Build Kissly apps** 即可。

## 目录

```text
mobile/    # Expo / React Native 应用（Android + iOS）
src/       # Kiss Translator 上游浏览器扩展代码（保留快照）
.github/   # 移动端构建 workflow
```

本仓库以当前可运行版本作为初始提交，不包含旧项目的提交历史。`src/` 等上游代码只作为参考与依赖保留，后续 App 开发集中在 `mobile/`。

## 上游与许可

移动端参考了 [Kiss Translator](https://github.com/fishjar/kiss-translator) 的桌面版思路，是独立实现。项目使用 GPL-3.0，原上游说明见 [`README.kiss-translator.md`](README.kiss-translator.md)。

字幕与翻译内容仅供个人学习使用，请尊重原视频版权。
