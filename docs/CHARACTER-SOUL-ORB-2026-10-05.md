# 角色聊天小球接入

2026-10-06 已修正定性标签、色相间隔与空态图标；最新核验和 code 42 安装包记录见 [评审修正](CHARACTER-SOUL-ORB-REVIEW-2026-10-06.md)。下文保留首轮实现与 code 41 历史构建信息。

普通角色的单人聊天顶部加入 44px 小球，保留角色头像与名称。点击小球打开底部状态面板，包含情绪、关系、记忆三个入口；群聊不纳入本轮。

情绪页复用原情绪图谱、曲线、历史快照与手动分析；关系页复用关系等级、里程碑和共同时间线；记忆页连接已有记忆档案，保留来源查看、纠正与删除。原更多菜单中的情绪入口与桌面情绪按钮已移除，心情打卡和语音偏好继续保留。

小球以角色稳定 ID 生成色系。思考、流式回复、失败来自真实请求状态；开心和低落只读取与当前角色及会话匹配的情绪快照，没有快照则待机。打开面板不会自动分析或调用模型，情绪摘要显示记录时间。展开时暂停小球复杂动画，所有入口保持至少 44px 点击区域。

助理继续使用用户取的名字与既有办事状态，点击小球提供今日安排、待处理、助理记忆入口；不虚构助理的关系等级或情绪图谱。原接力元素身份保留。

账号、角色或会话切换会卸载旧面板；情绪异步读取及角色状态加载增加过期结果保护。面板复用现有 Modal 的焦点约束、Escape 和手机返回事件，记忆档案关闭后返回小球面板，聊天草稿保持不变。没有数据库结构变更。

验证：新增 12 项浏览器检查，包括真实 ChatPage 接入、状态优先级、错角色快照隔离、账号切换、记忆读取、嵌套返回、草稿保留，以及 320 / 390 / 430px 深浅主题布局。助理整合回归 28 项数据 + 25 项 UI 通过。正式构建导航与分包 9 项检查通过。真机按用户既有要求跳过。

复跑：

```powershell
node scripts/verify/analyze-bundle.mjs
node scripts/verify/build-character-orb.mjs
node scripts/verify/run-character-orb.cjs
node scripts/verify/build-assistant-hub.mjs
node scripts/verify/run-assistant-hub.cjs
node scripts/verify/run-production-split.cjs
```

效果图在 `.tmp-preview/character-orb-dark.png`、`character-orb-light.png`、`character-orb-chat.png`。

安装包：`release/VirtuGene-6.0.0-character-orb.apk`，6.0.0 / code 41，59,349,207 字节，沿用升级签名，`apksigner verify` 通过。SHA256：`A75700A89DDD17506D458E7C3E6F64CD5FB11CBC9F6296FD5841B5204C8C6A41`。旧 code 40 助理整合包保留。主入口 gzip 约 164.76 KB，生产首页仍未提前请求聊天、世界、执行器或设置模块。
