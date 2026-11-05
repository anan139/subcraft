"""后台任务管理：线程池执行长任务，进度经 WebSocket 广播，支持协作式取消。

取消机制：cancel(task_id) 置标记；manager 的 progress_cb 在每次上报时检查标记并抛出
TaskCancelled（BaseException，避免被业务代码的 except Exception 吞掉），任务随当前
进度点中断。ffmpeg 等子进程由 _run_with_progress 在收到取消异常时 kill。
"""
from __future__ import annotations

import asyncio
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable


class TaskCancelled(BaseException):
    """任务被用户取消；继承 BaseException 以穿过业务层的 except Exception。"""


class TaskManager:
    def __init__(self) -> None:
        self.tasks: dict[str, dict[str, Any]] = {}
        self.connections: set[Any] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.executor = ThreadPoolExecutor(max_workers=2)

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> str:
        task_id = uuid.uuid4().hex[:12]
        self.tasks[task_id] = {"status": "running", "progress": 0.0, "message": "Queued", "result": None, "error": None, "cancelled": False}

        def progress_cb(p: float, msg: str) -> None:
            t = self.tasks[task_id]
            if t.get("cancelled"):
                raise TaskCancelled()
            t["progress"] = round(p, 3)
            t["message"] = msg
            self._notify(task_id)

        def runner() -> None:
            t = self.tasks[task_id]
            try:
                if t.get("cancelled"):          # 排队期间被取消：直接跳过
                    raise TaskCancelled()
                result = fn(*args, progress_cb=progress_cb, **kwargs)
                t.update(status="done", progress=1.0, result=result)
            except TaskCancelled:
                t.update(status="cancelled", message="Cancelled")
            except Exception as e:
                traceback.print_exc()
                t.update(status="error", error=str(e))
            self._notify(task_id)

        if self.loop is None:
            raise RuntimeError("Event loop not ready")
        self.loop.run_in_executor(self.executor, runner)
        self._notify(task_id)
        return task_id

    def cancel(self, task_id: str) -> bool:
        """协作式取消：置标记，任务在下一个进度上报点中断。"""
        t = self.tasks.get(task_id)
        if not t or t["status"] != "running":
            return False
        t["cancelled"] = True
        t["message"] = "Cancelling..."
        self._notify(task_id)
        return True

    def _notify(self, task_id: str) -> None:
        if self.loop and self.connections:
            payload = {"type": "task", "task_id": task_id, **{k: v for k, v in self.tasks[task_id].items() if k != "result"}}
            self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._broadcast(payload)))

    async def _broadcast(self, payload: dict) -> None:
        dead = []
        for ws in list(self.connections):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections.discard(ws)

    def get(self, task_id: str) -> dict[str, Any] | None:
        return self.tasks.get(task_id)


manager = TaskManager()
