// 批量对话框：对一个文件夹里的所有视频依次「识别 →（可选翻译）→ 导出」，与 CLI/MCP 共用后端流水线
// 选择（除文件夹/输出目录外）都会保存到配置，下次打开自动恢复；导出期间在对话框内显示实时进度条
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, waitTask } from '../api'
import { useStore } from '../store'
import { LANGUAGES, type AiProvider, type AsrEngineId, type AsrModels } from '../types'

type BatchSummary = {
  total: number; done: number; skipped: number; failed: number
  elapsed_sec?: number; message?: string; report_path?: string
  items?: { index: number; input: string; status: string; error?: string; elapsed_sec?: number }[]
}

export default function BatchDialog({ onClose }: { onClose: () => void }) {
  const { setTask, task } = useStore()
  const [folder, setFolder] = useState('')
  const [outDir, setOutDir] = useState('')            // '' = 原目录（不持久化）
  const [recursive, setRecursive] = useState(false)
  const [engine, setEngine] = useState<AsrEngineId>('local')
  const [model, setModel] = useState('large-v3-turbo')
  const [models, setModels] = useState<AsrModels | null>(null)
  const [language, setLanguage] = useState('auto')
  const [target, setTarget] = useState('')            // '' = 只识别，不翻译
  const [choice, setChoice] = useState('')            // 'ai:<id>' / 'deepl' / ''
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [doSrt, setDoSrt] = useState(true)
  const [doAss, setDoAss] = useState(true)
  const [videoMode, setVideoMode] = useState<'' | 'soft' | 'hard'>('')
  const [snapCuts, setSnapCuts] = useState(false)
  const [err, setErr] = useState('')
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [prog, setProg] = useState<{ pct: number; msg: string } | null>(null)
  const busy = task?.status === 'running' && task?.label === 'Batch'

  useEffect(() => {
    api.asrModels().then(setModels).catch(() => {})
    api.getConfig().then((c) => {
      const list = c.ai_providers ?? []
      setProviders(list)
      // 恢复上次的选择（引擎/模型/语言/翻译服务与识别、翻译对话框共用；批量专属选项用 batch_ 前缀）
      if (c.asr_engine === 'local' || c.asr_engine === 'parakeet' || c.asr_engine === 'openai') setEngine(c.asr_engine)
      // 模型按引擎分开记忆：parakeet 用 parakeet_model，其余用 whisper_model
      const savedModel = c.asr_engine === 'parakeet' ? c.parakeet_model : c.whisper_model
      if (savedModel) setModel(savedModel)
      if (c.whisper_language) setLanguage(c.whisper_language)
      if (typeof c.batch_recursive === 'boolean') setRecursive(c.batch_recursive)
      if (typeof c.batch_snap_cuts === 'boolean') setSnapCuts(c.batch_snap_cuts)
      if (typeof c.batch_srt === 'boolean') setDoSrt(c.batch_srt)
      if (typeof c.batch_ass === 'boolean') setDoAss(c.batch_ass)
      if (typeof c.batch_video === 'string' && ['' as string, 'soft', 'hard'].includes(c.batch_video)) setVideoMode(c.batch_video as '' | 'soft' | 'hard')
      if (typeof c.export_dir === 'string') setOutDir(c.export_dir)
      if (c.translate_target) setTarget(c.translate_target)
      if (typeof c.translate_choice === 'string' && c.translate_choice) setChoice(c.translate_choice)
      else {
        const first = list.find((p) => p.api_key_set) ?? list[0]
        setChoice(first ? `ai:${first.id}` : 'deepl')
      }
    }).catch(() => {})
  }, [])

  // 引擎切换后，模型默认取该引擎的第一个（若当前模型不属于该引擎）
  useEffect(() => {
    const list = models?.[engine]
    if (list && Object.keys(list).length && !list[model]) setModel(Object.keys(list)[0])
  }, [engine, models])

  const engineModels = models?.[engine] ?? {}
  const needProvider = !!target && (choice === 'deepl' ? false : !(providers.find((p) => p.id === choice.slice(3))?.api_key_set))

  // 记住本次选择（文件夹与输出目录除外）
  function rememberSettings() {
    api.saveConfig({
      asr_engine: engine,
      ...(engine === 'parakeet' ? { parakeet_model: model } : { whisper_model: model }),
      whisper_language: language,
      batch_recursive: recursive,
      batch_snap_cuts: snapCuts,
      batch_srt: doSrt,
      batch_ass: doAss,
      batch_video: videoMode,
      translate_target: target,
      translate_choice: choice,
    }).catch(() => {})
  }

  async function pickFolder() {
    const dir = await window.subcraft.selectDirDialog()
    if (dir) setFolder(dir)
  }
  async function pickOutDir() {
    const dir = await window.subcraft.selectDirDialog()
    if (dir) setOutDir(dir)
  }

  async function start() {
    if (!folder || busy) return
    const formats = [doSrt && 'srt', doAss && 'ass'].filter(Boolean) as string[]
    if (!formats.length && !videoMode) { setErr('Select at least one output format'); return }
    setErr('')
    rememberSettings()
    try {
      const { task_id } = await api.batchStart({
        folder,
        out_dir: outDir || null,
        recursive,
        target: target || null,
        provider: choice === 'deepl' ? 'deepl' : 'openai',
        provider_id: choice.startsWith('ai:') ? choice.slice(3) : null,
        engine,
        model,
        language: language === 'auto' ? null : language,
        formats: formats.length ? formats : undefined,
        video: videoMode || null,
        skip_existing: true,
        snap_cuts: snapCuts,
        split_cuts: false,
      })
      setTask({ task_id, status: 'running', progress: 0, message: 'Scanning folder', error: null, label: 'Batch' })
      const result = await waitTask(task_id, (t) => {
        setTask({ ...t, label: 'Batch' })
        setProg({ pct: Math.min(100, Math.max(0, Math.round(t.progress * 100))), msg: t.message || '' })
      })
      setSummary(result as unknown as BatchSummary)
      setTask(null)
    } catch (e) {
      const cur = useStore.getState().task
      if (cur?.status !== 'cancelled') {
        setTask({ task_id: '', status: 'error', progress: 1, message: '', error: e instanceof Error ? e.message : String(e), label: 'Batch' })
      }
    } finally {
      setProg(null)
    }
  }

  return createPortal(
    <div className="dialog-mask" onClick={busy ? (e) => e.stopPropagation() : onClose}>
      <div className="dialog wide batch-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>④ Batch folder</h3>
        <div className="row"><label>Folder</label>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/path/to/episodes" style={{ flex: 1, minWidth: 0 }} />
          <button onClick={pickFolder}>Browse…</button>
        </div>
        <div className="row"><label>Options</label>
          <div className="checkbox-row">
            <label><input type="checkbox" disabled={busy} checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />Include subfolders</label>
            <label><input type="checkbox" disabled={busy} checked={snapCuts} onChange={(e) => setSnapCuts(e.target.checked)} />Snap to shot cuts</label>
          </div>
        </div>
        <div className="row"><label>Engine</label>
          <select value={engine} onChange={(e) => setEngine(e.target.value as AsrEngineId)} disabled={busy} style={{ flex: '1 1 220px', minWidth: 0 }}>
            <option value="local">Local faster-whisper (GPU, all languages)</option>
            <option value="parakeet">Local Parakeet (NVIDIA, ONNX, fastest)</option>
            <option value="openai">OpenAI Whisper API (cloud)</option>
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} title={engineModels[model]?.langs} style={{ flex: '1 1 220px', minWidth: 0 }}>
            {Object.entries(engineModels).map(([k, m]) => <option key={k} value={k} title={m.langs}>{m.label}</option>)}
            {Object.keys(engineModels).length === 0 && <option value={model}>{model}</option>}
          </select>
        </div>
        <div className="row"><label>Language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy} style={{ flex: '1 1 220px', minWidth: 0 }}>
            {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="hint batch-model-hint" title={engineModels[model]?.langs}>{engineModels[model]?.langs}</span>
        </div>
        <div className="row"><label>Translate to</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} style={{ flex: '1 1 220px', minWidth: 0 }}>
            <option value="">— No translation (transcribe only) —</option>
            {Object.entries(LANGUAGES).filter(([k]) => k !== 'auto').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {target && (
            <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy} style={{ flex: '1 1 220px', minWidth: 0 }}>
              <optgroup label="AI translation (OpenAI-compatible)">
                {providers.map((p) => (
                  <option key={p.id} value={`ai:${p.id}`}>{p.name} ({p.model || 'no model'}){p.api_key_set ? '' : ' ⚠ not configured'}</option>
                ))}
                {providers.length === 0 && <option disabled>No providers — add one in Settings</option>}
              </optgroup>
              <optgroup label="DeepL">
                <option value="deepl">DeepL API</option>
              </optgroup>
            </select>
          )}
        </div>
        {target && needProvider && (
          <div className="hint" style={{ color: 'var(--danger)' }}>The selected translation service has no API key — configure it in Settings first.</div>
        )}
        <div className="row"><label>Outputs</label>
          <div className="checkbox-row">
            <label><input type="checkbox" disabled={busy} checked={doSrt} onChange={(e) => setDoSrt(e.target.checked)} />SRT</label>
            <label><input type="checkbox" disabled={busy} checked={doAss} onChange={(e) => setDoAss(e.target.checked)} />ASS</label>
            <label><input type="radio" name="bvm" disabled={busy} checked={videoMode === ''} onChange={() => setVideoMode('')} />No video</label>
            <label><input type="radio" name="bvm" disabled={busy} checked={videoMode === 'soft'} onChange={() => setVideoMode('soft')} />Soft MKV</label>
            <label><input type="radio" name="bvm" disabled={busy} checked={videoMode === 'hard'} onChange={() => setVideoMode('hard')} />Burned MP4</label>
          </div>
        </div>
        <div className="row"><label>Output dir</label>
          <input value={outDir} onChange={(e) => setOutDir(e.target.value)} placeholder="(same folder as each video)" style={{ flex: 1, minWidth: 0 }} disabled={busy} />
          <button onClick={pickOutDir} disabled={busy}>Browse…</button>
        </div>
        {busy && prog && (
          <div className="export-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
            </div>
            <div className="hint batch-progress-msg" title={prog.msg}>{prog.pct}% — {prog.msg || 'Working...'}</div>
          </div>
        )}
        {busy && !prog && <div className="hint">Scanning folder...</div>}
        {err && <div className="hint" style={{ color: 'var(--danger)' }}>{err}</div>}
        {summary && !busy && (
          <div className="batch-summary">
            <div className="hint">
              Done {summary.done} · Skipped {summary.skipped} · Failed {summary.failed} · Total {summary.total}
              {summary.elapsed_sec != null ? ` · ${summary.elapsed_sec}s` : ''}
            </div>
            {summary.failed > 0 && (
              <div className="batch-fails">
                {summary.items?.filter((i) => i.status === 'failed').map((i) => (
                  <div key={i.index} className="hint" style={{ color: 'var(--danger)' }}>
                    ✕ {i.input.split(/[\\/]/).pop()}: {i.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="actions">
          <button onClick={onClose} disabled={busy}>{busy ? 'Running…' : 'Close'}</button>
          <button className="primary" disabled={!folder || busy || (needProvider && !!target)} onClick={start}>
            {busy ? 'Batch running…' : 'Start Batch'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
