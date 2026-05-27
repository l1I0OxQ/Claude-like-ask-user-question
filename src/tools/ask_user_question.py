import json
import uuid

from langchain_core.tools import tool
from langgraph.types import interrupt

from infra.stream_manager import stream_manager


def make_ask_user_question_tool(session_id: str):
    """Factory: return an ask_user_question tool bound to the given session_id."""

    @tool
    def ask_user_question(question: str, options: list[str]) -> str:
        """向用户提问并等待从选项中选择，或输入自定义答案。

        Args:
            question: 要向用户提问的问题内容。
            options: 供用户选择的选项列表（2-4 个为宜）。
        """
        question_id = uuid.uuid4().hex
        payload = json.dumps(
            {
                "question": question,
                "options": options,
                "session_id": session_id,
                "question_id": question_id,
            },
            ensure_ascii=False,
        )
        if not stream_manager.is_resuming(session_id):
            stream_manager.stream_output(
                f"\n\n```ask-user-question\n{payload}\n```\n\n",
                thread_id=session_id,
            )
        reply = interrupt({
            "type": "ask_user_question",
            "question": question,
            "options": options,
        })
        return reply if isinstance(reply, str) else str(reply)

    return ask_user_question
