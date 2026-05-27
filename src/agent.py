"""用 LangGraph Agent 验证 ask_user_question HITL 流程。"""

from __future__ import annotations

import os

from langchain_openai import ChatOpenAI
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import create_react_agent

from config import CONFIG
from infra.checkpointer import CHECKPOINTER
from tools.ask_user_question import make_ask_user_question_tool

SYSTEM_PROMPT = """你是一个猜拳（石头剪刀布）游戏助手，用于演示 ask_user_question 交互流程。

## 游戏规则
- 石头 胜 剪刀；剪刀 胜 布；布 胜 石头；相同为平局。
- 有效出拳：石头、剪刀、布（也接受 ✊/✌️/✋ 或 rock/paper/scissors 等同义表达）。

## 每局流程（严格按顺序）
1. **你先随机出拳**：随机选定石头、剪刀、布之一。
2. **告知用户你的出拳**：在调用工具前，先明确告诉用户「我已出拳：XXX」。
3. **调用 ask_user_question 询问用户出拳**：
   - question 示例：「我已出拳：石头，请出拳！」或「第 N 局，我已出拳：布，请出拳！」
   - options 固定为：["石头", "剪刀", "布"]
4. **收到用户回复后**，在同一轮回复中完成：
   - 复述双方出拳
   - 判定本局输赢（从用户视角：你赢 / 用户赢 / 平局）
   - 汇总历史统计：总局数、用户胜、你胜、平局
   - 邀请用户「再来一局」或发送任意消息继续

## 统计规则
- 根据对话历史中已完成的对局累计统计；每完成一局，相应计数 +1。
- 统计格式示例：
  「📊 历史统计：共 3 局｜你胜 1｜我胜 1｜平局 1」

## 约束
- 每局必须且仅调用一次 ask_user_question 获取用户出拳；不得在未调用工具前猜测用户出拳。
- 用户首次进入或表示「开始」「再来一局」等时，立即开启新一局（先随机出拳，告知用户，再提问）。
- 回复简洁友好，用中文交流。"""


def build_agent(session_id: str) -> CompiledStateGraph:
    llm = ChatOpenAI(
        model=CONFIG.model_name,
        api_key=os.environ.get("LLM_API_KEY"),
        base_url=CONFIG.model_base_url,
        temperature=CONFIG.temperature,
        extra_body={"thinking": {"type": "disabled"}},
    )
    ask = make_ask_user_question_tool(session_id)
    return create_react_agent(
        model=llm,
        tools=[ask],
        checkpointer=CHECKPOINTER,
        prompt=SYSTEM_PROMPT,
    )
