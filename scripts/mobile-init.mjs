/**
 * VirtuGene 移动端（Capacitor）初始化脚本。
 * 用法：npm run mobile:init [android|ios]
 * - 已存在对应平台目录时跳过 cap add，幂等
 * - 构建 Web 渲染层并同步到原生工程
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const platform = process.argv[2] ?? 'android';
const root = resolve(import.meta.dirname, '..');
process.chdir(root);

if (!['android', 'ios'].includes(platform)) {
  console.error(`不支持的平台：${platform}（仅支持 android / ios）`);
  process.exit(1);
}

if (!existsSync('capacitor.config.ts')) {
  console.error('缺少 capacitor.config.ts，请先配置移动端参数');
  process.exit(1);
}

if (existsSync(platform)) {
  console.log(`${platform}/ 已存在，跳过 cap add ${platform}`);
} else {
  console.log(`正在添加 ${platform} 平台工程...`);
  execSync(`npx cap add ${platform}`, { stdio: 'inherit', shell: true });
}

console.log('构建 Web 渲染层...');
execSync('npm run build:renderer', { stdio: 'inherit', shell: true });

console.log(`同步 Web 产物到 ${platform}...`);
execSync(`npx cap sync ${platform}`, { stdio: 'inherit', shell: true });

console.log(`\n完成！${platform} 工程已就绪。`);
console.log('构建调试 APK：npm run mobile:build（需 Android SDK / JDK 17+，缺失时参考 README）');
