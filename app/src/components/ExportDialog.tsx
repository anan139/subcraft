// 导出对话框：字幕文件 (SRT/ASS) + 视频（软字幕封装 MKV 无损 / 硬字幕内嵌烧录进画面）
// 内嵌模式带"真实烧录预览帧"：用与最终导出相同的 ffmpeg+libass 管线渲染，所见即所得
// 导出期间在对话框内显示实时进度条（视频区覆盖层会被对话框遮罩挡住）
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, waitTask } from '../api'
import { useStore } from '../store'

/** 读取播放器当前播放时间（用于预览帧默认时间点） */
function playerTime(): number {
  return document.querySelector<HTMLVideoElement>('.video-area video')?.currentTime ?? 0
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const { tracks, bilingual, primaryTrackId, media, videoPath, setTask } = useStore()
  const baseName = (media?.name ?? 'subtitle').replace(/\.[^.]+$/, '')
  const [doSrt, setDoSrt] = useState(true)
  const [doAss, setDoAss] = useState(true)
  const [doVideo, setDoVideo] = useState(true)
  const [hard, setHard] = useState(false)            // 视频导出方式：false=软字幕封装 / true=内嵌烧录
  const [burnTrackId, setBurnTrackId] = useState('') // '' = 自动（双语优先）
  const [outDir, setOutDir] = useState('')           // 最近一次使用的输出目录（记住并用于默认保存位置）
  const [previewTime, setPreviewTime] = useState(() => playerTime().toFixed(2))
  const [preview, setPreview] = useState<{ img: string; loading: boolean; err: string }>({ img: '', loading: false, err: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ pct: number; msg: string } | null>(null)

  // 恢复上次导出设置（格式/模式/输出目录）
  useEffect(() => {
    api.getConfig().then((c) => {
      if (typeof c.export_srt === 'boolean') setDoSrt(c.export_srt)
      if (typeof c.export_ass === 'boolean') setDoAss(c.export_ass)
      if (typeof c.export_video === 'boolean') setDoVideo(c.export_video)
      if (typeof c.export_hard === 'boolean') setHard(c.export_hard)
      if (c.export_dir) setOutDir(c.export_dir)
    }).catch(() => {})
  }, [])

  // 记住本次设置
  function rememberSettings() {
    api.saveConfig({
      export_srt: doSrt, export_ass: doAss, export_video: doVideo,
      export_hard: hard, export_dir: outDir,
    }).catch(() => {})
  }

  // 烧录预览帧：样式/轨道/时间变化后防抖刷新
  useEffect(() => {
    if (!doVideo || !hard || !media) return
    let cancelled = false
    setPreview((p) => ({ ...p, loading: true }))
    const timer = setTimeout(async () => {
      try {
        const r = await api.previewFrame({
          tracks, bilingual, primary_id: primaryTrackId,
          width: media.width || 1920, height: media.height || 1080,
          video_path: videoPath, burn_track_id: burnTrackId || null,
          time: parseFloat(previewTime) || 0,
        })
        if (!cancelled) setPreview({ img: r.image, loading: false, err: '' })
      } catch (e) {
        if (!cancelled) setPreview((p) => ({ ...p, loading: false, err: e instanceof Error ? e.message : String(e) }))
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [doVideo, hard, media, tracks, bilingual, primaryTrackId, videoPath, burnTrackId, previewTime])

  async function run() {
    if (!media || busy) return
    setMsg('')
    setBusy(true)
    setProg(null)
    try {
      const common = {
        tracks, bilingual, primary_id: primaryTrackId,
        width: media.width || 1920, height: media.height || 1080,
      }
      if (doSrt || doAss) {
        const dir = await window.subcraft.selectDirDialog()
        if (dir) {
          setOutDir(dir)
          rememberSettings()
          const formats = [doSrt && 'srt', doAss && 'ass'].filter(Boolean) as string[]
          const r = await api.exportSubtitles({ ...common, out_dir: dir, base_name: baseName, formats })
          setMsg(`Exported ${r.files.length} subtitle file(s)`)
        }
      }
      if (doVideo) {
        const ext = hard ? 'mp4' : 'mkv'
        const suggested = outDir ? `${outDir.replace(/[\\/]+$/, '')}/${baseName}_${hard ? 'burned' : 'softsub'}.${ext}` : `${baseName}_${hard ? 'burned' : 'softsub'}.${ext}`
        const out = await window.subcraft.saveFileDialog(suggested, ext)
        if (out) {
          rememberSettings()
          const { task_id } = await api.exportVideo({
            ...common, video_path: videoPath, out_path: out,
            mode: hard ? 'hard' : 'soft',
            burn_track_id: hard && burnTrackId ? burnTrackId : null,
          })
          setTask({ task_id, status: 'running', progress: 0, message: hard ? 'Burning subtitles' : 'Muxing', error: null, label: 'Export' })
          await waitTask(task_id, (t) => {
            setTask({ ...t, label: 'Export' })
            setProg({ pct: Math.min(100, Math.max(0, Math.round(t.progress * 100))), msg: t.message || '' })
          })
          setTask(null)
          setMsg((m) => `${m}${m ? '; ' : ''}${hard ? 'Video exported (subtitles burned into the picture)' : 'Video exported (soft subtitles muxed)'}`)
        }
      }
      if (!doSrt && !doAss && !doVideo) setMsg('Select at least one item to export')
    } catch (e) {
      const cur = useStore.getState().task
      if (cur?.status !== 'cancelled') {
        setMsg(`Export failed: ${e instanceof Error ? e.message : e}`)
        setTask({ task_id: '', status: 'error', progress: 1, message: '', error: e instanceof Error ? e.message : String(e), label: 'Export' })
      } else {
        setMsg('Export cancelled')
        setTask(null)
      }
    } finally {
      setBusy(false)
      setProg(null)
    }
  }

  return createPortal(
    <div className="dialog-mask" onClick={busy ? (e) => e.stopPropagation() : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>③ Export</h3>
        <div className="row"><label>Export items</label>
          <div className="checkbox-row">
            <label><input type="checkbox" disabled={busy} checked={doSrt} onChange={(e) => setDoSrt(e.target.checked)} />SRT subtitle file</label>
            <label><input type="checkbox" disabled={busy} checked={doAss} onChange={(e) => setDoAss(e.target.checked)} />ASS subtitle file (with styles)</label>
            <label><input type="checkbox" disabled={busy} checked={doVideo} onChange={(e) => setDoVideo(e.target.checked)} />Export video</label>
          </div>
        </div>
        {doVideo && (
          <div className="row"><label>Video mode</label>
            <div className="checkbox-row">
              <label><input type="radio" name="vmode" disabled={busy} checked={!hard} onChange={() => setHard(false)} />Soft subtitles (mux)</label>
              <label><input type="radio" name="vmode" disabled={busy} checked={hard} onChange={() => setHard(true)} />Burned-in subtitles</label>
            </div>
          </div>
        )}
        {doVideo && hard && (
          <div className="row"><label>Burn track</label>
            <select value={burnTrackId} onChange={(e) => setBurnTrackId(e.target.value)}>
              <option value="">Auto{bilingual && tracks.length >= 2 ? ' (bilingual)' : ' (primary track)'}</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.label || t.language}</option>
              ))}
            </select>
          </div>
        )}
        {doVideo && hard && (
          <div className="burn-preview">
            <div className="row" style={{ marginBottom: 6 }}>
              <label>Preview time (s)</label>
              <input
                value={previewTime}
                onChange={(e) => setPreviewTime(e.target.value)}
                style={{ flex: '0 0 90px' }}
              />
              <button onClick={() => setPreviewTime(playerTime().toFixed(2))}>Use player time</button>
            </div>
            {preview.err ? (
              <div className="hint" style={{ color: 'var(--danger)' }}>Preview failed: {preview.err}</div>
            ) : preview.img ? (
              <img className={preview.loading ? 'loading' : ''} src={preview.img} alt="Burn-in preview" />
            ) : (
              <div className="hint">Generating preview frame...</div>
            )}
            <div className="hint">Preview and final export use the same rendering engine (ffmpeg + libass) — what you see is what you get</div>
          </div>
        )}
        <div className="hint">
          · One file per language{bilingual && tracks.length >= 2 ? ', plus a merged bilingual file' : ''}<br />
          · Soft subtitles: MKV with toggleable subtitle tracks, video stream is copied, <b>100% lossless</b>, finishes in seconds (also includes an SRT compatibility track). Note: the built-in
          Windows player doesn't support ASS soft subtitles — use <b>VLC / PotPlayer / mpv</b><br />
          · Burned-in: subtitles are rendered into the picture, <b>visible in any player</b>, but the video is re-encoded and slower (crf 18, high quality)
        </div>
        {busy && prog && (
          <div className="export-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
            </div>
            <div className="hint">{prog.pct}% — {prog.msg || 'Working...'}</div>
          </div>
        )}
        {busy && !prog && <div className="hint">Starting export...</div>}
        {msg && <div className="hint" style={{ color: msg.startsWith('Export failed') ? 'var(--danger)' : 'var(--accent2)' }}>{msg}</div>}
        <div className="actions">
          <button onClick={onClose} disabled={busy}>{busy ? 'Exporting…' : 'Close'}</button>
          <button className="success" onClick={run} disabled={busy}>Start Export</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
