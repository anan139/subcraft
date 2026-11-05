// 顶栏：导入视频 → 识别 → 翻译 → 导出 主流程 + 批量 + 设置 + 进度显示
import { useState } from 'react'
import { useStore } from '../store'
import { importVideoPath } from '../videoImport'
import TranscribeDialog from './TranscribeDialog'
import TranslateDialog from './TranslateDialog'
import ExportDialog from './ExportDialog'
import BatchDialog from './BatchDialog'
import SettingsDialog from './SettingsDialog'

export default function TopBar({ sysOk }: { sysOk: { ffmpeg: boolean; cuda: boolean } | null }) {
  const { media, tracks, task } = useStore()
  const [dialog, setDialog] = useState<'' | 'transcribe' | 'translate' | 'export' | 'batch' | 'settings'>('')
  const busy = task?.status === 'running'

  async function importVideo() {
    const path = await window.subcraft.openVideoDialog()
    if (path) await importVideoPath(path)
  }

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <span className="title">🎬 SubCraft</span>
        <span className="title-badge">LORENTZ MATRIX</span>
      </div>

      <div className="workflow-pipeline">
        <button
          className="quantum-btn btn-import"
          onClick={importVideo}
          disabled={busy}
          title="Import a local video file"
        >
          <span className="btn-step">00</span>
          <span>Import Video</span>
        </button>

        <span className="pipeline-connector">›</span>

        <button
          className="quantum-btn primary btn-transcribe"
          disabled={!media || busy}
          onClick={() => setDialog('transcribe')}
          title="Transcribe the video audio track into subtitles"
        >
          <span className="btn-step">01</span>
          <span>Transcribe</span>
        </button>

        <span className="pipeline-connector">›</span>

        <button
          className="quantum-btn primary btn-translate"
          disabled={!tracks.some((t) => t.role === 'source') || busy}
          onClick={() => setDialog('translate')}
          title="Translate the source-language subtitles into the target language"
        >
          <span className="btn-step">02</span>
          <span>Translate</span>
        </button>

        <span className="pipeline-connector">›</span>

        <button
          className="quantum-btn success btn-export"
          disabled={tracks.length === 0 || busy}
          onClick={() => setDialog('export')}
          title="Export SRT/ASS files, mux soft subtitles or burn them into the video"
        >
          <span className="btn-step">03</span>
          <span>Export</span>
        </button>

        <span className="pipeline-connector">›</span>

        <button
          className="quantum-btn btn-batch"
          disabled={busy}
          onClick={() => setDialog('batch')}
          title="Batch process a whole folder: transcribe (+ translate) + export for every video"
        >
          <span className="btn-step">04</span>
          <span>Batch</span>
        </button>
      </div>

      {media && (
        <span className="media-name" title={media.path}>
          [FILE: {media.name}] {media.width}×{media.height} {media.video_codec.toUpperCase()}
        </span>
      )}

      <div className="topbar-right">
        <button
          className="quantum-btn btn-settings"
          onClick={() => setDialog('settings')}
          title="Configure AI translation providers and system parameters"
        >
          ⚙ Settings
        </button>

        {sysOk && (
          <span className="sys-diag">
            <span>
              <span className={`status-dot ${sysOk.ffmpeg ? 'ok' : 'bad'}`} />
              FFMPEG
            </span>
            <span style={{ marginLeft: 6 }}>
              <span className={`status-dot ${sysOk.cuda ? 'ok' : 'bad'}`} />
              {sysOk.cuda ? 'CUDA' : 'CPU'}
            </span>
          </span>
        )}

        <div className="progress-wrap">
          {task && (
            <>
              <div className="progress-bar">
                <div style={{ width: `${(task.progress * 100).toFixed(0)}%` }} />
              </div>
              <span className="progress-msg" title={task.message}>
                [{task.label}] {task.status === 'error' ? `FAIL: ${task.error}` : task.message}
              </span>
            </>
          )}
        </div>
      </div>

      {dialog === 'transcribe' && <TranscribeDialog onClose={() => setDialog('')} />}
      {dialog === 'translate' && <TranslateDialog onClose={() => setDialog('')} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog('')} />}
      {dialog === 'batch' && <BatchDialog onClose={() => setDialog('')} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog('')} />}
    </div>
  )
}
