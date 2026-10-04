import type { SettingsIconName } from './SettingsUI';

interface SettingsEntry { title:string; icon:SettingsIconName; parent:string|null; group?:string; detail:string; terms:string; }

// One route registry supplies navigation labels, aliases and search destinations.
export const SETTINGS_PAGES = {
  home: {"title": "设置", "icon": "appearance", "parent": null, "detail": "设置", "terms": ""},
  account: {"title": "个人与账号", "icon": "account", "parent": "home", "detail": "个人资料与账号安全", "terms": "头像 名字 密码 安全 注销", "group": "你的偏好"},
  appearance: {"title": "外观与阅读", "icon": "appearance", "parent": "home", "detail": "主题、阅读字号与动态效果", "terms": "主题 深色 浅色 字体 字号 动画 动效 流畅 减少 跟随系统", "group": "你的偏好"},
  voice: {"title": "聊天与语音", "icon": "voice", "parent": "home", "detail": "消息朗读与语音回复", "terms": "声音 语音 朗读 语速", "group": "你的偏好"},
  connection: {"title": "AI 连接", "icon": "connection", "parent": "home", "detail": "服务商接入、模型选择与连接检测", "terms": "AI API Key 模型 密钥 连接 OpenAI Claude Gemini DeepSeek 千问 Qwen Kimi GLM 豆包 MiniMax MiMo Grok 硅基 自定义 本地", "group": "连接与内容"},
  privacy: {"title": "内容与隐私", "icon": "privacy", "parent": "home", "detail": "日记、朋友圈与世界设定", "terms": "隐私 日记 朋友圈 世界 星域 分享 提醒", "group": "连接与内容"},
  data: {"title": "数据与设备", "icon": "data", "parent": "home", "detail": "数据备份与设备互联", "terms": "数据 备份 恢复 同步 设备", "group": "设备与软件"},
  about: {"title": "关于与更新", "icon": "about", "parent": "home", "detail": "版本、更新与使用说明", "terms": "版本 更新 帮助 使用 隐私说明", "group": "设备与软件"},
  keys: {"title": "服务商密钥", "icon": "connection", "parent": "connection", "detail": "服务商与 API 配置", "terms": "API Key OpenAI Claude Anthropic Gemini Google DeepSeek 千问 Qwen MiMo Kimi Moonshot GLM 智谱 豆包 Doubao MiniMax Grok xAI SiliconFlow 硅基 OpenRouter Groq 密钥 地址 endpoint 自定义 本地 Ollama LM Studio 检测"},
  credentials: {"title": "账号绑定密钥", "icon": "account", "parent": "connection", "detail": "账号绑定密钥", "terms": "账号 绑定 密钥"},
  model: {"title": "默认对话模型", "icon": "connection", "parent": "connection", "detail": "默认对话模型", "terms": "模型 默认 对话"},
  backup: {"title": "备份与恢复", "icon": "data", "parent": "data", "detail": "备份与恢复", "terms": "备份 恢复 数据"},
  sync: {"title": "局域网同步", "icon": "connection", "parent": "data", "detail": "局域网同步", "terms": "同步 电脑 设备 Wi-Fi"},
  inputVoice: {"title": "语音输入", "icon": "voice", "parent": "voice", "detail": "云端语音识别", "terms": "语音输入 转文字 识别 硅基"},
  diary: {"title": "日记设置", "icon": "diary", "parent": "privacy", "detail": "日记设置", "terms": "手账 日记 锁 提醒 分享 授权 AI辅助"},
} as const satisfies Record<string,SettingsEntry>;

export type SettingsPage = keyof typeof SETTINGS_PAGES;
export const pageTitles = Object.fromEntries(Object.entries(SETTINGS_PAGES).map(([page,item])=>[page,item.title])) as Record<SettingsPage,string>;
const entries = Object.entries(SETTINGS_PAGES).map(([page,item])=>({...(item as SettingsEntry),page:page as SettingsPage}));
export const directory = entries.filter(item=>item.group);
export const detailSearch = entries.filter(item=>item.parent && item.parent !== 'home').map(item=>({...item,path:pageTitles[item.parent as SettingsPage]}));
