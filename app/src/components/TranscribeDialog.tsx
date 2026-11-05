// 识别字幕对话框：选择引擎(本地whisper/Parakeet/云端API)、模型、语言；选择会保存到配置，下次打开自动恢复
// 每个模型悬浮显示「擅长语言」提示，帮助选择合适的模型
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, waitTask } from '../api'
import { newTrack, useStore } from '../store'
import { LANGUAGES, type AsrEngineId, type AsrModels, type Segment } from '../types'

const ENGINE_LABELS: Record<AsrEngineId, string> = {
  local: 'Local faster-whisper (GPU accelerated, free, 99 languages)',
  parakeet: 'Local NVIDIA Parakeet (ONNX, fastest, English/European)',
  openai: 'OpenAI Whisper API (cloud, needs API key)',
}

export default function TranscribeDialog({ onClose }: { onClose: () => void }) {
  const { media, videoPath, upsertTrack, setTask } = useStore()
  const [engine, setEngine] = useState<AsrEngineId>('local')
  const [model, setModel] = useState('large-v3-turbo')
  const [language, setLanguage] = useState('auto')
  const [models, setModels] = useState<AsrModels | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.asrModels().then(setModels).catch(() => {})
    api.getConfig().then((c) => {
      if (c.asr_engine === 'local' || c.asr_engine === 'parakeet' || c.asr_engine === 'openai') setEngine(c.asr_engine)
      // 模型按引擎分开记忆：whisper 用 whisper_model，parakeet 用 parakeet_model
      if (c.asr_engine === 'parakeet' && c.parakeet_model) setModel(c.parakeet_model)
      else if (c.whisper_model) setModel(c.whisper_model)
      if (c.whisper_language) setLanguage(c.whisper_language)
    }).catch(() => {})
  }, [])

  // 引擎切换后，模型默认取该引擎的第一个（parakeet/openai 的模型列表与 whisper 不同）
  useEffect(() => {
    const list = models?.[engine]
    if (list && Object.keys(list).length && !list[model]) setModel(Object.keys(list)[0])
  }, [engine, models])

  const engineModels = models?.[engine] ?? {}
  const selectedInfo = engineModels[model]

  async function start() {
    if (!media) return
    // 记住本次选择（引擎/模型/语言），下次打开对话框自动恢复
    api.saveConfig({
      asr_engine: engine,
      ...(engine === 'parakeet' ? { parakeet_model: model } : { whisper_model: model }),
      whisper_language: language,
    }).catch(() => {})
    onClose()
    try {
      const { task_id } = await api.transcribe({
        video_path: videoPath, duration: media.duration,
        engine, model: engine === 'openai' ? null : model,
        language: language === 'auto' ? null : language,
      })
      setTask({ task_id, status: 'running', progress: 0, message: 'Starting', error: null, label: 'Transcribe' })
      const result = await waitTask(task_id, (t) => setTask({ ...t, label: 'Transcribe' }))
      const segments = (result.segments ?? []) as Segment[]
      const lang = (result.language as string) || 'und'
      if (segments.length === 0) {
        setTask({ task_id, status: 'error', progress: 1, message: '', error: 'No speech detected in the audio', label: 'Transcribe' })
        return
      }
      upsertTrack(newTrack({ language: lang, role: 'source', segments, label: LANGUAGES[lang] ?? lang }))
      setTask(null)
    } catch (e) {
      const cur = useStore.getState().task
      if (cur?.status !== 'cancelled') {
        setTask({ task_id: '', status: 'error', progress: 1, message: '', error: e instanceof Error ? e.message : String(e), label: 'Transcribe' })
      }
    }
  }

  return createPortal(
    <div className="dialog-mask" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>① Transcribe (speech to text)</h3>
        <div className="row">
          <label>Engine</label>
          <select value={engine} onChange={(e) => setEngine(e.target.value as AsrEngineId)}>
            {(Object.keys(ENGINE_LABELS) as AsrEngineId[]).map((k) => <option key={k} value={k}>{ENGINE_LABELS[k]}</option>)}
          </select>
        </div>
        {engine === 'openai' ? (
          <div className="hint">Uses the OpenAI-compatible provider configured in "Settings" (whisper-1 model).<br />Note: the cloud API is billed by usage and limited to 25MB per file.</div>
        ) : (
          <div className="row">
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {Object.entries(engineModels).map(([k, m]) => <option key={k} value={k} title={m.langs}>{m.label}</option>)}
              {Object.keys(engineModels).length === 0 && <option value={model}>{model}</option>}
            </select>
          </div>
        )}
        {selectedInfo && <div className="hint">💡 {selectedInfo.langs}</div>}
        <div className="row">
          <label>Video language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {err && <div className="hint" style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => { setErr(''); start() }}>Start Transcription</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
