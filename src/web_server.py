import asyncio
import hashlib
import logging
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import List, Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel

from agent import build_agent
from config import CONFIG, DEFAULT_API_PORT, DEFAULT_BIND_HOST, DEFAULT_PUBLIC_API_BASE_URL
from infra.stream_manager import stream_manager
from utils.agent_runner import has_pending_interrupt, run_until_interrupt

logger = logging.getLogger(__name__)


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = None
    messages: List[ChatCompletionMessageParam]
    user_id: Optional[str] = None
    chat_id: Optional[str] = None


class Model(BaseModel):
    id: str
    object: str = "model"
    created: int
    owned_by: str = "ask-user-question-mvp"


class ModelsResponse(BaseModel):
    object: str = "list"
    data: List[Model]


class SessionEntry:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self._agent = None
        self._lock = threading.Lock()

    def get_agent(self):
        with self._lock:
            if self._agent is None:
                self._agent = build_agent(self.session_id)
        return self._agent


class SessionStore:
    def __init__(self):
        self._store: OrderedDict[str, SessionEntry] = OrderedDict()
        self._max = CONFIG.max_sessions
        self._lock = threading.Lock()

    def ensure_session(self, session_id: str) -> SessionEntry:
        with self._lock:
            if session_id in self._store:
                self._store.move_to_end(session_id)
                return self._store[session_id]

            entry = SessionEntry(session_id)
            self._store[session_id] = entry

            if len(self._store) > self._max:
                evicted_id, _ = self._store.popitem(last=False)
                stream_manager.discard_callback(evicted_id)

            return entry


_sessions = SessionStore()


def _build_session_id(body: ChatCompletionRequest) -> str:
    user_id = body.user_id
    chat_id = body.chat_id
    if not user_id or not chat_id:
        raise HTTPException(
            status_code=400,
            detail="Missing session identity: both user_id and chat_id are required.",
        )
    raw_key = f"{user_id}:{chat_id}"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:32]


_STREAMING_RESPONSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _build_streaming_response(session_id: str, entry: SessionEntry, cmd_or_inputs):
    output_queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    _stream_end = object()
    is_resume = isinstance(cmd_or_inputs, Command)

    def stream_callback(chunk: str):
        loop.call_soon_threadsafe(output_queue.put_nowait, chunk)

    stream_manager.register_stream_callback(session_id, stream_callback)
    agent = entry.get_agent()

    async def handle_turn():
        await run_until_interrupt(agent, cmd_or_inputs, session_id)

    def run_turn_in_thread():
        thread_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(thread_loop)
        if is_resume:
            stream_manager.set_resuming(session_id, True)
        try:
            thread_loop.run_until_complete(handle_turn())
        except Exception as e:
            logger.exception("Agent turn failed for session %s: %s", session_id, e)
            stream_manager.stream_output(
                f"\n\n❌ 本轮对话处理失败: {e}\n\n",
                thread_id=session_id,
            )
        finally:
            stream_manager.clear_resuming(session_id)
            thread_loop.close()
            if stream_manager.is_active(session_id):
                stream_manager.end_stream(session_id)
            loop.call_soon_threadsafe(output_queue.put_nowait, _stream_end)

    async def async_stream_generator():
        turn_thread = threading.Thread(target=run_turn_in_thread, daemon=True)
        turn_thread.start()
        while True:
            chunk = await output_queue.get()
            if chunk is _stream_end:
                break
            yield chunk

    return StreamingResponse(
        async_stream_generator(),
        media_type="text/event-stream",
        headers=_STREAMING_RESPONSE_HEADERS,
    )


app = FastAPI(title="Ask User Question MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "ask-user-question-mvp",
        "version": "1.0.0",
        "active_streams": stream_manager.active_count(),
    }


@app.get("/v1/models")
async def list_models():
    created = int(time.time())
    models = [Model(id="ask-user-question-mvp", created=created)]
    return ModelsResponse(data=models)


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    session_id = _build_session_id(request)
    entry = _sessions.ensure_session(session_id)
    agent = entry.get_agent()

    user_messages = [msg for msg in request.messages if msg["role"] == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message found.")
    latest_user_message = user_messages[-1]["content"]

    if has_pending_interrupt(agent, session_id):
        cmd_or_inputs = Command(resume=latest_user_message)
    else:
        cmd_or_inputs = {
            "messages": [
                {"role": "user", "content": latest_user_message},
            ],
        }

    return _build_streaming_response(session_id, entry, cmd_or_inputs)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    env_file = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_file, override=False)

    print(f"Ask User Question MVP 将在 {DEFAULT_PUBLIC_API_BASE_URL} 启动")
    uvicorn.run(app, host=DEFAULT_BIND_HOST, port=DEFAULT_API_PORT, log_level="warning")
