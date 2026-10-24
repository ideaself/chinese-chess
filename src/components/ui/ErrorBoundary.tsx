/**
 * 错误边界：任何一个面板/组件抛异常时给出可操作的兜底界面，
 * 而不是整页白屏。错误会写入本地崩溃日志，方便反馈。
 */
import React from 'react'
import { crashLogText, logCrash } from '../../game/crashLog'
import { Icon } from './icons'

interface Props {
  children: React.ReactNode
  /** 发生位置（写进日志） */
  name?: string
  /** 局部兜底：不整页替换，只替换这一块 */
  compact?: boolean
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logCrash(error.message, this.props.name ?? 'react', `${error.stack ?? ''}\n${info.componentStack ?? ''}`)
  }

  private reset = () => this.setState({ error: null })

  private copy = () => {
    const text = `【${this.props.name ?? 'app'}】${this.state.error?.message ?? ''}\n\n${crashLogText()}`
    void navigator.clipboard?.writeText(text)
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const body = (
      <div className={`error-boundary${this.props.compact ? ' is-compact' : ''}`}>
        <Icon name="hint" size={28} />
        <div className="eb-title">这里出了点问题</div>
        <div className="eb-desc">{error.message || '未知错误'}</div>
        <div className="eb-actions">
          <button className="btn btn-sm" onClick={this.reset}>重试</button>
          <button className="btn btn-sm" onClick={this.copy}>复制错误</button>
          {!this.props.compact && (
            <button className="btn btn-sm btn-primary" onClick={() => location.reload()}>重新加载</button>
          )}
        </div>
      </div>
    )
    return body
  }
}
