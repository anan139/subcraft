// 时间轴操作：把当前全部轨道交给后端计算，结果整体替换（与之逐段对齐的译文轨会同步拆分/合并/平移）
import { api } from './api'
import { useStore } from './store'
import type { TimelineInfo } from './types'

type Op = Parameters<typeof api.timelineApply>[0]

export async function applyTimeline(op: Omit<Op, 'tracks' | 'track_id'> & { track_id?: string }): Promise<TimelineInfo> {
  const { tracks, activeTrackId, setTracks, setIssues } = useStore.getState()
  const track_id = op.track_id ?? activeTrackId
  if (!track_id) throw new Error('No subtitle track selected')
  const res = await api.timelineApply({ ...op, tracks, track_id })
  setTracks(res.tracks)
  setIssues(res.issues)
  return res.info
}

/** 播放器当前时间（秒） */
export function playhead(): number {
  return document.querySelector<HTMLVideoElement>('.video-area video')?.currentTime ?? 0
}

export const ISSUE_LABEL: Record<string, string> = {
  overlap: 'Overlaps next segment',
  too_short: 'Too short',
  too_long: 'Too long',
  too_fast: 'Reading speed too fast',
}
