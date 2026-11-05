// 翻译对话框：源轨 → 目标语言，选择翻译服务（AI 厂商 / DeepL）
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, waitTask } from '../api'
import { newTrack, useStore } from '../store'
import { LANGUAGES, type AiProvider, type Segment, DEFAULT_STYLE } from '../types'

export default function TranslateDialog({ onClose }: { onClose: () => void }) {
  const { tracks, upsertTrack, setTask } = useStore()
  const sourceTracks = tracks.filter((t) => t.segments.length > 0)
  const [sourceId, setSourceId] = useState(sourceTracks.find((t) => t.role === 'source')?.id ?? sourceTracks[0]?.id ?? '')
  const [target, setTarget] = useState('en')
  // 选择值: "ai:<providerId>" 或 "deepl"
  const [choice, setChoice] = useState('deepl')
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [deeplSet, setDeeplSet] = useState(false)

  useEffect(() => {
    api.getConfig().then((c) => {
      const list = c.ai_providers ?? []
      setProviders(list)
      setDeeplSet(!!c.deepl_api_key_set)
      // 恢复上次的选择：目标语言与翻译服务
      if (c.translate_target && LANGUAGES[c.translate_target]) setTarget(c.translate_target)
      const saved = typeof c.translate_choice === 'string' ? c.translate_choice : undefined
      const savedProvider = saved?.startsWith('ai:') ? list.find((p) => p.id === saved.slice(3)) : null
      if (saved === 'deepl' && c.deepl_api_key_set) setChoice('deepl')
      else if (savedProvider) setChoice(`ai:${savedProvider.id}`)
      else {
        const first = list.find((p) => p.api_key_set) ?? list[0]
        setChoice(first ? `ai:${first.id}` : 'deepl')
      }
    }).catch(() => {})
  }, [])

  const source = tracks.find((t) => t.id === sourceId)
  const selectedProvider = choice.startsWith('ai:') ? providers.find((p) => p.id === choice.slice(3)) : null
  const notConfigured = choice === 'deepl' ? !deeplSet : !selectedProvider?.api_key_set

  async function start() {
    if (!source) return
    const isAi = choice.startsWith('ai:')
    // 记住本次选择（目标语言与翻译服务），下次打开对话框自动恢复
    api.saveConfig({ translate_target: target, translate_choice: choice }).catch(() => {})
    onClose()
    try {
      const { task_id } = await api.translate({
        segments: source.segments, source_lang: source.language,
        target_lang: target,
        provider: isAi ? 'openai' : 'deepl',
        provider_id: isAi ? choice.slice(3) : null,
      })
      setTask({ task_id, status: 'running', progress: 0, message: 'Starting', error: null, label: 'Translate' })
      const result = await waitTask(task_id, (t) => setTask({ ...t, label: 'Translate' }))
      const segments = (result.segments ?? []) as Segment[]
      upsertTrack(newTrack({
        language: target, role: 'translation', segments,
        label: LANGUAGES[target] ?? target,
        style: { ...DEFAULT_STYLE, font_size: Math.round(source.style.font_size * 0.7), primary_color: '#FFFF99' },
      }))
      setTask(null)
    } catch (e) {
      setTask({ task_id: '', status: 'error', progress: 1, message: '', error: e instanceof Error ? e.message : String(e), label: 'Translate' })
    }
  }

  return createPortal(
    <div className="dialog-mask" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>② Translate subtitles</h3>
        <div className="row">
          <label>Source track</label>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sourceTracks.map((t) => <option key={t.id} value={t.id}>{LANGUAGES[t.language] ?? t.language} ({t.segments.length} lines)</option>)}
          </select>
        </div>
        <div className="row">
          <label>Target language</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {Object.entries(LANGUAGES).filter(([k]) => k !== 'auto' && k !== source?.language).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="row">
          <label>Service</label>
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <optgroup label="AI translation (OpenAI-compatible)">
              {providers.map((p) => (
                <option key={p.id} value={`ai:${p.id}`}>{p.name} ({p.model || 'no model'}){p.api_key_set ? '' : ' ⚠ not configured'}</option>
              ))}
              {providers.length === 0 && <option disabled>No providers added — add one in Settings</option>}
            </optgroup>
            <optgroup label="DeepL">
              <option value="deepl">DeepL API{deeplSet ? '' : ' ⚠ not configured'}</option>
            </optgroup>
          </select>
        </div>
        {notConfigured && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            This service has no API key yet. Add one in "⚙ Settings" and verify with "Test connection".
          </div>
        )}
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!source || notConfigured} onClick={start}>Start Translation</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
