import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  resetCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, resetCount: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, resetCount: 0 };
  }

  handleReset = () => {
    this.setState(prev => ({ hasError: false, error: null, resetCount: prev.resetCount + 1 }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-bg-base">
          <div className="max-w-md w-full mx-4 p-8 rounded-2xl bg-bg-surface border border-white/10 shadow-2xl text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">页面出了点问题</h2>
            <p className="text-sm text-white/50 mb-1">
              渲染组件时发生了错误，可以尝试恢复或刷新页面。
            </p>
            {this.state.error && (
              <p className="text-xs text-white/30 mt-3 mb-5 font-mono bg-white/5 rounded-lg p-3 text-left break-all max-h-32 overflow-y-auto">
                {this.state.error.message}
              </p>
            )}
            <div className="flex items-center justify-center gap-3 mt-5">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />重试
              </button>
              <button
                onClick={this.handleReload}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-black bg-white hover:bg-white/90 transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <div key={this.state.resetCount} style={{ display: 'contents' }}>{this.props.children}</div>;
  }
}
