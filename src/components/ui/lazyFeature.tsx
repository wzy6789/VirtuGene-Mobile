import { Component, Suspense, lazy, useMemo, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';

/** Fetch on navigation intent, share the request, and contain feature failures inside the shell. */
export function lazyFeature<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, label = '正在打开你的空间…') {
  let request: ReturnType<typeof load> | undefined;
  const fetch = () => request ??= load().catch(error => { request = undefined; throw error; });
  function Feature(props: ComponentProps<T>) {
    const [attempt, setAttempt] = useState(0);
    const View = useMemo(() => lazy(fetch), [attempt]) as ComponentType<ComponentProps<T>>;
    return <FeatureErrorBoundary key={attempt} onRetry={() => setAttempt(n => n + 1)}>
      <Suspense fallback={<div role="status" aria-busy="true" className="flex h-full min-h-12 items-center justify-center px-4 text-sm text-sub">{label}</div>}>
        <View {...props} />
      </Suspense>
    </FeatureErrorBoundary>;
  }
  Feature.preload = () => { void fetch().catch(() => undefined); };
  return Feature;
}

class FeatureErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean; reload: boolean }> {
  state = { failed: false, reload: false };
  static getDerivedStateFromError(error: unknown) {
    // Browsers cache failed module imports for the document's lifetime. A fresh React.lazy
    // alone cannot repair that cache; explicitly reload the app after the connection recovers.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { failed: true, reload: /dynamically imported module|module script|ChunkLoadError|Loading chunk|preload CSS/i.test(message) };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="flex h-full min-h-24 flex-col items-center justify-center gap-3 p-4 text-sm text-sub">
      <p>暂时没有打开成功，已保存的记录仍保留在设备上。</p>
      <button type="button" className="min-h-11 rounded-xl bg-gene-purple px-5 text-white" onClick={this.state.reload ? () => window.location.reload() : this.props.onRetry}>{this.state.reload ? '重新加载应用' : '重新打开'}</button>
    </div>;
  }
}
