import { Modal } from '../ui/Modal';

export type LegalDocument = 'privacy' | 'terms';

interface LegalNoticeModalProps {
  document: LegalDocument | null;
  onClose: () => void;
}

export function LegalNoticeModal({ document, onClose }: LegalNoticeModalProps) {
  return (
    <Modal open={document !== null} onClose={onClose} title={document === 'privacy' ? '隐私说明' : '使用说明'} width="max-w-lg">
      <div className="space-y-6 p-5 text-sm leading-7 text-sub">
        {document === 'privacy' ? <PrivacyContent /> : <TermsContent />}
      </div>
    </Modal>
  );
}

function PrivacyContent() {
  return (
    <>
      <p className="text-xs text-sub tabular-nums">更新日期：2026年10月22日 · VirtuGene</p>
      <section><h3 className="mb-1 text-sm font-medium text-ink">处理的数据</h3><p>用户名、不可逆密码摘要和账号创建时间保存在测试服务器；角色、聊天、记忆、情绪状态和手账主要保存在本机。服务器会保留保障安全所必需的访问日志。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">使用云端 AI</h3><p>发送消息时，当前输入、必要的角色设定、相关记忆与近期对话会交由 AI 服务处理；使用图片、语音或云端识别时，相应内容也会发送给对应服务。请勿输入身份证、银行卡、精确住址、医疗资料等敏感信息。</p><p className="mt-2">网关模式：未配置本地 DeepSeek 密钥且有网关授权时，DeepSeek 对话经 VirtuGene 网关转发给模型服务；网关使用服务器端配置的供应商密钥，不会要求上传你自己的供应商密钥。</p><p className="mt-2">自带密钥模式：已配置的本地 DeepSeek 密钥优先使用；其他服务商及自定义 API 按你选择的服务商、模型和地址请求。密钥加密保存在本机，请求时发送给对应服务地址用于认证。自定义地址由你指定，请确认其可信。部分功能仍会独立使用网关或语音服务，具体以对应功能配置为准。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">保存与删除</h3><p>本机内容保存至你主动删除、注销或卸载清除数据为止。测试服务器账号保存至你注销账号为止；安全日志按照排查滥用与故障所需的最短期限保存。注销时先删除服务器账号，再清除本机业务数据。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">权限与选择</h3><p>通知和麦克风只在你主动启用对应功能后使用。你可以拒绝非必要权限、清除聊天、导出备份或注销账号。拒绝云端处理将导致 AI 对话不可用，但不影响查看已保存在本机的内容。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">联系</h3><p>如需反馈问题或申请数据处理，请通过产品提供的反馈渠道联系我们。服务渠道和处理规则会随正式版本同步更新。</p></section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <p className="text-xs text-sub tabular-nums">更新日期：2026年9月8日 · VirtuGene</p>
      <section><h3 className="mb-1 text-sm font-medium text-ink">使用范围</h3><p>服务仅向年满18周岁的用户开放。功能和数据结构可能调整，请勿把生成内容当作医疗、法律、财务或其他专业意见。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">AI 内容</h3><p>角色回复由人工智能生成，角色不是真实人物。内容可能错误、虚构或不符合预期，不能替代医疗、心理、法律、财务或紧急援助等专业服务。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">服务与费用</h3><p>自带密钥、语音和自定义 API 可能由对应服务商按其规则计费；模型请求、连接检测及语音调用可能产生用量。配置保存不代表服务已连接或免费可用，请确认所选服务的额度与计费规则。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">安全边界</h3><p>不得利用本产品生成违法有害内容、侵害他人隐私或知识产权。请避免形成过度依赖；如果你正面临人身危险、自伤风险或重大财产损失，应立即联系现实中的可信任人员和当地紧急援助。</p></section>
      <section><h3 className="mb-1 text-sm font-medium text-ink">退出测试</h3><p>你可以随时停止使用、退出登录或注销账号。注销会删除服务器账号及本机业务数据，且无法恢复。</p></section>
    </>
  );
}
