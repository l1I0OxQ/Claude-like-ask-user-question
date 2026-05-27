"""Agent 运行循环与流式事件处理，支持 HITL interrupt/resume。"""

from __future__ import annotations

from typing import Any, Dict

from langgraph.graph.state import CompiledStateGraph

from config import CONFIG
from infra.stream_manager import stream_manager
from utils.markdown_utils import build_tool_end_markdown, build_tool_start_markdown

_SILENT_INVOKE_TOOLS = {"ask_user_question"}
_SILENT_RESULT_TOOLS = {"ask_user_question"}


def _make_config(session_id: str) -> dict:
    return {
        "configurable": {"thread_id": session_id},
        "recursion_limit": CONFIG.recursion_limit,
    }


def handle_agent_stream_event(
    event: Dict[str, Any],
    thread_id: str,
    stream_model_output: bool = True,
) -> None:
    event_type = str(event.get("event", ""))
    event_name = str(event.get("name", ""))
    data = event.get("data", {}) or {}

    if event_type == "on_tool_start":
        if event_name not in _SILENT_INVOKE_TOOLS:
            tool_input = data.get("input", data)
            stream_manager.stream_output(
                build_tool_start_markdown(event_name, tool_input),
                thread_id=thread_id,
            )
    elif event_type == "on_tool_end":
        if event_name not in _SILENT_RESULT_TOOLS:
            tool_output = data.get("output", data)
            stream_manager.stream_output(
                build_tool_end_markdown(event_name, tool_output),
                thread_id=thread_id,
            )
    elif event_type == "on_chat_model_stream" and stream_model_output:
        chunk = data.get("chunk")
        chunk_text = getattr(chunk, "content", "")
        if chunk_text:
            stream_manager.stream_output(chunk_text, thread_id=thread_id)


async def run_until_interrupt(
    agent: CompiledStateGraph,
    cmd_or_inputs,
    session_id: str,
) -> None:
    """运行 Agent，流式输出事件，直到图完成或遇到 interrupt 暂停。"""
    config = _make_config(session_id)
    async for event in agent.astream_events(
        cmd_or_inputs,
        config=config,
        version="v2",
    ):
        handle_agent_stream_event(
            event=event,
            thread_id=session_id,
            stream_model_output=True,
        )


def has_pending_interrupt(agent: CompiledStateGraph, session_id: str) -> bool:
    """检查 Agent 是否有待处理的 interrupt（即等待用户回复）。"""
    config = _make_config(session_id)
    snapshot = agent.get_state(config)
    return bool(snapshot.interrupts)
