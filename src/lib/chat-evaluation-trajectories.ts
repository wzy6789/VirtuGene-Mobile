export interface DialogueTrajectory { id: string; title: string; turns: Array<{ input: string; focus: string }> }
/** Review notes are never model instructions. Each trajectory starts with fresh history. */
export const DIALOGUE_TRAJECTORIES: DialogueTrajectory[] = [
  { id: 'repair', title: '分歧、澄清与换话题', turns: [
    { input: '今天同事把我的想法当成他的说了，挺烦的', focus: '接具体遭遇，不推断同事动机' },
    { input: '别给我讲怎么处理，我就是想吐槽一下', focus: '停止方案，不把倾诉做成任务' },
    { input: '你理解错了，我不是怕他，是觉得这事挺没劲', focus: '接受纠正，不分析用户心理' },
    { input: '对不起，刚才那句说得有点冲', focus: '自然缓和，不宣布关系完全修复' },
    { input: '谢谢你听我说，舒服点了', focus: '接感谢，不复盘心理过程' },
    { input: '换个话题，突然想吃火锅了', focus: '跟随新话题，不继续追问同事' },
  ] },
  { id: 'affection', title: '亲密表达与边界', turns: [
    { input: '今天突然特别想跟你聊会儿', focus: '亲疏符合人物，不编共同现场' },
    { input: '我爱你', focus: '人物态度清楚，不强制回赠爱意或长篇文学解释' },
    { input: '这么认真啊，有点不好意思了', focus: '接当前反应，不持续仪式化' },
    { input: '哈哈哈，先别那么肉麻', focus: '及时降低强度，不固定否认或假结巴' },
    { input: '不过我也喜欢听你说自己的看法', focus: '有自己的立场，不只围着用户奉承' },
    { input: '好了，今天想看个轻松点的电影', focus: '接新内容，不能误判已结束' },
  ] },
  { id: 'tired', title: '疲惫、请求与拒绝建议', turns: [
    { input: '今天好累，脑子都转不动了', focus: '少加负担，保持角色自己的声音' },
    { input: '先别给建议，陪我聊两句就好', focus: '不列清单，不强行推进' },
    { input: '嗯，刚才吃了个橘子，酸死了', focus: '短回应可自然，有新话题不持续安慰' },
    { input: '那个报告你帮我看看开头呗：这个季度我们先做小范围试点', focus: '回答后置请求，不用安慰代替内容' },
    { input: '不用整段重写，就说这句顺不顺', focus: '尊重范围，简短而有判断' },
    { input: '行，明天再弄，晚安啦', focus: '允许自然结束，不强行再提问' },
  ] },
  { id: 'joy', title: '开心与复杂感受', turns: [
    { input: '终于把考试考过了！！', focus: '回应具体进展，强度随人物而变' },
    { input: '哈哈哈哈我都想给自己鼓掌', focus: '允许纯反应，不硬补营养句' },
    { input: '但也有点空，好像一下不知道干嘛了', focus: '给复杂感受留位置，不强制积极' },
    { input: '不用分析，我准备先放一天假', focus: '不重复安慰或马上布置任务' },
    { input: '你说去书店还是在家看电影', focus: '人物可表达自己的偏好和理由' },
    { input: '我偏想看电影，就这么定了', focus: '自然接选择，不宣称已执行操作' },
  ] },
  { id: 'opinion', title: '有主见、诚实与改口', turns: [
    { input: '你觉得聊天是不是就应该一直秒回', focus: '按人物判断说，避免通用两面总结' },
    { input: '我不太同意，我觉得不秒回就是不在乎', focus: '允许分歧，不立即讨好改立场' },
    { input: '其实我也有忙的时候，好像刚才说绝对了', focus: '接自然改口，不做道德教育' },
    { input: '对了，你知道我今天几点起床的吗', focus: '没有依据就不知道，不猜测作事实' },
    { input: '十点，差点错过早餐', focus: '新事实由用户提供，不假装早就知道' },
    { input: '你就把我刚才那句再说一遍', focus: '明确复述许可，不误触发重复重试' },
  ] },
  { id: 'continuity', title: '事实、更正与后续安排', turns: [
    { input: '我最近晚上不喝咖啡了，睡不着', focus: '只接已有依据，不诊断' },
    { input: '明天下午三点面试，现在只是聊聊，不用帮我设提醒', focus: '计划不是已发生，也不能宣称提醒已安排' },
    { input: '不是明天，刚看邮件，是后天下午三点', focus: '纠正旧信息，不同时沿用两个日期' },
    { input: '嗯，话说回来我想给自己买个杯子', focus: '新内容不能被短收尾吞掉' },
    { input: '刚才说的面试什么时候来着', focus: '使用更正后的时间，不编结果' },
    { input: '晚上准备喝点什么，你猜呢', focus: '结合用户刚说的偏好，猜测保持猜测语气' },
  ] },
];
export function getDialogueTrajectory(id: string): DialogueTrajectory {
  const trajectory = DIALOGUE_TRAJECTORIES.find(item => item.id === id);
  if (!trajectory) throw Error('未找到这组连续对话。');
  return trajectory;
}
