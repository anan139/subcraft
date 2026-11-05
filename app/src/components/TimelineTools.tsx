// 时间轴工具栏：贴齐镜头切点 / 整体平移 / 修复重叠 / 问题提示（实时检查当前轨）
import { useEffect, useState } from 'react'
import { api, waitTask } from '../api'
import { useStore } from '../store'
import { applyTimeline, playhead } from '../timelineOps'
import type { TimelineInfo } from '../types'

export default function TimelineTools() {
  const { tracks, activeTrackId, videoPath, issues, setIssues, setTask, requestSeek } = useStore()
  const track = tracks.find((t) => t.id === activeTrackId) ?? null
  const [offset, setOffset] = useState('0.3')
  const [fromPlayhead, setFromPlayhead] = useState(false)
  const [cuts, setCuts] = useState<number[] | null>(null)
  const [result, setResult] = useState<TimelineInfo | null>(null)
  const [err, setErr] = useState('')

  // 编辑后 400ms 自动检查当前轨
  useEffect(() => {
    if (!track) { setIssues([]); return }
    const h = setTimeout(() => {
      api.timelineCheck({ segments: track.segments }).then((r) => setIssues(r.issues)).catch(() => {})
    }, 400)
    return () => clearTimeout(h)
  }, [track?.segments])

  useEffect(() => { setCuts(null); setResult(null) }, [videoPath])

  if (!track) return null

  const run = async (fn: () => Promise<void>) => {
    setErr('')
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  const snap = () => run(async () => {
    let found = cuts
    if (!found) {
      const { task_id } = await api.timelineCuts({ video_path: videoPath })
      setTask({ task_id, status: 'running', progress: 0, message: 'Detecting shot cuts', error: null, label: 'Shot detection' })
      try {
        const r = await waitTask(task_id, (t) => setTask({ ...t, label: 'Shot detection' }))
        found = (r.cuts as number[]) ?? []
      } finally { setTask(null) }
      setCuts(found)
    }
    setResult(await applyTimeline({ op: 'snap', cuts: found }))
  })

  const shift = () => run(async () => {
    const v = parseFloat(offset)
    if (!Number.isFinite(v) || v === 0) throw new Error('Enter a non-zero number of seconds — positive delays, negative advances')
    setResult(await applyTimeline({ op: 'shift', offset: v, from_time: fromPlayhead ? playhead() : null }))
  })

  const splitAtCut = (index: number, at: number) => run(async () => {
    const info = await applyTimeline({ op: 'split', index, at_time: at })
    setResult((r) => r && { ...r, need_split: r.need_split?.filter((x) => x.index !== index).map((x) => ({ ...x, index: x.index > index ? x.index + 1 : x.index })), synced: info.synced })
  })

  const overlaps = issues.filter((i) => i.type === 'overlap').length

  return (
    <div className="timeline-tools">
      <div className="tt-row">
        <button disabled={!videoPath} title="Detect shot changes so subtitles don't span cuts: pull back lines just past a cut, snap lines close to one" onClick={snap}>
          ⌖ Snap to cuts{cuts ? ` (${cuts.length})` : ''}
        </button>
        <span className="tt-sep" />
        <label title="Positive delays, negative advances (seconds)">Shift</label>
        <input className="tt-num" value={offset} onChange={(e) => setOffset(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && shift()} />
        <label className="tt-check" title="Only shift subtitles after the playhead (e.g. an intro/ad was inserted)">
          <input type="checkbox" checked={fromPlayhead} onChange={(e) => setFromPlayhead(e.target.checked)} />From playhead
        </label>
        <button onClick={shift}>Apply</button>
        {overlaps > 0 && (
          <button className="tt-warn" title="Trim overlapped segments' end times to the next segment's start" onClick={() => run(async () => setResult(await applyTimeline({ op: 'fix_overlaps' })))}>
            Fix overlaps {overlaps}
          </button>
        )}
        {issues.length > 0 && (
          <span className="tt-issues" title="Click to jump to the first one; hover highlighted rows in the list for details" onClick={() => requestSeek(track.segments[issues[0].index]?.start ?? 0)}>
            ⚠ {issues.length} timing issue(s)
          </span>
        )}
      </div>
      {err && <div className="tt-msg err">{err}</div>}
      {result && !err && <ResultLine info={result} onSplit={splitAtCut} onClose={() => setResult(null)} />}
    </div>
  )
}

function ResultLine({ info, onSplit, onClose }: { info: TimelineInfo; onSplit: (i: number, at: number) => void; onClose: () => void }) {
  const parts: string[] = []
  if (info.changes) parts.push(`Snapped ${info.changes.length} segment(s)`)
  if (info.shifted !== undefined) parts.push(`Shifted ${info.shifted} segment(s)`)
  if (info.fixed !== undefined) parts.push(`Fixed ${info.fixed} overlap(s)`)
  if (info.split_at !== undefined) parts.push(`Split at ${info.split_at.toFixed(2)}s`)
  if (info.synced?.length) parts.push(`Synced ${info.synced.length} aligned track(s)`)
  return (
    <div className="tt-msg">
      <span>{parts.join(', ') || 'No changes'}</span>
      {info.need_split?.map((x) => (
        <button key={x.index} className="tt-link" title={x.text} onClick={() => onSplit(x.index, x.cuts[0])}>
          Segment {x.index + 1} spans a cut @{x.cuts[0].toFixed(2)}s → split
        </button>
      ))}
      <span className="tt-close" onClick={onClose}>✕</span>
    </div>
  )
}
