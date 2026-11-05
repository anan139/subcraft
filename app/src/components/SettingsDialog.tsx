// 设置对话框：AI 翻译厂商（OpenAI 兼容，可多家）与 DeepL 分区管理，支持测试连接
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import type { AiProvider, AppConfig } from '../types'
import { AI_PRESETS } from '../types'

type TestResult = { ok: boolean; message: string } | 'testing'

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [tests, setTests] = useState<Record<string, TestResult>>({})

  useEffect(() => { api.getConfig().then(setCfg).catch(() => {}) }, [])

  if (!cfg) return null
  const providers = cfg.ai_providers ?? []

  const set = (k: string, v: unknown) => { setCfg({ ...cfg, [k]: v }); setSaved(false) }
  const setProvider = (id: string, patch: Partial<AiProvider>) => {
    set('ai_providers', providers.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    setTests((t) => ({ ...t, [id]: undefined as unknown as TestResult }))
  }
  const addProvider = (preset?: (typeof AI_PRESETS)[number]) => {
    const id = `p${Date.now().toString(36)}`
    set('ai_providers', [
      ...providers,
      { id, name: preset?.name ?? 'Custom provider', base_url: preset?.base_url ?? '', model: preset?.model ?? '', api_key: '' },
    ])
  }
  const removeProvider = (id: string) => set('ai_providers', providers.filter((p) => p.id !== id))

  async function save(): Promise<boolean> {
    if (!cfg) return false
    try {
      setCfg(await api.saveConfig(cfg))
      setSaved(true)
      return true
    } catch (e) {
      alert(`Failed to save: ${e instanceof Error ? e.message : e}`)
      return false
    }
  }

  async function test(provider: 'openai' | 'deepl', id: string) {
    if (!(await save())) return  // 测试前先保存，确保后端用最新配置
    setTests((t) => ({ ...t, [id]: 'testing' }))
    try {
      const r = await api.testTranslate({ provider, provider_id: provider === 'deepl' ? null : id })
      setTests((t) => ({ ...t, [id]: { ok: r.ok, message: r.message } }))
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, message: e instanceof Error ? e.message : String(e) } }))
    }
  }

  const testBadge = (id: string) => {
    const r = tests[id]
    if (!r) return null
    if (r === 'testing') return <span className="test-badge testing">Testing…</span>
    return <span className={`test-badge ${r.ok ? 'ok' : 'fail'}`}>{r.ok ? '✓ ' : '✗ '}{r.message}</span>
  }

  return createPortal(
    <div className="dialog-mask" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h3>⚙ Settings</h3>

        {/* ── AI 翻译接口（OpenAI 兼容，支持多厂商）── */}
        <div className="section-head">
          <span>AI translation providers (OpenAI-compatible, add multiple)</span>
        </div>
        {providers.length === 0 && <div className="hint" style={{ marginBottom: 10 }}>No providers yet — click a button below to add one. Translation and cloud transcription both use these.</div>}
        {providers.map((p) => (
          <div key={p.id} className="provider-card">
            <div className="provider-head">
              <input className="provider-name" value={p.name} onChange={(e) => setProvider(p.id, { name: e.target.value })} placeholder="Provider name" />
              <button className="test-btn" onClick={() => test('openai', p.id)} disabled={tests[p.id] === 'testing'}>Test connection</button>
              <button className="del-btn" title="Remove this provider" onClick={() => removeProvider(p.id)}>✕</button>
            </div>
            <div className="row"><label>Base URL</label>
              <input value={p.base_url} onChange={(e) => setProvider(p.id, { base_url: e.target.value })} placeholder="https://api.example.com/v1" /></div>
            <div className="row"><label>API Key</label>
              <input type="password" value={p.api_key} onChange={(e) => setProvider(p.id, { api_key: e.target.value })} placeholder={p.api_key_set ? 'Saved (type to replace)' : 'sk-...'} /></div>
            <div className="row"><label>Model</label>
              <input value={p.model} onChange={(e) => setProvider(p.id, { model: e.target.value })} placeholder="gpt-4o-mini / deepseek-chat / ..." /></div>
            {testBadge(p.id)}
          </div>
        ))}
        <div className="preset-row">
          <button onClick={() => addProvider()}>+ Blank provider</button>
          {AI_PRESETS.map((preset) => (
            <button key={preset.name} className="preset-btn" onClick={() => addProvider(preset)}>+ {preset.name}</button>
          ))}
        </div>

        {/* ── DeepL ── */}
        <div className="section-head"><span>DeepL translation</span></div>
        <div className="row"><label>DeepL API Key</label>
          <input type="password" value={cfg.deepl_api_key} onChange={(e) => set('deepl_api_key', e.target.value)} placeholder={cfg.deepl_api_key_set ? 'Saved (type to replace)' : 'xxx:fx (free keys end with :fx)'} />
          <button className="test-btn" onClick={() => test('deepl', 'deepl')} disabled={tests['deepl'] === 'testing'}>Test connection</button></div>
        {testBadge('deepl')}

        {/* ── 语音识别 ── */}
        <div className="section-head"><span>Speech recognition</span></div>
        <div className="row"><label>Model</label>
          <input value={cfg.whisper_model} onChange={(e) => set('whisper_model', e.target.value)} /></div>
        <div className="row"><label>Device</label>
          <select value={cfg.whisper_device} onChange={(e) => set('whisper_device', e.target.value)}>
            <option value="auto">Auto (prefer GPU)</option>
            <option value="cuda">Force GPU (CUDA)</option>
            <option value="cpu">Force CPU</option>
          </select></div>
        <div className="row"><label>Max line length</label>
          <input type="number" min={0} step={1} value={cfg.subtitle_max_units ?? 21}
            onChange={(e) => set('subtitle_max_units', Number(e.target.value))} />
          <span className="hint" style={{ marginLeft: 8 }}>CJK chars count 1, latin chars 0.5; 0 = don't split</span></div>
        <div className="row"><label>Max duration (s)</label>
          <input type="number" min={1} step={0.5} value={cfg.subtitle_max_duration ?? 7}
            onChange={(e) => set('subtitle_max_duration', Number(e.target.value))} /></div>

        {/* ── 翻译术语表 ── */}
        <div className="section-head"><span>Translation glossary</span></div>
        <textarea className="glossary" rows={5} value={cfg.translation_glossary ?? ''}
          onChange={(e) => set('translation_glossary', e.target.value)}
          placeholder={'One entry per line: source=target\nOpenAI=OpenAI\nTony Stark=Tony Stark'}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
        <div className="hint">Terms found in the current batch are sent to the model together with the text, keeping names and terminology consistent.</div>

        <div className="hint">API keys are only stored in the local config file and never uploaded.</div>
        {saved && <div className="hint" style={{ color: 'var(--accent2)' }}>Saved ✓</div>}
        <div className="actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
