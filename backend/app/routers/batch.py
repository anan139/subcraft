"""桌面端批量处理：把 app/services/batch.py 的完整流水线暴露给 UI（与 CLI / MCP 共用实现）。"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..services import batch as batch_service
from ..tasks import manager

router = APIRouter(prefix="/api/batch", tags=["batch"])


class BatchRequest(BaseModel):
    folder: str
    out_dir: str | None = None               # None = 各文件原目录
    recursive: bool = False
    target: str | None = None                # 翻译目标语言；None = 只识别
    provider: str = "openai"                 # openai / deepl
    provider_id: str | None = None
    engine: str = "local"                    # local / parakeet / openai
    model: str | None = None                 # whisper 或 parakeet 模型 id
    language: str | None = None              # 源语言提示（None/auto = 自动检测）
    formats: list[str] = Field(default_factory=lambda: ["srt", "ass"])
    video: str | None = None                 # soft / hard / None
    skip_existing: bool = True               # 断点续跑：产物已存在的文件跳过
    snap_cuts: bool = False
    split_cuts: bool = False


@router.post("/start")
def start_batch(req: BatchRequest) -> dict:
    def job(progress_cb):
        opts = batch_service.BatchOptions(
            mode="media", target=req.target, out_dir=req.out_dir, recursive=req.recursive,
            engine=req.engine, whisper_model=req.model, source_lang=req.language,
            provider=req.provider, provider_id=req.provider_id,
            formats=req.formats, video=req.video, skip_existing=req.skip_existing,
            snap_cuts=req.snap_cuts, split_cuts=req.split_cuts,
        )
        report = batch_service.run_batch(req.folder, opts, progress_cb)
        return {
            "total": report["total"], "done": report["done"],
            "skipped": report["skipped"], "failed": report["failed"],
            "elapsed_sec": report.get("elapsed_sec"),
            "message": report.get("message"),
            "report_path": report.get("report_path"),
            "items": [
                {k: item.get(k) for k in ("index", "input", "status", "error", "files", "elapsed_sec")}
                for item in report["items"]
            ],
        }

    return {"task_id": manager.submit(job)}
