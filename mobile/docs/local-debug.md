# 本地真机调试指南（Android）

这份文档记录 Ki​​ssly 在本地真机上的构建、热更新和调试流程。它不依赖特定的 AI agent
工具——只要执行者能运行 shell、能访问 adb，就可以复用。配套脚本在
[`scripts/dev/`](../scripts/dev/)：

- `device.sh`：adb 封装（截图/点击/日志/重启/深链/转发 WebView 调试端口）
- `cdp.mjs`：WebView 的 Chrome DevTools Protocol 客户端（执行 JS/抓网络/看 console）

> 这些脚本只用于开发调试，不会打进 App。WebView CDP 只在 **debug 构建** 中可用。

## 1. 前提

- Android SDK（`platform-tools`、`build-tools`、CMake）
- JDK 17+（Gradle 9 需要；JDK 8 会直接失败）
- Node.js（项目已 `npm install`）
- 一台开启 USB 调试的 Android 设备（小米/HyperOS 还需要开启“USB 调试（安全设置）”）

常用环境变量：

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"          # Windows Git Bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

adb devices -l
```

Linux/macOS 把 `ANDROID_HOME` / `JAVA_HOME` 换成对应路径即可。

## 2. 一次性构建 debug 包

```bash
cd mobile

# 只构建当前手机需要的 ABI，能明显缩短编译时间
ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a \
  npx expo run:android --device <设备序列号> --no-bundler
```

- 不能用 Expo Go：项目包含本地原生模块 `modules/kissly-system-translate`。
- `--no-bundler` 让构建命令结束后退出；Metro 在第 3 步单独启动。
- 项目 release 和 debug 都使用 `android/app/build/outputs/apk/debug/app-debug.apk`
  的 debug keystore 签名，所以 `adb install -r` 可以覆盖安装并保留数据。
- 原生代码/`app.json`/插件改动后需要重新构建；只改 JS 不需要。

### Windows 构建常见问题

**路径超过 260 字符**：

```
ninja: error: mkdir(CMakeFiles/worklets.dir/C_/Users/.../Networking): No such file or directory
```

解决：把 SDK 里 CMake 3.22.1 自带的 Ninja 1.10.2 换成 4.1.2 自带的 1.12.1（先备份）：

```bash
SDK="$LOCALAPPDATA/Android/Sdk"
cp "$SDK/cmake/3.22.1/bin/ninja.exe" "$SDK/cmake/3.22.1/bin/ninja.exe.1.10.2.bak"
cp "$SDK/cmake/4.1.2/bin/ninja.exe" "$SDK/cmake/3.22.1/bin/ninja.exe"
"$SDK/cmake/3.22.1/bin/ninja.exe" --version   # 1.12.1
```

**Google Maven 无法访问**（`dl.google.com` 超时/SSL 失败）：

用 init script 注入国内镜像，不改仓库文件：

```groovy
// /path/to/aliyun.init.gradle
allprojects {
  repositories {
    maven { url 'https://maven.aliyun.com/repository/google' }
    maven { url 'https://maven.aliyun.com/repository/public' }
  }
}
```

```bash
cd mobile/android
./gradlew app:assembleDebug -x lint -x test \
  -PreactNativeArchitectures=arm64-v8a \
  -PreactNativeDevServerPort=8081 \
  --init-script /path/to/aliyun.init.gradle
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 3. 热更新（日常迭代）

```bash
cd mobile
npx expo start --port 8081        # 不要加 CI=1
adb reverse tcp:8081 tcp:8081
adb shell am start -n com.knny.kisssubtitle/.MainActivity
```

改 `app/*.tsx`、`src/**/*.ts` 后，Metro 自动重打包，手机上 Fast Refresh 立即生效
（首次约 10–15 秒，之后通常 100ms 内）。

注意事项：

- **不要设置 `CI=1`**，否则 Metro 进入 CI 模式，文件监听和热更新会被禁用。
- Fast Refresh 不会重新执行已经注入到 WebView 的 `playerBridgeScript`。改 bridge 后需要
  重载 WebView：
  - 简单：`bash scripts/dev/device.sh reload` 或重进播放页
  - 精确：`node scripts/dev/cdp.mjs reload`
- debug 包性能低于 release；判断“卡不卡”最好最终用 release 包复核。

## 4. 常用真机操作

```bash
bash scripts/dev/device.sh devices
bash scripts/dev/device.sh screenshot /tmp/screen.png
bash scripts/dev/device.sh tap 500 1200
bash scripts/dev/device.sh logs 500
bash scripts/dev/device.sh reload
bash scripts/dev/device.sh open "player?videoId=4i4TqW9LR2Q"
```

配合 agent 使用时，`screenshot` 的输出图片可以直接交给能读图的模型；`logs` 用来抓
React Native 和 WebView 的 console/崩溃。

## 5. WebView 内部调试（CDP）

debug 构建会自动开启 WebView 调试。每次 App 重启后 pid 会变，需要重新 forward：

```bash
bash scripts/dev/device.sh forward
# 输出 http://127.0.0.1:9222/json 和当前页面列表
```

然后：

```bash
node scripts/dev/cdp.mjs targets
node scripts/dev/cdp.mjs eval "document.title"
# 同时存在多个 WebView（账户页 + 播放器）时用 --match 选择
node scripts/dev/cdp.mjs eval "document.title" --match youtube.com/watch
node scripts/dev/cdp.mjs eval "(()=>{const v=document.querySelector('#movie_player video');return JSON.stringify({paused:v.paused,ct:v.currentTime})})()"
node scripts/dev/cdp.mjs reload
node scripts/dev/cdp.mjs navigate "https://m.youtube.com/watch?v=4i4TqW9LR2Q"
node scripts/dev/cdp.mjs net 10          # 重载并抓失败请求
node scripts/dev/cdp.mjs console 10      # 监听 10 秒 console/异常
```

`eval` 默认带 `userGesture: true`，所以在页面里调用 `video.play()` 等是被允许的；
`awaitPromise` 也默认开启，可以直接写 `(async()=>{...})()`。

典型用途：

- 读取真实播放状态：`video.paused`、`player.getPlayerState()`、`currentTime`
- 拦截 `HTMLMediaElement.prototype.pause`，用调用栈定位“谁在暂停”
- 注入采样器，记录旋转/全屏过程中的状态变化
- 用 `Network.enable` 定位到底哪个域名/请求失败（例如 gstatic 连不上）
- 用 `Page.reload` / `Page.navigate` 在不重启 App 的情况下重载页面

人类也可以直接在电脑 Chrome 打开 `chrome://inspect` 查看同一个 WebView。

## 6. 在其他 AI agent 平台复用

需要的能力：

1. 执行 shell 命令（adb、node）
2. 编辑本地项目文件
3. 可选：后台长时间运行进程（Metro）
4. 能访问手机（USB 本地设备，或云端模拟器/设备云）

分场景：

- **本地 agent（Cursor、Codex CLI、Claude Code、Gemini CLI 等）**：直接使用本文流程。
  把本文或 `AGENTS.md`/`CLAUDE.md` 的指针给它即可。
- **agent 不能常驻进程**：由人类在终端里跑 Metro，agent 只改文件 + 调
  `device.sh`/`cdp.mjs`。热更新仍然有效。
- **纯云端 agent**：它看不到你的 USB 设备。需要在云端启动 Android 模拟器（AVD）并让
  agent 在同一个容器里执行 adb；或接入 Firebase Test Lab / AWS Device Farm /
  BrowserStack 等设备云。模拟器适合功能验证，播放流畅度仍建议真机。

给 agent 的最小提示词可以是：

> 项目是 Expo + React Native Android。Metro 已在 8081 运行，debug 包已安装。
> 改完 JS 后：用 `bash scripts/dev/device.sh screenshot` 看画面，用
> `device.sh logs` 看日志；WebView 内部问题先 `device.sh forward`，再用
> `node scripts/dev/cdp.mjs eval/..."` 检查页面。改 WebView 注入脚本后需要 reload。

## 7. 常见问题

| 现象 | 原因/处理 |
| --- | --- |
| `Unable to load script` 红屏 | Metro 没启动或 `adb reverse` 丢失：先启动 Metro，再 `device.sh reload` |
| 热更新不生效 | 检查是否设置了 `CI=1`；改的是 WebView 注入脚本时需要重载 WebView |
| `adb devices` 看不到设备 | 换数据线/端口，确认 USB 调试和“USB 调试（安全设置）”已开 |
| `device.sh forward` 后 `/json` 为空 | App/WebView 未显示，或 App 重启后 pid 变了，重新 forward |
| `dl.google.com` 超时 | 使用阿里云 init script，或改用 GitHub Actions 构建 |
| Gradle 报 JDK 版本错误 | `JAVA_HOME` 指向 JDK 8；改成 Android Studio 的 JBR 21 或安装 JDK 17 |
| ninja `mkdir ... No such file` | Windows 260 字符限制：换 Ninja 1.12.1（见第 2 节） |

## 8. 安全提醒

- debug 包开启了 WebView 调试，不要发布 debug 包。
- adb 权限等同于设备控制权，只在可信电脑上使用。
- 不要把 keystore、`.env`、cookie 导出文件提交到仓库。
