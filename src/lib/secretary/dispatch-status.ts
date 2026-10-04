import type { DispatchState } from './character-messaging';
export const DISPATCH_LABELS: Record<DispatchState, string> = {
  'needs-recipient': '待选择角色', 'needs-content': '待补正文', draft: '草稿待确认',
  'needs-model': '待选择对话模型', queued: '排队中，尚未发送', generating: '消息已记录，回复处理中',
  replied: '角色已回复', 'reply-failed': '消息已记录，回复生成失败', 'reply-unavailable': '消息已记录，回复未生成', interrupted: '回复已中断',
  paused: '已暂停', cancelled: '已取消，未发送', invalid: '办理已停止',
};
