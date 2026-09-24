# 打包与发布方法（VirtuGene-Mobile Android）

给负责打包的人 / AI 助手看的操作手册。全部命令都在 **PowerShell** 下、在项目根目录执行。
本项目另外有一份技能说明 `dsi-publish-virtugene-mobile`（构建 → 改版本 → `git credential fill` 取 token → 发 GitHub Releases），本文档是它的落地细节版，并补上 Windows 上 Gradle 缓存锁冲突的排查方法。

---

## 0. 一句话方法

```
先删旧产物 → cap sync → gradlew assembleRelease（离线）→ 核对包内版本与签名 → 再发 Release
```

发布脚本会**复用已存在的 release APK**，所以"先删旧产物"不是可选项。

---

## 1. 环境前提（本机实测值，缺一个就会失败）

| 项目 | 期望值 | 缺失时的报错 |
| --- | --- | --- |
| Node | `C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64`（在 PATH 里） | `vite`/`cap` 找不到 |
| JDK | `D:\Java\jdk-21`（`JAVA_HOME`） | `Unsupported class file major version` |
| Gradle 缓存 | `%USERPROFILE%\.gradle`（已预热：wrapper 发行包 + `caches\8.14.3`） | 卡在下载 / 移动缓存被拒 |
| Android SDK | `C:\Users\34568\AppData\Local\Android\Sdk` | `SDK location not found` |
| `android\local.properties` | `sdk.dir=C\:\\Users\\34568\\AppData\\Local\\Android\\Sdk` | 同上（**gitignore 文件，新 worktree 里没有**） |
| build-tools | `...\build-tools\36.0.0\aapt2.exe`、`apksigner.bat` | 无法核对版本/签名 |
| 签名密钥 | `%USERPROFILE%\.android\debug.keystore`（alias `androiddebugkey`） | release 变体不签名 |

已内置在仓库里、不需要额外配置的：`android/app/build.gradle` 的 `signingConfigs.release`
（用上面那把密钥库、路径从 `~` 推导），`scripts/gh-release.mjs`（发布），
`package.json` 的 `mobile:sync` / `mobile:release` / `release`。

---

## 2. 打包命令

```powershell
# 0) 只在当前终端设好环境；不要设 GRADLE_USER_HOME，留空即用 %USERPROFILE%\.gradle
$env:PATH = "C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64;$env:PATH"
$env:JAVA_HOME = "D:\Java\jdk-21"
Set-Location F:\VirtuGene-Mobile

# 1) 关键：先删掉旧的 release 产物（否则发布脚本会复用它）
Remove-Item android\app\build\outputs\apk\release\app-release.apk -Force -ErrorAction SilentlyContinue

# 2) 前端构建 + 同步到 Android 工程
npm run mobile:sync
#    等价于：node_modules\.bin\vite.cmd build  然后  node_modules\.bin\cap.cmd sync android

# 3) Android release 构建（先停守护进程，再离线构建）
Push-Location android
.\gradlew.bat --stop
.\gradlew.bat assembleRelease --offline --console=plain
Pop-Location
```

产物：`android\app\build\outputs\apk\release\app-release.apk`（约 3.9 MB）

为什么加 `--offline`：本机 `%USERPROFILE%\.gradle\wrapper\dists` 已有 gradle-8.14.3，
离线可避免网络抖动，也避免 Gradle 去碰不该碰的目录。

### 构建后必须核对（不核对就等于没打包）

```powershell
$bt = "C:\Users\34568\AppData\Local\Android\Sdk\build-tools\36.0.0"
$apk = "android\app\build\outputs\apk\release\app-release.apk"

# ① 包内版本号必须等于这次要发的版本
& "$bt\aapt2.exe" dump badging $apk | Select-String '^package'
#   期望：versionCode='29' versionName='5.2.2'

# ② 签名证书必须还是老用户装的那一把（变了就无法覆盖升级，用户得先卸载 → 本地数据全丢）
& "$bt\apksigner.bat" verify --print-certs $apk | Select-String 'SHA-256 digest'
#   期望：ef38a01c9c1674a53537330e6de7ed6e3de86359715bc9c61af53ffc9de04016

# ③ 记下哈希，发布后要拿线上的包回来对
Get-FileHash $apk -Algorithm SHA256
```

---

## 3. Gradle 缓存锁冲突排查（"移动缓存被系统拒绝"这一类）

先认清症状属于哪一种，再对症下药：

| 报错关键字 | 真实含义 |
| --- | --- |
| `Timeout waiting to lock ...`、`Timeout waiting to lock daemon addresses registry` | 有另一个进程占着同一份缓存 |
| `Could not move temporary workspace ... to immutable location` | 缓存目录被占用或不可写，Gradle 无法把临时目录改成正式目录 |
| `Could not move file`、`Cannot create directory`、`Access is denied` | 目标路径没写权限（沙箱/ACL/网盘同步目录） |
| `SDK location not found` | 缺 `android/local.properties`（不是锁的问题） |

按可能性从高到低处置：

1. **`GRADLE_USER_HOME` 指到了不该指的地方。**
   指到 `%TEMP%`、网盘/OneDrive 同步目录、随容器销毁的目录、或沙箱允许写范围之外的路径时，
   Gradle 走到"把临时 workspace 移动成正式缓存"这一步就会被系统拒绝。
   **处置**：`Remove-Item Env:\GRADLE_USER_HOME`（或显式设为 `$env:USERPROFILE\.gradle`）后重跑。
   这一条最常命中"前端已成功、Android 编译器移动缓存被拒"的组合。

2. **两个构建同时用一份缓存。** 比如一边 `assembleDebug` 一边 `assembleRelease`，
   或者上一次构建被 Ctrl+C 中断后 daemon 还活着。
   **处置**：
   ```powershell
   Push-Location android; .\gradlew.bat --stop; Pop-Location
   Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force
   ```
   然后**串行**重跑。确实需要并行，就用 `-g <另一个目录>` 给第二个构建单独的 Gradle home。

3. **上次中断留下的锁文件/临时残骸。**
   **处置**（只删这几处，**不要删整个 `.gradle`**，否则要重新下载 Gradle 发行包）：
   ```powershell
   Remove-Item "$env:USERPROFILE\.gradle\daemon\8.14.3" -Recurse -Force -ErrorAction SilentlyContinue
   Remove-Item "$env:USERPROFILE\.gradle\caches\8.14.3\transforms" -Recurse -Force -ErrorAction SilentlyContinue
   Remove-Item "$env:USERPROFILE\.gradle\caches\journal-1" -Recurse -Force -ErrorAction SilentlyContinue
   Remove-Item "F:\VirtuGene-Mobile\android\.gradle" -Recurse -Force -ErrorAction SilentlyContinue
   ```
   这些目录都会自动重建，删了不会丢依赖（依赖在 `caches\modules-2`，不要动）。

4. **杀毒软件 / 索引器占着句柄。** 把 `%USERPROFILE%\.gradle` 和项目 `android\` 目录
   加进实时防护排除项。

5. **路径本身有问题**：含中文、空格、超长、或在 `OneDrive` 下。
   换纯 ASCII 短路径（例如 `F:\VirtuGene-Mobile`）。

6. **权限/账户不一致**：一次用管理员、一次用普通用户混着跑，锁文件 owner 会不同。
   统一同一个账户；项目盘与缓存盘都要有写权限。

7. **兜底：绕过 wrapper。** 如果 wrapper 仍试图下载发行包：
   ```powershell
   & "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\gradle-8.14.3\bin\gradle.bat" -p android assembleRelease --offline
   ```

> 顺便提醒：**不要在打包环境里改项目代码**。上面的清理动作只针对缓存目录，
> 不碰 `src/`、`android/app/`、`package.json`。

---

## 4. 改版本号要动 4 个地方（缺一处就会出现"更新了但版本没变"）

| 文件 | 改什么 |
| --- | --- |
| `package.json` | `"version": "5.2.2"` |
| `android/app/build.gradle` | `versionCode` **必须 +1**（当前 29），`versionName` 同步 |
| `src/lib/changelog.ts` | 顶部加一条 `{ version, date, notes }`，用户在 App 内看得到 |
| `src/lib/update-config.ts` | 保持裸标识符 `__APP_VERSION__`（**不能加引号**，否则 Vite 不替换，热更新失效） |

`__APP_VERSION__` 由 `vite.config.ts` 的 define 注入，值来自 `package.json` 的 version，
所以改完 `package.json` 后必须**重新 `npm run mobile:sync`**，不能只重跑 Gradle。

---

## 5. 发布

```powershell
# 脚本自己会用 git credential fill 取 token；只有在 CI 里才设 GITHUB_TOKEN
node scripts\gh-release.mjs 5.2.2
```

脚本行为（`scripts/gh-release.mjs`）：

- 产物路径固定 `android/app/build/outputs/apk/release/app-release.apk`；
- **如果这个文件已存在就直接复用**（第 2 节第 1 步必须删旧产物就是因为这个）；
- 不存在才去跑 `npm run mobile:release`；
- 创建 tag `v5.1.1` 的 Release（`draft:false`、`prerelease:false`），已存在则复用该 Release；
- 资产名固定 `app-release.apk`（App 内更新取"第一个 `.apk` 资产"，名字不能变）。

### 发布后必须核对 5 项（"推送成功"不等于"用户能更新"）

```powershell
$repo = 'wzy6789/VirtuGene-Mobile'
# ① /releases/latest 是否已指向新 tag
# ② 资产是否存在、大小是否与本地一致
# ③ 把线上的包下载回来，SHA-256 与本地一致（逐字节）
# ④ aapt2 dump badging 线上包的 versionName == tag（这一步专门拦"发布了旧包"）
# ⑤ apksigner 的证书 SHA-256 仍是 ef38a01c…（否则老用户无法覆盖升级）
```

第 ④ 步不是多余的：**这个陷阱在 5.1.0 → 5.1.4 每一轮都真实踩到过**。
`android/app/build/outputs/apk/release/app-release.apk` 不会被改版本号这件事自动作废，
它一直是"上一次构建"的产物（5.1.0 那轮是 `2ededdbc…`，5.1.4 那轮开工时是 5.1.3 的 `4,084,231 B`）。
不删产物直接 `node scripts\gh-release.mjs <新版本>`，就会把旧包发成新 tag，
用户在 App 里会一直看到"有新版本"但装上去还是旧版本。
**结论：每次发版前先删 `app-release.apk`，发布后必须把线上包下载回来核对包内 versionName。**

---

## 6. 其他已知坑

- **不要把工程生成的文件提交进版本库**：`android/capacitor.settings.gradle`、
  `android/app/capacitor.build.gradle` 会被 `cap sync` 重写；
  如果 `node_modules` 是 junction/软链，它们会被写成指向别处的路径，提交上去别人就构建不了。
- **在 git worktree 里构建**：worktree 没有 `android/local.properties`（被 gitignore），
  必须手动建一个；`node_modules` 也要 junction 过去。构建完记得先 `rmdir`（不带 `/s`）断开
  junction 再删 worktree，否则会连真实 `node_modules` 一起删掉。
- **本机 `npm` 不一定在 PATH 里**：可以直接调 `node_modules\.bin\*.cmd`，或用 `node` 跑脚本。
- **别手动把 token 粘进脚本**：统一 `git credential fill`，避免泄露与过期。
- **给 PATH 加 node 时必须"前置"而不是"重写"**：本机 `git` 在 `E:\Git\cmd\git.exe`，
  如果你写 `$env:PATH = "…node-v22.16.0-win-x64"`（赋值而不是拼接），
  `gh-release.mjs` 里 `execSync('git credential fill')` 就会找不到 git，
  报 `'git' is not recognized…` 然后 `❌ 未获取到 GitHub token`。正确写法：
  `$env:PATH = "C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64;$env:PATH"`。
- **取 token 的兜底姿势**（不改脚本、不把 token 写进任何文件）：
  ```powershell
  $cred = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
  $env:GITHUB_TOKEN = ($cred | Where-Object { $_ -match '^password=' }) -replace '^password=',''
  node scripts\gh-release.mjs 5.2.2
  ```
  脚本优先用 `process.env.GITHUB_TOKEN`，环境变量只在当前这个 pwsh 进程里有效。
- **不要把 debug 包和 release 包混着发**：现在 release 变体已经会签名，发 `app-debug.apk`
  会让版本线混乱（5.0.4 是 debug，5.0.5 起是 release）。
- **改 UI/逻辑后要重新 `cap sync`**：只跑 Gradle 不会把新的 `dist/renderer` 打进 APK。

---

## 7. 可以直接交给 AI 助手的最短指令

> 在 `F:\VirtuGene-Mobile` 用 PowerShell 打包 Android release 包并发布 v5.2.2：
> 1) `$env:JAVA_HOME="D:\Java\jdk-21"`，**不要设 `GRADLE_USER_HOME`**（用默认 `%USERPROFILE%\.gradle`）；
> 2) 先删 `android\app\build\outputs\apk\release\app-release.apk`（发布脚本会复用旧产物）；
> 3) `npm run mobile:sync`，然后 `cd android; .\gradlew.bat --stop; .\gradlew.bat assembleRelease --offline`；
> 4) 用 `aapt2 dump badging` 确认 versionCode=29 / versionName=5.2.2，
>    用 `apksigner verify --print-certs` 确认证书 SHA-256 仍是 `ef38a01c…40:16`；
> 5) `node scripts\gh-release.mjs 5.2.2` 发布，然后把线上资产下载回来对 SHA-256 与包内 versionName。
> 若 Gradle 报 `Could not move temporary workspace` / `Timeout waiting to lock`：
> 先 `gradlew.bat --stop` 并结束残留 java 进程，只清 `~\.gradle\daemon\8.14.3`、
> `~\.gradle\caches\8.14.3\transforms`、`~\.gradle\caches\journal-1`、`android\.gradle`，
> 再串行重跑；不要删整个 `.gradle`，不要动项目源码。

---

## 8. 本机往 GitHub 推代码（IPv6 坏掉时的姿势）

这台机器到 GitHub 的 **IPv6 路径是坏的**（`curl -6` 直接失败、`curl -4` 正常），而 git 的 libcurl
不会回落到 IPv4，于是 `git push/fetch` 会报：

```
schannel: failed to receive handshake, SSL/TLS connection failed
TLS connect error: error:0A000126:SSL routines::unexpected eof while reading
```

`~/.ssh/config` 里 github 走本地代理 `connect -H 127.0.0.1:7897`，但那个端口目前 HTTP/SOCKS 都不通，
所以 SSH 方式也不行（直连 `ssh.github.com:443` 是 `Permission denied (publickey)`）。

**可行姿势**：用仓库里的 `scripts/ipv4-forward.mjs` 起一个只走 IPv4 的本地 CONNECT 转发，再让 git 走它：

```powershell
node scripts\ipv4-forward.mjs           # 默认监听 127.0.0.1:8443，保持开着
git -c http.proxy=http://127.0.0.1:8443 push origin main
git -c http.proxy=http://127.0.0.1:8443 ls-remote origin HEAD
```

TLS 仍然是 git ↔ GitHub 端到端。若哪天 IPv6 恢复，这段可以不用。
`scripts/deploy-site-github.mjs` 是另一条备选路（走 Git Data API，不需要 git 通道），
只在 git 完全推不动时才用。

---

## 9. 关于 Gitee（2026-09-24 试过又迁回，别再重复折腾）

当天做过一次"代码仓库 + 发行版 + 应用内更新全部迁到 Gitee"的尝试，**当天又迁回 GitHub**，
经验记在这里，免得下次又想迁：

- **Gitee 下载确实快很多**（本机实测同一个 4 MB 的 APK：Gitee ~700 KB/s、5.6 秒；
  GitHub 77–148 KB/s、27–52 秒），国内用户下载体验差距明显。
- **但 Gitee 的匿名 API 有频率限制**：反复调用 `/releases/latest` 后返回
  `403 Forbidden (Rate Limit Exceeded)`（带令牌才 200）。而应用内「检查更新」只能匿名调用，
  一旦撞上限流 `checkUpdate()` 会静默返回 null，用户看到的是"已是最新"——**更新通道不可靠**。
- 若将来要再迁，必须先解决这一点：例如每次发版把 `release.json`（版本号 + 附件直链 + sha256）
  写进仓库，让 App 先读 raw 文件（Gitee 的 raw 路由不限流，实测 0.49s）再退回 API。
- 另外 Gitee Pages 当前不可用，官网静态托管不能跟着代码仓库一起迁。
- 相关脚本（`gitee-release.mjs`、`save-gitee-token.ps1`）已从仓库删除，
  需要时用 `git log --diff-filter=D --name-only -- scripts` 找回。
