import json
from typing import Any


def escape_code_fence(text: str) -> str:
    return text.replace("```", "'''")


def format_payload(payload: Any) -> str:
    try:
        result = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
        result = result.replace("\\n", "\n").replace('\\"', '"')
        return result
    except Exception:
        return str(payload)


def build_tool_start_markdown(tool_name: str, payload: Any) -> str:
    payload_text = escape_code_fence(format_payload(payload))
    return (
        f"\n<details>\n"
        f"<summary>Tool: {tool_name}</summary>\n\n"
        f"**Arguments**\n\n```json\n{payload_text}\n```\n\n"
        f"</details>\n"
    )


def build_tool_end_markdown(tool_name: str, result_payload: Any) -> str:
    result_text = escape_code_fence(format_payload(result_payload))
    return (
        f"\n<details>\n"
        f"<summary>Tool Result: {tool_name}</summary>\n\n"
        f"**Output**\n\n```json\n{result_text}\n```\n\n"
        f"</details>\n"
    )
