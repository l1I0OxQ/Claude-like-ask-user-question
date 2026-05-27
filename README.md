# Ask User Question

让 AI 助手在对话中**主动向你提问**，而不是一直自说自话。

就像 Claude Code 的 `ask_user_question` 一样，AI 可以在需要你做决策时弹出选项卡片，你点击后它继续工作。这里用一个猜拳小游戏来演示这个交互流程。

## 效果演示

AI 在对话中随机出拳，然后弹出选项卡片让你选择：

```
AI: 我已出拳：石头，请出拳！

┌─────────────────────────────┐
│ 我已出拳：石头，请出拳！      │
│                             │
│ [石头] [剪刀] [布]           │
│                             │
│ 或输入其他选项，按 Enter 提交 │
└─────────────────────────────┘
```

你点击后，AI 立即判定胜负并记录战绩，然后邀请你再来一局。

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY

# 3. 启动后端
python src/web_server.py
```

后端启动后监听 `http://localhost:8888`，提供 OpenAI 兼容 API。可以直接用任何支持自定义 API 的客户端连接。

## 接入 OpenWebUI

如果你想在 OpenWebUI 中使用，需要通过 nginx 注入前端脚本。

### 部署步骤

**前提**：在项目根目录执行，并将 `nginx/nginx.conf` 中的 `YOUR_SERVER_IP` 替换为实际 IP。

```bash
# 1. 创建 Docker 网络（只需一次）
sudo docker network create openwebui-net

# 2. 启动 OpenWebUI
sudo docker run -d \
  --name open-webui \
  --network openwebui-net \
  -v open-webui:/app/backend/data \
  --restart always \
  ghcr.io/open-webui/open-webui:v0.6.18

# 3. 启动 nginx（注入前端脚本 + 反向代理）
sudo docker run -d \
  --name openwebui-nginx \
  --network openwebui-net \
  -p 3001:80 \
  -v "$(pwd)/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$(pwd)/frontend/ask_question.js:/usr/share/nginx/html/ask_question.js:ro" \
  --restart always \
  nginx:alpine

# 4. 启动后端
python src/web_server.py
```

### 配置 OpenWebUI

在 OpenWebUI 管理后台 → Settings → Connections 中，将模型 API 地址设为：

```
http://YOUR_SERVER_IP:8888/v1
```

### 验证

1. 浏览器打开 `http://YOUR_SERVER_IP:3001`
2. F12 → Console，输入 `window.__ASK_QUESTION_JS_VERSION` → 应输出 `"1.0.0"`
3. 发起对话，触发猜拳流程，选项卡片正常渲染
4. 点击选项后，AI 回复判定结果

### 日常运维

```bash
# 修改 nginx 配置或 JS 后重载
sudo docker exec openwebui-nginx nginx -s reload

# 查看日志
sudo docker logs -f openwebui-nginx

# 停止 / 启动
sudo docker stop openwebui-nginx open-webui
sudo docker start open-webui
sudo docker start openwebui-nginx
```

## API

| 端点 | 说明 |
|---|---|
| `GET /health` | 健康检查 |
| `GET /v1/models` | 模型列表 |
| `POST /v1/chat/completions` | 对话（SSE 流式），支持中断自动恢复 |

## 项目结构

```
src/
├── web_server.py               # FastAPI 入口
├── agent.py                    # LangGraph Agent（猜拳 demo）
├── config.py
├── tools/ask_user_question.py  # 核心工具：提问 + 等待用户选择
├── utils/agent_runner.py       # Agent 运行循环 + 流式输出
└── infra/                      # 基础设施（状态存储、流管理）
frontend/ask_question.js        # OpenWebUI 前端卡片组件
nginx/nginx.conf                # JS 注入 + 反向代理
```
