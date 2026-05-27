import time
import threading
from pathlib import Path
from typing import Optional, Callable, Dict
from openai.types.chat import ChatCompletionChunk

from config import CONFIG


class StreamManager:
    """OpenWebUI 流式输出管理器。"""

    def __init__(self):
        self.active_callbacks: Dict[str, Callable[[str], None]] = {}
        self._resuming: Dict[str, bool] = {}
        self._callbacks_lock = threading.Lock()
        self._debug_file_lock = threading.Lock()

    def _append_debug_markdown(self, content: str):
        debug_path = Path.cwd() / "debug.md"
        with self._debug_file_lock:
            with open(debug_path, "a", encoding="utf-8") as f:
                f.write(content)

    def register_stream_callback(self, thread_id: str, callback: Callable[[str], None]):
        with self._callbacks_lock:
            self.active_callbacks[thread_id] = callback

    def create_stream_chunk(
        self, thread_id: str, content: str, finish_reason: Optional[str] = None
    ) -> str:
        chunk = ChatCompletionChunk(
            id=thread_id,
            object="chat.completion.chunk",
            created=int(time.time()),
            model=CONFIG.model_name,
            choices=[{
                "index": 0,
                "delta": {"content": content} if content else {},
                "finish_reason": finish_reason,
            }],
        )
        return f"data: {chunk.model_dump_json()}\n\n"

    def stream_output(self, content: str, thread_id: str):
        with self._callbacks_lock:
            callback = self.active_callbacks.get(thread_id)
        if callback is not None:
            chunk = self.create_stream_chunk(thread_id, content)
            callback(chunk)
        else:
            self._append_debug_markdown(content)

    def is_active(self, thread_id: str) -> bool:
        with self._callbacks_lock:
            return thread_id in self.active_callbacks

    def active_count(self) -> int:
        with self._callbacks_lock:
            return len(self.active_callbacks)

    def discard_callback(self, thread_id: str) -> None:
        with self._callbacks_lock:
            self.active_callbacks.pop(thread_id, None)
            self._resuming.pop(thread_id, None)

    def set_resuming(self, thread_id: str, value: bool) -> None:
        with self._callbacks_lock:
            if value:
                self._resuming[thread_id] = True
            else:
                self._resuming.pop(thread_id, None)

    def is_resuming(self, thread_id: str) -> bool:
        with self._callbacks_lock:
            return self._resuming.get(thread_id, False)

    def clear_resuming(self, thread_id: str) -> None:
        with self._callbacks_lock:
            self._resuming.pop(thread_id, None)

    def end_stream(self, thread_id: str):
        try:
            with self._callbacks_lock:
                callback = self.active_callbacks.get(thread_id)
            if callback is not None:
                chunk = self.create_stream_chunk(thread_id, "", "stop")
                callback(chunk)
                callback("data: [DONE]\n\n")
        except Exception as e:
            print(f"Stream end error: {e}")
        finally:
            with self._callbacks_lock:
                self.active_callbacks.pop(thread_id, None)
                self._resuming.pop(thread_id, None)


stream_manager = StreamManager()
