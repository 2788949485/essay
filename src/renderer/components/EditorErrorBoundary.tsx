import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** 编辑器区域崩溃隔离：NodeView/扩展抛错时只降级这一块，不拖垮整个窗口 */
export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("editor crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="editor-error-fallback">
          <strong>编辑区出了点问题</strong>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            重新加载编辑区
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
