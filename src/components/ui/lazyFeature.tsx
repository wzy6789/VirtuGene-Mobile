import { Component, Suspense, lazy, useMemo, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { FeedbackNotice } from './FeedbackNotice';

/** Fetch on navigation intent, share the request, and contain feature failures inside the shell. */
export function lazyFeature<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, label = '正在打开你的空间…', fallback?: ReactNode, errorPresentation: 'page' | 'notice' = 'page') {
  let request: ReturnType<typeof load> | undefined;
  let resolved: T | undefined;
  const fetch = () => request ??= Promise.resolve().then(load).then(module => { resolved = module.default; return module; }).catch(error => { request = undefined; throw error; });
  function Feature({ onLoadDismiss, ...props }: ComponentProps<T> & { onLoadDismiss?: () => void }) {
    const [attempt, setAttempt] = useState(0);
    // A fulfilled feature mounts synchronously on return. Creating a fresh lazy
    // wrapper around its fulfilled Promise would show Suspense again on React 19.
    // Freeze the component choice for this mount so later parent renders do not
    // replace the live subtree (drafts and in-flight work belong to that tree).
    const View = useMemo(() => resolved ?? lazy(fetch), [attempt]) as ComponentType<ComponentProps<T>>;
    return <FeatureErrorBoundary key={attempt} onRetry={() => setAttempt(n => n + 1)} presentation={errorPresentation} onDismiss={onLoadDismiss}>
      <Suspense fallback={fallback === undefined ? <div role="status" aria-busy="true" className="flex h-full min-h-12 items-center justify-center px-4 text-sm text-sub">{label}</div> : fallback}>
        <View {...props as ComponentProps<T>} />
      </Suspense>
    </FeatureErrorBoundary>;
  }
  Feature.preload = () => fetch().then(() => undefined, () => undefined);
  return Feature;
}

class FeatureErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void; presentation: 'page' | 'notice'; onDismiss?: () => void }, { failed: boolean; reload: boolean; dismissed: boolean }> {
  state = { failed: false, reload: false, dismissed: false };
  static getDerivedStateFromError(error: unknown) {
    // Browsers cache failed module imports for the document's lifetime. A fresh React.lazy
    // alone cannot repair that cache; explicitly reload the app after the connection recovers.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { failed: true, reload: /dynamically imported module|module script|ChunkLoadError|Loading chunk|preload CSS/i.test(message) };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.presentation === 'notice') return this.state.dismissed ? null : <div className="vg-feedback-viewport"><FeedbackNotice message="暂时没有打开成功，可稍后重试。" tone="error"><button type="button" className="vg-button vg-button-secondary" onClick={this.state.reload ? () => window.location.reload() : this.props.onRetry}>{this.state.reload ? '重新加载应用' : '重新打开'}</button><button type="button" className="vg-button vg-button-ghost" onClick={() => { this.setState({ dismissed: true }); this.props.onDismiss?.(); }}>暂不处理</button></FeedbackNotice></div>;
    return <div role="alert" className="flex h-full min-h-24 flex-col items-center justify-center gap-3 p-4 text-sm text-sub">
      <p>暂时没有打开成功，已保存的记录仍保留在设备上。</p>
      <button type="button" className="min-h-11 rounded-xl bg-gene-purple px-5 text-white" onClick={this.state.reload ? () => window.location.reload() : this.props.onRetry}>{this.state.reload ? '重新加载应用' : '重新打开'}</button>
    </div>;
  }
}
