import type { SecretaryActionKind, SecretaryDestination } from './types';

/** The planner, archive importer and user-facing catalog share the executable tools. */
export const SECRETARY_ACTION_LABELS: Record<SecretaryActionKind, string> = {
  'diary.save': '日记', 'diary.search': '查找日记',
  'moment.draft': '朋友圈草稿', 'moment.publish': '朋友圈', 'moment.search': '查找朋友圈',
  'todo.create': '新待办', 'todo.list': '待办安排', 'todo.complete': '完成待办',
  'todo.reopen': '恢复待办', 'todo.reschedule': '调整待办',
  'todo.update': '修改待办', 'todo.cancel': '取消待办', 'app.open': '页面直达',
  'todo.steps': '待办步骤',
  'character.message.send': '角色代发消息',
};
export const SECRETARY_ACTION_KINDS = Object.keys(SECRETARY_ACTION_LABELS) as SecretaryActionKind[];
export const SECRETARY_DESTINATIONS: Record<SecretaryDestination, string> = {
  diary: '日记', todo: '待办', moments: '朋友圈', memory: '记忆', timeline: '时间线',
  relations: '关系', stage: '星域', worldSettings: '世界设置',
};
export const SECRETARY_CAPABILITIES = [
  { name: '角色代发消息', detail: '把原话发给你已添加的角色，或先拟稿、确认后发送；带回真实回复，生成失败时只重试回复。', example: '给小月发：我今晚晚点回来。' },
  { name: '连续记忆', detail: '记住你明确告诉助理的信息与偏好，跨会话查找旧交流及真实任务进展；可以查看、纠正或忘记，不自动分享给其他角色。', example: '记住：我喜欢简短的回复' },
  { name: '日记记录与检索', detail: '私密保存、追加原文，按日期或关键词找历史日记；日记锁定时先解锁。', example: '帮我查找最近关于旅行的日记' },
  { name: '朋友圈写作与检索', detail: '写草稿、按选择发布、撤回本次发布，查找自己发过的动态。', example: '找一下我发过的关于散步的朋友圈' },
  { name: '待办全程办理', detail: '新建、查询、完成、恢复、改期、改名、修改备注和优先级、取消整项安排；单次待办可拆成步骤，逐项完成或恢复；刚办好单项后可接着修改。', example: '把待办“准备旅行”拆成订车票、订酒店、收拾行李三个步骤' },
  { name: '重复与系统提醒', detail: '每天、工作日、每周、每月或每隔几天；设置提前提醒、关闭提醒，修改后同步本地通知。', example: '把待办“读书”改为每天晚上九点，提前十分钟提醒' },
  { name: '软件页面直达', detail: '提供日记、待办、朋友圈、记忆、时间线、关系、星域和世界设置的直达入口。', example: '带我去待办页面' },
  { name: '整理与交接', detail: '每日整理按勾选生成建议，先看真实办事进展与下一步；办事收件箱保留结果，办事习惯保存格式、文风和提醒偏好，解雇与聘用后记录与习惯保留。', example: '今天都做了什么，帮我查一下已完成的待办' },
];
