# 陆雪琪角色接入验证 · 2026-10-09

本文是最初接入时的历史验证。当前书后已婚有子修订、真实调用与失败证据见 `LUXUEQI-USAGE-2026-10-10.json`、`LUXUEQI-FINAL-AUDIT-2026-10-10.json`，可读记录统一在 Obsidian 手机版角色卡与开发日志。以下旧版号与10项检查不是当前状态。

新增 `src/lib/lu-xue-qi-preset.ts`，在 `src/lib/seed-init.ts` 导入并加入预设数组。版本保持6.0.12，本轮未生成APK或发布。

验证结果：

- `node scripts/verify/luxueqi-preset.mjs`：10项Chrome真实IndexedDB接入检查通过，明细见同目录 `LUXUEQI-PRESET-2026-10-09.json`。
- `node scripts/verify/preset-voice.mjs`：135项既有预设声音检查通过。
- `node node_modules/typescript/bin/tsc --noEmit`：exit 0。
- `node node_modules/vite/bin/vite.js build`：528 modules，exit 0；未运行Capacitor同步或Android构建。

初次新增验证因测试未初始化登录账号而在副本归属断言失败，设置测试账号后通过。npm/npx不在当前PATH，改用node运行项目内CLI。既有iife import.meta、静态/动态重复引用和大chunk警告仍存在。

真实模型调用0次，input/output/total tokens均为0；本地接入验证不能证明人物还原、长聊自然度或身份识别执行质量。身份选择由人设、当前用户说明与可用历史驱动，未新增确定性身份状态机；未验收真实群聊、主动消息或Android真机。用语示例是原创，不是模型实测或小说引文。

可读设定、基础背景参考和开发日志统一保存在Obsidian手机版区域：`D:/月起云归/VirtuGene/手机版/角色设定/陆雪琪.md`、`开发日志/2026-10-09.md`，手机版总览已更新。
