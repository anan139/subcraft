// 醒目的任务进度覆盖层：识别/翻译/导出时显示在视频区域中央
// 运行中显示预估剩余时间与取消按钮；取消后显示灰色「已取消」卡片
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

/** 把剩余秒数格式化为 "45s" / "1m 20s" */
function fmtEta(sec: number): string {
  if (sec < 5) return 'a few seconds'
  if (sec < 90) return `${Math.round(sec)}s`
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

export default function ProgressOverlay() {
  const { task, setTask } = useStore()
  const startRef = useRef<number>(0)           // 当前任务开始时刻（task_id 变化时重置）
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    setNow(Date.now())
  }, [task?.task_id])

  // 运行中每秒刷新一次，驱动 ETA 重算
  useEffect(() => {
    if (task?.status !== 'running') return
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [task?.status, task?.task_id])

  if (!task) return null

  const cancel = async () => {
    try { await api.cancelTask(task.task_id) } catch { /* 任务可能刚好结束 */ }
  }

  // 已取消：灰色卡片
  if (task.status === 'cancelled') {
    return (
      <div className="progress-overlay">
        <div className="progress-card cancelled">
          <div className="progress-title">⏹ {task.label || 'Task'} cancelled</div>
          <button onClick={() => setTask(null)}>Close</button>
        </div>
      </div>
    )
  }

  // 错误状态：红色卡片 + 可关闭
  if (task.status === 'error') {
    return (
      <div className="progress-overlay">
        <div className="progress-card error">
          <div className="progress-title">✕ {task.label || 'Task'} failed</div>
          <div className="progress-detail error-text">{task.error || 'Unknown error'}</div>
          <button onClick={() => setTask(null)}>Close</button>
        </div>
      </div>
    )
  }

  if (task.status !== 'running') return null

  const pct = Math.min(100, Math.max(0, Math.round(task.progress * 100)))
  const indeterminate = task.progress <= 0.01

  // 预估剩余时间：进度爬升到 3% 且耗时 >2s 后才显示，避免刚启动时的荒谬估计
  let eta = ''
  const elapsed = (now - startRef.current) / 1000
  if (!indeterminate && task.progress >= 0.03 && elapsed > 2) {
    const remain = elapsed / task.progress * (1 - task.progress)
    eta = ` · ~${fmtEta(remain)} left`
  }

  return (
    <div className="progress-overlay">
      <div className="progress-card">
        <div className="progress-spinner" />
        <div className="progress-title">{task.label || 'Processing'}</div>
        <div className="progress-pct">{indeterminate ? '…' : `${pct}%`}</div>
        <div className={`progress-track ${indeterminate ? 'indeterminate' : ''}`}>
          <div className="progress-fill" style={{ width: indeterminate ? '30%' : `${pct}%` }} />
        </div>
        <div className="progress-detail">{task.message || 'Preparing…'}{eta}</div>
        <button className="cancel-btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  )
}
