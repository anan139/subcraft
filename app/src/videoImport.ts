// 视频导入：顶栏按钮与拖拽共用；只接受常见视频扩展名
import { api } from './api'
import { useStore } from './store'

const VIDEO_EXTS = /\.(mp4|mkv|mov|avi|webm|ts|flv|wmv|m4v|mpg|mpeg|3gp)$/i

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTS.test(name)
}

export async function importVideoPath(path: string): Promise<boolean> {
  const { busy } = busyState()
  if (busy) return false
  try {
    const info = await api.probe(path)
    useStore.getState().setVideo(path, info)
    return true
  } catch (e) {
    alert(`Could not read the video: ${e instanceof Error ? e.message : e}`)
    return false
  }
}

function busyState() {
  const t = useStore.getState().task
  return { busy: t?.status === 'running' }
}

/** 处理拖拽落下的文件：取第一个视频文件导入，返回是否已发起导入 */
export async function importDroppedFiles(files: FileList): Promise<boolean> {
  for (const f of Array.from(files)) {
    if (!isVideoFile(f.name)) continue
    const path = window.subcraft.getPathForFile(f)
    if (path) return importVideoPath(path)
  }
  return false
}
