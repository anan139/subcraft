"""应用配置：数据目录、API Key 等持久化设置。"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

APP_NAME = "SubCraft"


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def frozen_dir() -> Path | None:
    """PyInstaller 打包后可执行文件所在目录；源码运行时返回 None。"""
    return Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else None


def portable_data_dir() -> Path | None:
    """便携模式：打包版可执行文件旁存在 data 目录时，配置/缓存/模型都放进去，不写用户目录。"""
    d = frozen_dir()
    return d / "data" if d and (d / "data").is_dir() else None


def data_dir() -> Path:
    override = os.environ.get("SUBCRAFT_DATA_DIR")
    if override:
        return Path(override)
    portable = portable_data_dir()
    if portable:
        return portable
    local = os.environ.get("LOCALAPPDATA")
    base = Path(local) if local else Path.home() / ".config"
    return base / APP_NAME


def tools_dir() -> Path:
    override = os.environ.get("SUBCRAFT_TOOLS_DIR")
    if override:
        return Path(override)
    # 开发模式：项目根目录/tools；桌面版由 Electron 设置 SUBCRAFT_TOOLS_DIR；
    # 独立打包的 CLI 用可执行文件旁的 tools（onefile 的 project_root 在临时解压目录里，不能用）
    d = frozen_dir()
    return (d / "tools") if d else project_root() / "tools"


def work_dir() -> Path:
    d = data_dir() / "work"
    d.mkdir(parents=True, exist_ok=True)
    return d


DEFAULT_CONFIG: dict[str, Any] = {
    # AI 翻译接口（OpenAI 兼容）厂商列表:
    # [{"id": "xxx", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "api_key": "sk-...", "model": "deepseek-chat"}]
    "ai_providers": [],
    # DeepL
    "deepl_api_key": "",
    # ASR
    "whisper_model": "large-v3-turbo",
    "whisper_device": "auto",        # auto / cuda / cpu
    "parakeet_model": "nemo-parakeet-tdt-0.6b-v3",   # Parakeet 引擎默认模型
    # 识别对话框记住的上次选择：引擎 / 视频语言
    "asr_engine": "local",           # local / parakeet / openai
    "whisper_language": "auto",      # auto 或 ISO 语言码
    # 翻译对话框记住的上次选择：目标语言 / 服务（'ai:<id>' 或 'deepl'；空 = 自动挑选）
    "translate_target": "en",
    "translate_choice": "",
    # 导出对话框记住的上次选择：格式 / 视频模式 / 输出目录
    "export_srt": True,
    "export_ass": True,
    "export_video": True,
    "export_hard": False,            # false=软字幕封装 / true=内嵌烧录
    "export_dir": "",                # 最近一次选择的输出目录（批量与导出共用）
    # 批量对话框记住的上次选择（文件夹与输出目录不记忆，每次现场选择）
    "batch_recursive": False,
    "batch_snap_cuts": False,
    "batch_srt": True,
    "batch_ass": True,
    "batch_video": "",               # '' / soft / hard
    # 翻译批处理
    "translate_batch_size": 25,
    "translate_concurrency": 4,
    # 翻译术语表：每行「原文=译文」，保证人名、术语前后一致
    "translation_glossary": "",
    # 识别断句：单条字幕长度上限（CJK 字计 1、其他字符计 0.5；0 = 不切分）与时长上限（秒）
    "subtitle_max_units": 21,
    "subtitle_max_duration": 7.0,
}


class ConfigStore:
    def __init__(self) -> None:
        d = data_dir()
        d.mkdir(parents=True, exist_ok=True)
        self._path = d / "config.json"
        self._cfg: dict[str, Any] = dict(DEFAULT_CONFIG)
        self.load()

    def load(self) -> None:
        if self._path.exists():
            try:
                saved = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    # 旧版单 OpenAI 配置 → 迁移为 AI 厂商列表中的一项
                    if any(k in saved for k in ("openai_base_url", "openai_api_key", "openai_model")):
                        old_key = saved.pop("openai_api_key", "")
                        old_base = saved.pop("openai_base_url", "https://api.openai.com/v1")
                        old_model = saved.pop("openai_model", "gpt-4o-mini")
                        if not saved.get("ai_providers"):
                            saved["ai_providers"] = [{
                                "id": "openai", "name": "OpenAI",
                                "base_url": old_base, "api_key": old_key, "model": old_model,
                            }]
                    self._cfg.update(saved)
            except Exception:
                pass

    def save(self) -> None:
        self._path.write_text(
            json.dumps(self._cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def get(self, key: str, default: Any = None) -> Any:
        return self._cfg.get(key, default)

    def all(self) -> dict[str, Any]:
        # 不向前端暴露完整 key，仅返回掩码后的副本由路由层处理
        return dict(self._cfg)

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        for k, v in values.items():
            if k in DEFAULT_CONFIG:
                self._cfg[k] = v
        self.save()
        return dict(self._cfg)


store = ConfigStore()
