import { useEffect, useState } from 'react'
import { api, connectWs } from './api'
import TopBar from './components/TopBar'
import VideoPlayer from './components/VideoPlayer'
import SubtitleList from './components/SubtitleList'
import StylePanel from './components/StylePanel'
import TrackTabs from './components/TrackTabs'
import TimelineTools from './components/TimelineTools'
import { useStore } from './store'
import { importDroppedFiles } from './videoImport'

// 供自动化冒烟测试驱动 UI（无头验证用）
;(window as unknown as Record<string, unknown>).__subcraft_test = { api, store: useStore }

export default function App() {
  const { setFonts, setTask } = useStore()
  const [sysOk, setSysOk] = useState<{ ffmpeg: boolean; cuda: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    api.fonts().then(setFonts).catch(() => {})
    api.systemStatus().then((s) => setSysOk({ ffmpeg: s.ffmpeg_ready, cuda: s.cuda_available })).catch(() => {})
    const close = connectWs((t) => {
      const cur = useStore.getState().task
      if (cur && cur.task_id === t.task_id) setTask({ ...t, label: cur.label })
    })
    return close
  }, [])

  // 拖拽视频文件到窗口任意位置即可导入
  useEffect(() => {
    let depth = 0
    const hasVideo = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragEnter = (e: DragEvent) => {
      if (!hasVideo(e)) return
      e.preventDefault()
      depth++
      setDragOver(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasVideo(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasVideo(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragOver(false)
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragOver(false)
      if (e.dataTransfer) await importDroppedFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <div className="app">
      <TopBar sysOk={sysOk} />
      <div className="main">
        <div className="left">
          <VideoPlayer />
          <StylePanel />
        </div>
        <div className="right">
          <TrackTabs />
          <TimelineTools />
          <SubtitleList />
        </div>
      </div>
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="big">⬇</div>
            <div className="drop-title">Drop video file to import</div>
          </div>
        </div>
      )}
    </div>
  )
}
