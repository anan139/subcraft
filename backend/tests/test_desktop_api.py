"""桌面端新 API：识别模型清单（含语言提示）、任务取消、批量入口。"""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.security import TOKEN_ENV
from backend.app.tasks import TaskCancelled, manager

TOKEN = "t0ken-for-test"


@pytest.fixture(autouse=True)
def task_loop():
    # 正常由 FastAPI lifespan 设置；测试里手动提供一个（广播无 WS 连接，不会真正执行回调）
    manager.loop = asyncio.new_event_loop()
    yield
    manager.loop = None


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv(TOKEN_ENV, TOKEN)
    return TestClient(create_app(), base_url="http://127.0.0.1", raise_server_exceptions=False)


def _headers():
    return {"X-SubCraft-Token": TOKEN}


def test_asr_models_lists_engines_with_lang_hints(client):
    r = client.get("/api/asr_models", headers=_headers())
    assert r.status_code == 200
    data = r.json()
    assert set(data) == {"local", "parakeet", "openai"}
    assert "large-v3-turbo" in data["local"]
    assert data["parakeet"]["nemo-parakeet-tdt-0.6b-v2"]["langs"].startswith("English")
    assert "25 European" in data["parakeet"]["nemo-parakeet-tdt-0.6b-v3"]["langs"]
    for engine in data.values():
        for m in engine.values():
            assert m["label"] and m["langs"]          # 每个模型都必须带语言提示


def test_cancel_running_task(client, monkeypatch):
    def slow_job(progress_cb):
        for _ in range(100):
            progress_cb(0.01, "working")
            time.sleep(0.05)

    task_id = manager.submit(slow_job)
    time.sleep(0.2)
    assert client.post(f"/api/tasks/{task_id}/cancel", headers=_headers()).status_code == 200
    for _ in range(40):
        if manager.get(task_id)["status"] != "running":
            break
        time.sleep(0.1)
    assert manager.get(task_id)["status"] == "cancelled"
    # 任务已结束后再取消：400
    assert client.post(f"/api/tasks/{task_id}/cancel", headers=_headers()).status_code == 400


def test_cancelled_task_aborts_via_progress_cb(monkeypatch):
    import threading

    gate = threading.Event()

    def job(progress_cb):
        progress_cb(0.1, "first")              # 正常
        gate.wait(2)                           # 等测试侧先取消
        progress_cb(0.2, "second")             # 此时已被取消 → TaskCancelled

    task_id = manager.submit(job)
    time.sleep(0.2)                            # 让任务先报一次进度
    assert manager.cancel(task_id)
    gate.set()
    for _ in range(40):
        if manager.get(task_id)["status"] != "running":
            break
        time.sleep(0.1)
    t = manager.get(task_id)
    assert t["status"] == "cancelled"


def test_task_cancelled_is_base_exception():
    # 必须穿透业务代码里常见的 except Exception（如批量逐文件的错误捕获）
    with pytest.raises(TaskCancelled):
        try:
            raise TaskCancelled()
        except Exception:                       # noqa: BLE001
            pytest.fail("TaskCancelled must not be caught by except Exception")


def test_batch_start_rejects_bad_folder(client):
    r = client.post("/api/batch/start", json={"folder": "/nonexistent-folder-xyz"}, headers=_headers())
    assert r.status_code == 200
    task_id = r.json()["task_id"]
    for _ in range(40):
        t = manager.get(task_id)
        if t["status"] != "running":
            break
        time.sleep(0.1)
    assert manager.get(task_id)["status"] == "error"
    assert "Not a folder" in manager.get(task_id)["error"]
