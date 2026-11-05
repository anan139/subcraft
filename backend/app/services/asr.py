"""语音识别：本地 faster-whisper (GPU 加速) + OpenAI Whisper API 云端备选。"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Callable

from ..config import store, work_dir
from ..models import Segment
from . import ffmpeg_tool
from .segmenter import DEFAULT_MAX_DURATION, DEFAULT_MAX_UNITS, Word, resegment

ProgressCb = Callable[[float, str], None]

# 模型名 -> 说明（供前端展示）
WHISPER_MODELS = {
    "tiny": "tiny (fastest, lower accuracy)",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large-v3-turbo": "large-v3-turbo (recommended: fast and accurate)",
    "large-v3": "large-v3 (highest accuracy)",
}

# Parakeet 各模型支持的语言（ISO 码）；选择其他语言时直接报错并提示换引擎
PARAKEET_LANGS: dict[str, set[str]] = {
    "nemo-parakeet-tdt-0.6b-v2": {"en"},
    "nemo-parakeet-tdt-0.6b-v3": {
        "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu",
        "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
    },
}

# 引擎 -> 模型id -> {label, langs}。langs 是给用户看的「擅长语言」说明（前端悬浮提示），
# label 用于下拉框；两个本地引擎均为无需 PyTorch 的推理运行时（CTranslate2 / ONNX Runtime）。
ASR_MODELS: dict[str, dict[str, dict[str, str]]] = {
    "local": {
        "tiny": {"label": "tiny (fastest, lower accuracy)", "langs": "99 languages — quick drafts only"},
        "base": {"label": "base", "langs": "99 languages — fast, lower accuracy"},
        "small": {"label": "small", "langs": "99 languages — balanced speed/accuracy"},
        "medium": {"label": "medium", "langs": "99 languages — slower, better accuracy"},
        "large-v3-turbo": {"label": "large-v3-turbo (recommended)", "langs": "99 languages — fast and accurate; great for CJK"},
        "large-v3": {"label": "large-v3 (highest accuracy)", "langs": "99 languages — best accuracy; largest download"},
    },
    "parakeet": {
        "nemo-parakeet-tdt-0.6b-v2": {
            "label": "Parakeet TDT 0.6B v2",
            "langs": "English only — top of the Open ASR leaderboard, very fast (CPU friendly)",
        },
        "nemo-parakeet-tdt-0.6b-v3": {
            "label": "Parakeet TDT 0.6B v3 (multilingual)",
            "langs": "25 European languages (auto-detect: bg/hr/cs/da/nl/en/et/fi/fr/de/el/hu/it/lv/lt/mt/pl/pt/ro/sk/sl/es/sv/ru/uk) — no CJK",
        },
    },
    "openai": {
        "whisper-1": {"label": "Whisper API (cloud, pay per use)", "langs": "57+ languages — 25MB per request, needs API key"},
    },
}


_CUDA_DLL_CONFIGURED = False


def _setup_cuda_dlls() -> None:
    """把 pip 安装或 PyInstaller 打包的 nvidia-*-cu12 运行库目录加入 DLL 搜索路径（供 ctranslate2 使用）。"""
    global _CUDA_DLL_CONFIGURED
    if _CUDA_DLL_CONFIGURED or sys.platform != "win32":
        return

    candidate_roots: set[Path] = set()

    # 1. PyInstaller 打包环境
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            candidate_roots.add(Path(sys._MEIPASS))
        exe_dir = Path(sys.executable).parent
        candidate_roots.add(exe_dir)
        candidate_roots.add(exe_dir / "_internal")
        candidate_roots.add(exe_dir / "tools")

    tools_dir = os.environ.get("SUBCRAFT_TOOLS_DIR")
    if tools_dir:
        candidate_roots.add(Path(tools_dir))

    # 2. Python 运行环境
    candidate_roots.add(Path(sys.prefix))
    candidate_roots.add(Path(sys.base_prefix))
    try:
        import site

        for sp in site.getsitepackages():
            candidate_roots.add(Path(sp))
        if hasattr(site, "getusersitepackages"):
            candidate_roots.add(Path(site.getusersitepackages()))
    except Exception:
        pass

    for p in sys.path:
        if p:
            candidate_roots.add(Path(p))

    # 3. 环境变量中的 CUDA 目录
    for k in ("CUDA_PATH", "CUDA_PATH_V12_0", "CUDA_PATH_V12_4", "CUDA_PATH_V12_8", "CUDA_PATH_V12_9"):
        cuda_path = os.environ.get(k)
        if cuda_path:
            candidate_roots.add(Path(cuda_path))

    dll_dirs: set[Path] = set()
    for root in candidate_roots:
        if not root.exists():
            continue
        # 检查根目录及 bin 目录
        if (root / "cublas64_12.dll").exists() or (root / "cublas64_11.dll").exists():
            dll_dirs.add(root)
        bin_dir = root / "bin"
        if bin_dir.exists() and any(bin_dir.glob("*.dll")):
            dll_dirs.add(bin_dir)

        # 检查 nvidia 子包 (nvidia/cublas/bin, nvidia/cudnn/bin, nvidia/cuda_nvrtc/bin 等)
        nvidia = root / "nvidia"
        if nvidia.exists():
            for sub in nvidia.iterdir():
                if sub.is_dir():
                    sub_bin = sub / "bin"
                    if sub_bin.exists():
                        dll_dirs.add(sub_bin)
                    elif any(sub.glob("*.dll")):
                        dll_dirs.add(sub)

        # 检查 Lib/site-packages/nvidia
        sp_nvidia = root / "Lib" / "site-packages" / "nvidia"
        if sp_nvidia.exists():
            for sub in sp_nvidia.iterdir():
                if sub.is_dir():
                    sub_bin = sub / "bin"
                    if sub_bin.exists():
                        dll_dirs.add(sub_bin)

    for d in dll_dirs:
        try:
            os.add_dll_directory(str(d))
        except Exception:
            pass
        os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")

    _CUDA_DLL_CONFIGURED = True


_CUDA_AVAILABLE_CACHE: bool | None = None


def is_cuda_available() -> bool:
    """检查当前环境是否真正支持 CUDA 加速（不仅检查 GPU，还验证 cuBLAS/cuDNN 是否可正常加载）。"""
    global _CUDA_AVAILABLE_CACHE
    if _CUDA_AVAILABLE_CACHE is not None:
        return _CUDA_AVAILABLE_CACHE

    _setup_cuda_dlls()
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() <= 0:
            _CUDA_AVAILABLE_CACHE = False
            return False

        # Windows 下验证 cuBLAS 动态链接库是否可真实加载
        if sys.platform == "win32":
            import ctypes

            try:
                ctypes.CDLL("cublas64_12.dll")
            except Exception:
                try:
                    ctypes.CDLL("cublas64_11.dll")
                except Exception:
                    _CUDA_AVAILABLE_CACHE = False
                    return False

        _CUDA_AVAILABLE_CACHE = True
        return True
    except Exception:
        _CUDA_AVAILABLE_CACHE = False
        return False


def _load_wav(wav_path: Path):
    """读取 ffmpeg 抽出的 16kHz 单声道 PCM 为 float32 数组直接喂给模型。

    不让 faster-whisper 自己用 PyAV 解码：新版 PyAV（>=19）移除了 open(metadata_errors=)，
    会导致 faster-whisper 1.2.x 识别直接 TypeError；音频本来就由 ffmpeg 抽好，无需二次解码。
    """
    import wave

    import numpy as np

    with wave.open(str(wav_path), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            return str(wav_path)  # 非预期格式交回 faster-whisper 自行解码
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def _resegment(segments: list[Segment], words: list[list[Word]] | None = None) -> list[Segment]:
    """按设置把过长的识别段切成适合上屏的短句（subtitle_max_units<=0 关闭）。"""
    max_units = float(store.get("subtitle_max_units", DEFAULT_MAX_UNITS) or 0)
    max_dur = float(store.get("subtitle_max_duration", DEFAULT_MAX_DURATION) or DEFAULT_MAX_DURATION)
    return resegment(segments, words, max_units, max_dur)


class LocalWhisper:
    """faster-whisper 单例，模型按需加载并缓存。"""

    def __init__(self) -> None:
        self._model = None
        self._loaded_name: str | None = None

    def _resolve_device(self, device: str) -> tuple[str, str]:
        if device == "auto":
            return ("cuda", "float16") if is_cuda_available() else ("cpu", "int8")
        if device == "cuda":
            return ("cuda", "float16")
        return ("cpu", "int8")

    def _load(self, model_name: str, device: str, progress_cb: ProgressCb):
        dev, compute = self._resolve_device(device)
        if self._model is not None and self._loaded_name == f"{model_name}:{dev}":
            return self._model
        from faster_whisper import WhisperModel

        _setup_cuda_dlls()
        progress_cb(0.02, f"Loading model {model_name} ({dev}), downloads on first use...")
        try:
            self._model = WhisperModel(model_name, device=dev, compute_type=compute)
            self._loaded_name = f"{model_name}:{dev}"
        except Exception as e:
            if dev == "cuda":
                progress_cb(0.02, f"CUDA load failed, falling back to CPU: {e}")
                self._model = WhisperModel(model_name, device="cpu", compute_type="int8")
                self._loaded_name = f"{model_name}:cpu"
            else:
                raise
        return self._model

    def transcribe(
        self,
        wav_path: Path,
        duration: float,
        model_name: str,
        language: str | None = None,
        device: str = "auto",
        progress_cb: ProgressCb | None = None,
    ) -> tuple[list[Segment], str]:
        def report(p: float, msg: str) -> None:
            if progress_cb:
                progress_cb(min(p, 0.99), msg)

        def _do_transcribe(m) -> tuple[list[Segment], str]:
            report(0.05, "Transcribing...")
            segments_iter, info = m.transcribe(
                _load_wav(wav_path),
                language=None if language in (None, "auto") else language,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
                beam_size=5,
                word_timestamps=True,
            )
            segments: list[Segment] = []
            words: list[list[Word]] = []
            for s in segments_iter:
                segments.append(Segment(start=round(s.start, 3), end=round(s.end, 3), text=s.text.strip()))
                words.append([Word(start=w.start, end=w.end, text=w.word) for w in (s.words or [])])
                if duration > 0:
                    report(0.05 + 0.93 * min(s.end / duration, 1.0), f"Transcribing {int(s.end)}s / {int(duration)}s")
            return _resegment(segments, words), info.language or "und"

        model = self._load(model_name, device, report)
        try:
            return _do_transcribe(model)
        except Exception as e:
            # 如果在 CUDA 执行阶段（如 GEMM/cuBLAS/cuDNN 运行时异常）失败，自动降级为 CPU 模式重试
            err_msg = str(e).lower()
            is_cuda_err = (
                "cublas" in err_msg
                or "cuda" in err_msg
                or "cudnn" in err_msg
                or "out of memory" in err_msg
            )
            if is_cuda_err and self._loaded_name and ":cuda" in self._loaded_name:
                report(0.02, f"CUDA execution failed ({e}), automatically retrying on CPU...")
                from faster_whisper import WhisperModel

                self._model = WhisperModel(model_name, device="cpu", compute_type="int8")
                self._loaded_name = f"{model_name}:cpu"
                return _do_transcribe(self._model)
            raise


_parakeet_cache: dict[str, Any] = {}


def _get_parakeet(model_name: str):
    """加载（并缓存）Parakeet ONNX 模型；int8 量化，CPU 友好，无需 PyTorch。"""
    if model_name not in _parakeet_cache:
        import onnx_asr

        _parakeet_cache[model_name] = onnx_asr.load_model(model_name, quantization="int8").with_timestamps()
    return _parakeet_cache[model_name]


def _tokens_to_words(tokens: list[str], stamps: list[float], seg_start: float, seg_end: float) -> list[Word]:
    """把 BPE token 时间戳聚合成词：NeMo 分词器里词首 token 以空格开头。

    Word.text 保留原始前导空格（与 faster-whisper 一致，segmenter._join 直接拼接还原文本）。
    """
    words: list[Word] = []
    for tok, t in zip(tokens, stamps):
        if tok[:1].isspace() or not words:
            if words:
                words[-1].end = seg_start + t          # 上一个词到此 token 开始处为止
            words.append(Word(start=seg_start + t, end=seg_end, text=tok))
        else:
            words[-1].text += tok                       # 词内续片
    return [w for w in words if w.text.strip()]


def transcribe_parakeet(
    video_path: str,
    duration: float,
    model_name: str,
    language: str | None = None,
    progress_cb: ProgressCb | None = None,
) -> tuple[list[Segment], str]:
    """NVIDIA Parakeet TDT（ONNX Runtime int8）：欧洲语系高精度高速引擎。

    Silero VAD 切出语音段 → 逐段带词级时间戳识别 → 复用与 whisper 相同的断句管线。
    每段之间经 progress_cb 上报，取消任务会在下一段开始前中断。
    """
    import numpy as np
    import onnx_asr

    def report(p: float, msg: str) -> None:
        if progress_cb:
            progress_cb(min(p, 0.99), msg)

    supported = PARAKEET_LANGS.get(model_name)
    lang = None if language in (None, "", "auto") else language
    if supported and lang and lang not in supported:
        names = ", ".join(sorted(supported))
        raise RuntimeError(f"{model_name} supports: {names}. '{lang}' is not supported — use the local faster-whisper engine for other languages")

    report(0.0, "Extracting audio...")
    wav_path = work_dir() / f"asr_{os.getpid()}.wav"
    ffmpeg_tool.extract_audio(video_path, wav_path)
    try:
        report(0.04, f"Loading {model_name} (int8), downloads on first use...")
        model = _get_parakeet(model_name)
        report(0.08, "Detecting speech segments (VAD)...")
        vad = onnx_asr.load_vad("silero")
        waveform = _load_wav(wav_path)
        if not isinstance(waveform, np.ndarray):
            raise RuntimeError("Unexpected audio format from ffmpeg extraction")
        raw = next(iter(vad.segment_batch(waveform[None, :], np.array([len(waveform)]), 16000)))
        segs = [(s / 16000.0, e / 16000.0) for s, e in raw]
        if not segs:
            return [], "und"
        segments: list[Segment] = []
        words: list[list[Word]] = []
        n = len(segs)
        for i, (s, e) in enumerate(segs):
            report(0.1 + 0.85 * i / n, f"Transcribing {i + 1}/{n}")
            r = model.recognize(waveform[int(s * 16000):int(e * 16000)], sample_rate=16000)
            text = (r.text or "").strip()
            if text:
                segments.append(Segment(start=round(s, 3), end=round(e, 3), text=text))
                words.append(_tokens_to_words(list(r.tokens), list(r.timestamps), s, e))
        report(0.97, "Rebuilding subtitle lines...")
        detected = lang or ("en" if model_name.endswith("-v2") else "und")
        return _resegment(segments, words), detected
    finally:
        wav_path.unlink(missing_ok=True)


def transcribe_openai_api(
    video_path: str,
    api_key: str,
    base_url: str,
    language: str | None = None,
    progress_cb: ProgressCb | None = None,
) -> tuple[list[Segment], str]:
    """OpenAI Whisper API（云端，按用量计费，需联网）。"""
    from openai import OpenAI

    def report(p: float, msg: str) -> None:
        if progress_cb:
            progress_cb(p, msg)

    report(0.05, "Extracting audio...")
    mp3 = work_dir() / f"upload_{os.getpid()}.mp3"
    ffmpeg_tool.extract_audio_mp3(video_path, mp3)
    if mp3.stat().st_size > 24 * 1024 * 1024:
        mp3.unlink(missing_ok=True)
        raise RuntimeError("Audio exceeds the 25MB Whisper API limit — use local transcription instead")

    report(0.3, "Uploading and transcribing...")
    client = OpenAI(api_key=api_key, base_url=base_url or None)
    with open(mp3, "rb") as f:
        resp = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
            language=None if language in (None, "auto") else language,
        )
    mp3.unlink(missing_ok=True)
    segments = [
        Segment(start=round(s.start, 3), end=round(s.end, 3), text=s.text.strip())
        for s in (resp.segments or [])
        if s.text.strip()
    ]
    report(0.99, "Transcription complete")
    return _resegment(segments), getattr(resp, "language", None) or "und"


_local = LocalWhisper()


def transcribe(
    video_path: str,
    duration: float,
    engine: str = "local",
    model_name: str | None = None,
    language: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    progress_cb: ProgressCb | None = None,
) -> tuple[list[Segment], str]:
    """统一入口。返回 (字幕段, 检测到的语言码)。"""
    if engine == "openai":
        from .translator import get_ai_provider

        p = get_ai_provider() or {}
        key = api_key or p.get("api_key", "")
        if not key:
            raise RuntimeError("No API key configured for the AI provider (add one in Settings and retry)")
        return transcribe_openai_api(video_path, key, base_url or p.get("base_url", ""), language, progress_cb)
    if engine == "parakeet":
        model_name = model_name or store.get("parakeet_model", "nemo-parakeet-tdt-0.6b-v3")
        return transcribe_parakeet(video_path, duration, model_name, language, progress_cb)
    # 本地引擎
    model_name = model_name or store.get("whisper_model", "large-v3-turbo")
    device = store.get("whisper_device", "auto")

    def report(p: float, msg: str) -> None:
        if progress_cb:
            progress_cb(p, msg)

    report(0.0, "Extracting audio...")
    wav = work_dir() / f"asr_{os.getpid()}.wav"
    ffmpeg_tool.extract_audio(video_path, wav)
    try:
        return _local.transcribe(wav, duration, model_name, language, device, progress_cb)
    finally:
        wav.unlink(missing_ok=True)
