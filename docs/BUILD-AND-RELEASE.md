# 打包与发布方法（VirtuGene-Mobile Android · Gitee 渠道）

给负责打包的人 / AI 助手看的操作手册。全部命令都在 **PowerShell** 下、在项目根目录执行。

> **2026-09 起发布渠道已从 GitHub 迁到 Gitee**：代码主仓库 `gitee.com/wang-zhiyi6789/virtu-gene`，
> Android 安装包与应用内更新都走 Gitee 发行版。旧的 `scripts/gh-release.mjs`、`gh-upload-apk.mjs`
> 已删除；GitHub 上的历史 Release 仅作存档，官网只剩 Windows 端还指向那里。

---

## 0. 一句话方法

```
改 4 处版本号 → node scripts\gitee-release.mjs <版本> → 把线上附件下回来对版本、签名与 SHA-256
```

发布脚本**自己会重新构建**（vite build → cap sync → `gradlew assembleRelease`），所以不存在
"复用了上一次的旧 APK"这种坑；但它要求 `package.json`、`android/app/build.gradle` 的版本号
都已经改成目标版本，否则直接报错退出。

---

## 1. 环境前提（本机实测值，缺一个就会失败）

| 项目 | 期望值 | 缺失时的报错 |
| --- | --- | --- |
| Node | `C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64`（在 PATH 里） | `vite`/`cap` 找不到 |
| JDK | `D:\Java\jdk-21`（`JAVA_HOME`，本机已设为用户级变量） | `Unsupported class file major version` |
| Gradle 缓存 | `%USERPROFILE%\.gradle`（已预热：wrapper 发行包 + `caches\8.14.3`） | 卡在下载 / 移动缓存被拒 |
| Android SDK | `C:\Users\34568\AppData\Local\Android\Sdk` | `SDK location not found` |
| `android\local.properties` | `sdk.dir=C\:\\Users\\34568\\AppData\\Local\\Android\\Sdk` | 同上（**gitignore 文件，新 worktree 里没有**） |
| build-tools | `...\build-tools\36.0.0\aapt2.exe`、`apksigner.bat` | 无法核对版本/签名 |
| 签名密钥 | `%USERPROFILE%\.android\debug.keystore`（alias `androiddebugkey`） | release 变体不签名 |
| Gitee 私人令牌 | 存在本机 Git Credential Manager：`protocol=https, host=gitee.com, username=wang-zhiyi6789` | `请先把 Gitee 私人令牌存入本机 Git 凭据管理器` |

已内置在仓库里、不需要额外配置的：`android/app/build.gradle` 的 `signingConfigs.release`
（用上面那把密钥库、路径从 `~` 推导），`scripts/gitee-release.mjs`（发布），
`scripts/save-gitee-token.ps1`（存令牌），`package.json` 的 `mobile:sync` / `mobile:release` / `release`。

首次配置令牌：`pwsh -File scripts\save-gitee-token.ps1`（输入不回显，也不写进仓库）。

---

## 2. 打包命令（手动打包时用；发布脚本会自己做一遍）

```powershell
# 0) 只在当前终端设好环境；不要设 GRADLE_USER_HOME，留空即用 %USERPROFILE%\.gradle
$env:PATH = "C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64;$env:PATH"
$env:JAVA_HOME = "D:\Java\jdk-21"
Set-Location F:\VirtuGene-Mobile

# 1) 前端构建 + 同步到 Android 工程
npm run mobile:sync
#    等价于：node_modules\.bin\vite.cmd build  然后  node_modules\.bin\cap.cmd sync android

# 2) Android release 构建（先停守护进程，再离线构建）
Push-Location android
.\gradlew.bat --stop
.\gradlew.bat assembleRelease --offline --console=plain
Pop-Location
```

产物：`android\app\build\outputs\apk\release\app-release.apk`（约 3.9 MB）

为什么加 `--offline`：本机 `%USERPROFILE%\.gradle\wrapper\dists` 已有 gradle-8.14.3，
离线可避免网络抖动，也避免 Gradle 去碰不该碰的目录。发布脚本默认也走 `--offline`
（需要联网时设 `VIRTUGENE_GRADLE_ONLINE=1`）。

### 构建后必须核对（不核对就等于没打包）

```powershell
$bt = "C:\Users\34568\AppData\Local\Android\Sdk\build-tools\36.0.0"
$apk = "android\app\build\outputs\apk\release\app-release.apk"

# ① 包内版本号必须等于这次要发的版本
& "$bt\aapt2.exe" dump badging $apk | Select-String '^package'
#   期望（5.2.1）：versionCode='28' versionName='5.2.1'

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
   发布脚本里已经显式删掉了这个变量，所以走脚本不会踩到。

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
| `package.json` | `"version": "5.2.1"`（发布脚本拿它做校验） |
| `package-lock.json` | 顶部两处 `"version"` 同步（否则 `npm ci` 会觉得不一致） |
| `android/app/build.gradle` | `versionCode` **必须 +1**（当前 28），`versionName` 同步 |
| `src/lib/changelog.ts` | 顶部加一条 `{ version, date, notes }`，用户在 App 内看得到 |

`__APP_VERSION__` 由 `vite.config.ts` 的 define 注入，值来自 `package.json` 的 version，
所以在 `src/lib/update-config.ts` 里必须保持**裸标识符**（不能写成带引号的字符串），
且改完 `package.json` 后必须重新构建（`npm run mobile:sync` 或直接走发布脚本），不能只重跑 Gradle。

---

## 5. 发布到 Gitee

```powershell
$env:PATH = "C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64;$env:PATH"
node scripts\gitee-release.mjs 5.2.1
```

脚本行为（`scripts/gitee-release.mjs`）：

- 令牌优先取 `process.env.GITEE_TOKEN`，否则用 `git credential fill` 从本机凭据管理器读；
- **校验版本一致**：入参必须等于 `package.json` 的 version，且 `build.gradle` 里必须有
  `versionName "<版本>"`，否则直接退出；
- 若该 tag 的发行版**已经带 APK 附件**，报错拒绝覆盖（版本号不可回退，要发就递增版本）；
- 依次跑 `vite build` → `cap sync android` → `gradlew.bat assembleRelease --offline`
  （自动清掉 `GRADLE_USER_HOME`）；
- 建发行版（`tag_name=v<版本>`、`target_commitish=main`、body 里写 SHA-256），
  再把 `app-release.apk` 传到 `/releases/{id}/attach_files`；
- 成功时打印附件下载地址与 SHA-256。

### 发布后必须核对 5 项（"上传成功"不等于"用户能更新"）

```powershell
$repo = 'wang-zhiyi6789/virtu-gene'
# ① /releases/latest 是否已指向新 tag
# ② 附件是否真的存在：注意发布版对象里的 attach_files 常为空，要查 /releases/{id}/attach_files
# ③ 把附件下载回来，SHA-256 与本地一致（逐字节）
# ④ aapt2 dump badging 线上包的 versionName == tag（专门拦"发布了旧包"）
# ⑤ apksigner 的证书 SHA-256 仍是 ef38a01c…（否则老用户无法覆盖升级）
```

**第 ② 步的 Gitee 口径（写错过一次，这里记准）**：`GET /repos/{owner}/{repo}/releases/latest`
返回的 JSON 里**没有 `attach_files` 字段**，附件在 **`assets`** 数组里，而且 Gitee 会自动塞进
两个源码包：

```json
{"id":1164960,"tag_name":"v5.2.1","assets":[
  {"name":"app-release.apk",  "browser_download_url":"…/releases/download/v5.2.1/app-release.apk"},
  {"name":"v5.2.1.zip",       "browser_download_url":"…/archive/refs/tags/v5.2.1.zip"},
  {"name":"v5.2.1.tar.gz",    "browser_download_url":"…/archive/refs/tags/v5.2.1.tar.gz"}]}
```

三个要点：

1. **必须按 `.apk` 过滤**，否则会取到 zip / tar.gz（旧版本脚本就是这么写的，所以它一直是对的；
   曾误判成"要读 attach_files"，实际那个字段根本不存在）。
2. `assets[].size` 在 API 里是**空的**，不能用它核对体积 —— 要 HEAD 看 `content-length` 或下载回来量。
3. 另外两条同样可用的途径（作为兜底）：`GET /releases/{id}/attach_files` 接口，
   以及固定路径 `https://gitee.com/<owner>/<repo>/releases/download/<tag>/app-release.apk`。

手机端 `src/lib/mobile-update.ts` 与官网 `website/main.js` 都按"先读发行版对象（assets 优先，
按 `.apk` 过滤）→ 再查附件接口 → 最后退回固定路径"的顺序实现，任一步成功即可。

第 ④ 步也不是多余的：`android/app/build/outputs/apk/release/app-release.apk` 不会被改版本号
这件事自动作废，它一直是"上一次构建"的产物。发布脚本自己会重建，所以走脚本是安全的；
但如果是手动打包 + 手动上传，**必须把线上包下载回来核对包内 versionName**。

---

## 6. 其他已知坑

- **不要把工程生成的文件提交进版本库**：`android/capacitor.settings.gradle`、
  `android/app/capacitor.build.gradle` 会被 `cap sync` 重写；
  如果 `node_modules` 是 junction/软链，它们会被写成指向别处的路径，提交上去别人就构建不了。
- **在 git worktree 里构建**：worktree 没有 `android/local.properties`（被 gitignore），
  必须手动建一个；`node_modules` 也要 junction 过去。构建完记得先 `rmdir`（不带 `/s`）断开
  junction 再删 worktree，否则会连真实 `node_modules` 一起删掉。
- **本机 `npm` 不一定在 PATH 里**：可以直接调 `node_modules\.bin\*.cmd`，或用 `node` 跑脚本。
- **别手动把令牌粘进脚本或命令行**：统一走凭据管理器 `git credential fill`，
  或只放在当前进程的 `GITEE_TOKEN` 环境变量里（不要写进任何文件）。
- **给 PATH 加 node 时必须"前置"而不是"重写"**：本机 `git` 在 `E:\Git\cmd\git.exe`，
  写成赋值会把 git 挤出 PATH，脚本里 `git credential fill` 就会报
  `'git' is not recognized…` 然后取不到令牌。正确写法：
  `$env:PATH = "C:\Program Files\Lenovo\AIAgent\mcp\node-v22.16.0-win-x64;$env:PATH"`。
- **本机访问 GitHub 只能走 IPv4**：这台机器到 GitHub 的 IPv6 前缀握手会失败，
  PowerShell/.NET 调 GitHub API 会报 `The SSL connection could not be established`，
  需要时用 `curl.exe -4`。Gitee 不受影响。
- **不要把 debug 包和 release 包混着发**：现在 release 变体已经会签名，发 `app-debug.apk`
  会让版本线混乱（5.0.4 是 debug，5.0.5 起是 release）。
- **改 UI/逻辑后要重新 `cap sync`**：只跑 Gradle 不会把新的 `dist/renderer` 打进 APK。
- **官网托管现状**：`website/` 是纯静态页，当前托管在 **GitHub Pages**
  （`https://wzy6789.github.io/VirtuGene-Mobile/`，地址不变），代码主仓库仍在 Gitee。
  部署由推送 `website/**` 到 GitHub 仓库默认分支触发；本机 git 通道到 GitHub 不通
  （HTTPS 握手被切、SSH key 未授权），所以用 `node scripts/deploy-site-github.mjs`
  走 Git Data API 提交（只更新 `website/**`，见 `website/README.md`）。
  换成别的静态托管时保持资源相对路径，并同步改 `index.html` 的
  `canonical` / `og:url` / `og:image` 绝对地址。

---

## 7. 可以直接交给 AI 助手的最短指令

> 在 `F:\VirtuGene-Mobile` 用 PowerShell 打包并发布 Gitee 渠道的 Android v5.2.2：
> 1) `$env:JAVA_HOME="D:\Java\jdk-21"`，**不要设 `GRADLE_USER_HOME`**（用默认 `%USERPROFILE%\.gradle`）；
> 2) 改 4 处版本号：`package.json`、`package-lock.json`、`android/app/build.gradle`（versionCode +1）、
>    `src/lib/changelog.ts`；
> 3) `node scripts\gitee-release.mjs 5.2.2`（脚本自己构建 + 上传；令牌从本机凭据管理器读）；
> 4) 核对：`/releases/latest` 指向 v5.2.2、`/releases/{id}/attach_files` 有 app-release.apk、
>    把附件下回来 SHA-256 与本地一致、`aapt2 dump badging` 线上包是 5.2.2、
>    `apksigner verify --print-certs` 证书仍是 `ef38a01c…40:16`；
> 5) 若官网要同步，改 `website/index.html` 的静态下载地址与版本字样，并跑一遍官网自检。
> 若 Gradle 报 `Could not move temporary workspace` / `Timeout waiting to lock`：
> 先 `gradlew.bat --stop` 并结束残留 java 进程，只清 `~\.gradle\daemon\8.14.3`、
> `~\.gradle\caches\8.14.3\transforms`、`~\.gradle\caches\journal-1`、`android\.gradle`，
> 再串行重跑；不要删整个 `.gradle`，不要动项目源码。
