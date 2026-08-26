import { useUpdateStore } from '../../store/update-store';

export function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);

  if (!status) return null;

  let content: React.ReactNode = null;

  switch (status.state) {
    case 'checking':
      content = (
        <>
          <span className="text-ink">正在检查基因序列更新...</span>
        </>
      );
      break;

    case 'available':
      content = (
        <>
          <span className="text-ink">
            新版本 <span className="text-life-cyan font-medium">v{status.version}</span> 已就绪
          </span>
          <button
            onClick={download}
            className="px-3 py-1 rounded-lg text-xs bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors"
          >
            下载更新
          </button>
        </>
      );
      break;

    case 'downloading':
      content = (
        <>
          <span className="text-ink">正在下载更新...</span>
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full bg-life-cyan transition-all duration-300"
                style={{ width: `${status.percent}%` }}
              />
            </div>
            <span className="text-xs text-sub">{status.percent}%</span>
          </div>
        </>
      );
      break;

    case 'downloaded':
      content = (
        <>
          <span className="text-ink">
            新版本 <span className="text-life-cyan font-medium">v{status.version}</span> 已下载
          </span>
          <button
            onClick={install}
            className="px-3 py-1 rounded-lg text-xs bg-gene-purple text-white hover:bg-[#5B4BD4] transition-colors"
          >
            重启安装
          </button>
        </>
      );
      break;

    case 'not-available':
      content = <span className="text-sub">已是最新版本</span>;
      break;

    case 'error':
      content = <span className="text-red-400">更新检查失败：{status.message}</span>;
      break;
  }

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 text-sm border-b border-line bg-surface/60 backdrop-blur-xl">
      {content}
      <button onClick={check} className="text-xs text-gray-500 hover:text-sub transition-colors">
        刷新
      </button>
    </div>
  );
}
