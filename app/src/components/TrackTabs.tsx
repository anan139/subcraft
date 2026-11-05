// 字幕轨标签栏 + 双语开关 + 主语言选择
import { LANGUAGES } from '../types'
import { useStore } from '../store'

export default function TrackTabs() {
  const { tracks, activeTrackId, setActiveTrack, removeTrack, bilingual, setBilingual, primaryTrackId, setPrimaryTrack, removeEmptySegments } = useStore()
  const emptyCount = tracks.reduce((n, t) => n + t.segments.filter((s) => !s.text.trim()).length, 0)

  return (
    <div className="track-tabs">
      {tracks.map((t) => (
        <div
          key={t.id}
          className={`track-tab ${t.id === activeTrackId ? 'active' : ''}`}
          onClick={() => setActiveTrack(t.id)}
          title={t.role === 'source' ? 'Source language track' : 'Translation track'}
        >
          <span>{LANGUAGES[t.language] ?? t.language}</span>
          <span className="badge">{t.role === 'source' ? 'SRC' : 'TRN'}:{t.segments.length}</span>
          {bilingual && tracks.length >= 2 && (
            <span
              className="badge"
              title="Set as primary language (shown on top in bilingual subtitles)"
              style={primaryTrackId === t.id ? { color: 'var(--quantum-blue)', borderColor: 'var(--quantum-blue)', fontWeight: 'bold' } : {}}
              onClick={(e) => { e.stopPropagation(); setPrimaryTrack(t.id) }}
            >
              {primaryTrackId === t.id ? '★ PRI' : 'SET PRI'}
            </span>
          )}
          <span className="del" title="Remove this track" onClick={(e) => { e.stopPropagation(); removeTrack(t.id) }}>✕</span>
        </div>
      ))}
      {tracks.length >= 2 && (
        <div className="bilingual-toggle">
          <input id="bi" type="checkbox" checked={bilingual} onChange={(e) => setBilingual(e.target.checked)} />
          <label htmlFor="bi">Bilingual</label>
        </div>
      )}
      {emptyCount > 0 && (
        <button
          className="clean-empty"
          title="Remove all segments with empty text (all tracks)"
          onClick={removeEmptySegments}
        >
          ⚠ Clean {emptyCount} empty
        </button>
      )}
      {tracks.length === 0 && (
        <span style={{ color: 'var(--quantum-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          [TRACK_MATRIX_EMPTY] Click "① Transcribe" first
        </span>
      )}
    </div>
  )
}
