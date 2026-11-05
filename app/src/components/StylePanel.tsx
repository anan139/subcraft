// 当前字幕轨的样式编辑面板：字体/字号/颜色/粗斜体/描边/阴影/位置
// 位置有两种模式：对齐+边距（默认）与中心点坐标（拖动字幕或直接填 X/Y）
import { useStore } from '../store'
import type { SubtitleStyle } from '../types'
import { LANGUAGES } from '../types'

const ALIGNMENTS: Record<number, string> = {
  1: 'Bottom left [AN1]', 2: 'Bottom center [AN2]', 3: 'Bottom right [AN3]',
  4: 'Middle left [AN4]', 5: 'Center [AN5]', 6: 'Middle right [AN6]',
  7: 'Top left [AN7]', 8: 'Top center [AN8]', 9: 'Top right [AN9]',
}

export default function StylePanel() {
  const { tracks, activeTrackId, updateTrack, fonts } = useStore()
  const track = tracks.find((t) => t.id === activeTrackId)

  if (!track) {
    return (
      <div className="style-panel">
        <div className="style-hint">Select or import a subtitle track to edit its layout</div>
      </div>
    )
  }

  const setStyle = (patch: Partial<SubtitleStyle>) => updateTrack(track.id, { style: { ...track.style, ...patch } })
  const fontNames = Object.keys(fonts)
  const posMode = track.style.pos_x != null && track.style.pos_y != null

  return (
    <div className="style-panel">
      <h4>
        <span className="tag">{LANGUAGES[track.language] ?? track.language}</span>
      </h4>
      <div className="style-grid">
        <div className="style-item">
          <label>Font</label>
          <select value={track.style.font_name} onChange={(e) => setStyle({ font_name: e.target.value })} style={{ maxWidth: 170 }}>
            {!fontNames.includes(track.style.font_name) && <option value={track.style.font_name}>{track.style.font_name}</option>}
            {fontNames.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="style-item">
          <label>Size</label>
          <input type="number" min={8} max={200} value={track.style.font_size} onChange={(e) => setStyle({ font_size: +e.target.value || 48 })} />
        </div>
        <div className="style-item">
          <label>Primary</label>
          <input type="color" value={track.style.primary_color} onChange={(e) => setStyle({ primary_color: e.target.value })} title={track.style.primary_color} />
        </div>
        <div className="style-item">
          <label>Outline</label>
          <input type="color" value={track.style.outline_color} onChange={(e) => setStyle({ outline_color: e.target.value })} title={track.style.outline_color} />
        </div>
        <div className="style-item">
          <label>Outline w</label>
          <input type="number" min={0} max={10} step={0.5} value={track.style.outline} onChange={(e) => setStyle({ outline: +e.target.value })} />
        </div>
        <div className="style-item">
          <label>Shadow</label>
          <input type="number" min={0} max={10} step={0.5} value={track.style.shadow} onChange={(e) => setStyle({ shadow: +e.target.value })} />
        </div>
        {posMode ? (
          <>
            <div className="style-item">
              <label>X position</label>
              <input type="number" min={0} max={8000} value={Math.round(track.style.pos_x!)} onChange={(e) => setStyle({ pos_x: +e.target.value })} />
            </div>
            <div className="style-item">
              <label>Y position</label>
              <input type="number" min={0} max={8000} value={Math.round(track.style.pos_y!)} onChange={(e) => setStyle({ pos_y: +e.target.value })} />
            </div>
            <div className="style-item">
              <button className="pos-reset" title="Clear the center-point coordinates and return to alignment/margins" onClick={() => setStyle({ pos_x: null, pos_y: null })}>
                ↺ Reset layout
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="style-item">
              <label>Align</label>
              <select value={track.style.alignment} onChange={(e) => setStyle({ alignment: +e.target.value })}>
                {Object.entries(ALIGNMENTS).map(([v, name]) => <option key={v} value={v}>{name}</option>)}
              </select>
            </div>
            <div className="style-item">
              <label>Margin V</label>
              <input type="number" min={0} max={2000} value={track.style.margin_v} onChange={(e) => setStyle({ margin_v: +e.target.value })} />
            </div>
            <div className="style-item">
              <label>Margin L</label>
              <input type="number" min={0} max={4000} value={track.style.margin_l} onChange={(e) => setStyle({ margin_l: +e.target.value })} />
            </div>
            <div className="style-item">
              <label>Margin R</label>
              <input type="number" min={0} max={4000} value={track.style.margin_r} onChange={(e) => setStyle({ margin_r: +e.target.value })} />
            </div>
          </>
        )}
        <div className="style-item">
          <input id={`b-${track.id}`} type="checkbox" checked={track.style.bold} onChange={(e) => setStyle({ bold: e.target.checked })} />
          <label htmlFor={`b-${track.id}`}>Bold</label>
          <input id={`i-${track.id}`} type="checkbox" checked={track.style.italic} onChange={(e) => setStyle({ italic: e.target.checked })} />
          <label htmlFor={`i-${track.id}`}>Italic</label>
        </div>
      </div>
      <div className="style-hint">
        {posMode
          ? `[COORDINATE: POS(${Math.round(track.style.pos_x!)}, ${Math.round(track.style.pos_y!)})] Drag on the video to update the center point in real time`
          : 'Tip: hold and drag the subtitle on the video for precise center-point positioning; "Reset layout" returns to alignment/margins'}
      </div>
    </div>
  )
}
