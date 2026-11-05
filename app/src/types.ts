// 与后端对应的数据类型
export interface Segment {
  start: number
  end: number
  text: string
}

export interface SubtitleStyle {
  font_name: string
  font_size: number
  primary_color: string
  outline_color: string
  back_color: string
  bold: boolean
  italic: boolean
  outline: number
  shadow: number
  alignment: number
  margin_v: number
  margin_l: number
  margin_r: number
  pos_x: number | null   // 中心点坐标模式：设置后用 \pos 定位，忽略对齐/边距
  pos_y: number | null
}

export interface SubtitleTrack {
  id: string
  language: string
  label: string
  role: 'source' | 'translation'
  segments: Segment[]
  style: SubtitleStyle
}

export interface TimingIssue {
  index: number
  type: 'overlap' | 'too_short' | 'too_long' | 'too_fast'
  detail: string
}

export interface TimelineInfo {
  split_at?: number
  shifted?: number
  fixed?: number
  changes?: { index: number; before: number[]; after: number[] }[]
  need_split?: { index: number; cuts: number[]; text: string }[]
  synced?: string[]
}

export interface MediaInfo {
  path: string
  name: string
  duration: number
  width: number
  height: number
  video_codec: string
  audio_codec: string
  size: number
}

export interface TaskState {
  task_id: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  message: string
  error: string | null
}

export interface AiProvider {
  id: string
  name: string
  base_url: string
  api_key: string
  model: string
  api_key_set?: boolean
}

export interface AppConfig {
  ai_providers: AiProvider[]
  deepl_api_key: string
  deepl_api_key_set?: boolean
  whisper_model: string
  whisper_device: string
  parakeet_model?: string      // Parakeet 引擎默认模型
  asr_engine?: string          // 'local' | 'parakeet' | 'openai'，记住识别对话框上次的选择
  whisper_language?: string    // 识别语言码（'auto' = 自动检测）
  translate_target?: string    // 翻译目标语言码，记住上次的选择
  translate_choice?: string    // 'ai:<providerId>' 或 'deepl'
  export_srt?: boolean         // 导出对话框记住的上次选择
  export_ass?: boolean
  export_video?: boolean
  export_hard?: boolean
  export_dir?: string          // 最近一次选择的输出目录
  translate_batch_size: number
  translate_concurrency: number
  translation_glossary?: string
  subtitle_max_units?: number
  subtitle_max_duration?: number
  [key: string]: unknown
}

// 识别模型元数据：label 用于下拉框，langs 为「擅长语言」悬浮提示
export interface AsrModelInfo {
  label: string
  langs: string
}
export type AsrEngineId = 'local' | 'parakeet' | 'openai'
export type AsrModels = Record<AsrEngineId, Record<string, AsrModelInfo>>

// 常用 AI 厂商预设（一键填充 Base URL 与默认模型）
export const AI_PRESETS: { name: string; base_url: string; model: string }[] = [
  { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi (Moonshot)', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'Qwen (Alibaba)', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Zhipu GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
]

export const LANGUAGES: Record<string, string> = {
  auto: 'Auto detect',
  zh: 'Chinese',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  it: 'Italiano',
  pt: 'Português',
  ar: 'العربية',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  hi: 'हिन्दी',
  yue: 'Cantonese',
}

export const DEFAULT_STYLE: SubtitleStyle = {
  font_name: 'Microsoft YaHei',
  font_size: 48,
  primary_color: '#FFFFFF',
  outline_color: '#000000',
  back_color: '#000000',
  bold: false,
  italic: false,
  outline: 2,
  shadow: 0,
  alignment: 2,
  margin_v: 30,
  margin_l: 20,
  margin_r: 20,
  pos_x: null,
  pos_y: null,
}

declare global {
  interface Window {
    subcraft: {
      apiBase: string
      wsBase: string
      token: string
      openVideoDialog: () => Promise<string | null>
      selectDirDialog: () => Promise<string | null>
      saveFileDialog: (defaultName: string, ext: string) => Promise<string | null>
      getPathForFile: (file: File) => string
    }
  }
}
