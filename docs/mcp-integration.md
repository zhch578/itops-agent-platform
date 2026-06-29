# MCP 集成指南 — 外部客户端对接

本文档说明如何将 daima AIOps 平台作为 MCP Server 接入外部客户端。

---

## 架构概览

```
┌──────────────────────┐     SSE/HTTP      ┌──────────────────────┐
│  Claude Desktop      │ ←───────────────→ │  daima MCP Server    │
│  Cursor IDE          │    JSON-RPC 2.0   │  /api/mcp/sse        │
│  Continue.dev        │                   │  /api/mcp/message    │
│  其他 MCP 客户端      │                   │  (25 个运维工具)       │
└──────────────────────┘                   └──────────────────────┘
```

---

## 一、前提条件

```bash
# 确保 daima 后端已启动
cd backend
npm run dev
# → http://localhost:3001

# 验证 MCP 服务可用
curl http://localhost:3001/api/mcp/health
# → {"status":"healthy","protocol":"2025-03-26","tools":25,"uptime":...}

# 查看可用工具清单
curl http://localhost:3001/api/mcp/manifest
```

---

## 二、Claude Desktop 配置

### 方式 A：SSE 传输（推荐）

编辑 `claude_desktop_config.json`：

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "daima-aiops": {
      "type": "sse",
      "url": "http://localhost:3001/api/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

**重启 Claude Desktop** 后生效。

### 方式 B：无验证模式（本地开发）

```json
{
  "mcpServers": {
    "daima-aiops": {
      "type": "sse",
      "url": "http://localhost:3001/api/mcp/sse"
    }
  }
}
```

### 连接流程

```
1. Claude Desktop 启动
2. GET  /api/mcp/sse          →  建立 SSE 长连接，收到 endpoint 事件
3. POST /api/mcp/message      →  initialize（握手）
4. POST /api/mcp/message      →  tools/list（获取 25 个工具）
5. 用户在 Claude 里对话
6. Claude 自主决定调用工具 → POST /api/mcp/message → tools/call
7. 结果返回 Claude → Claude 用结果继续回答
```

### 验证连接成功

在 Claude Desktop 对话中输入：

> 帮我查询系统当前有哪些活跃告警

Claude 会自动调用 `alert.list` 工具，展示告警列表。

---

## 三、Cursor IDE 配置

### 方式 A：SSE 传输

编辑 Cursor 设置 → MCP 标签页，添加：

```json
{
  "mcpServers": {
    "daima-aiops": {
      "url": "http://localhost:3001/api/mcp/sse"
    }
  }
}
```

### 方式 B：HTTPS（daima 部署到公网时）

```json
{
  "mcpServers": {
    "daima-aiops": {
      "url": "https://your-daima-domain.com/api/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

---

## 四、直接 HTTP 调用（测试/调试用）

不通过 SSE，直接调用 JSON-RPC 端点：

### 1. 握手（initialize）

```bash
curl -X POST http://localhost:3001/api/mcp/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "clientInfo": { "name": "curl-test", "version": "1.0" }
    }
  }'
```

响应：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "serverInfo": { "name": "daima-aiops", "version": "1.0.0" },
    "capabilities": { "tools": { "listChanged": false } }
  }
}
```

### 2. 获取工具列表（tools/list）

```bash
curl -X POST http://localhost:3001/api/mcp/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'
```

### 3. 调用工具（tools/call）

```bash
# 查询告警列表
curl -X POST http://localhost:3001/api/mcp/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "alert.list",
      "arguments": { "severity": "critical", "limit": 5 }
    }
  }'
```

```bash
# 查询系统健康状态
curl -X POST http://localhost:3001/api/mcp/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "monitor.health",
      "arguments": {}
    }
  }'
```

```bash
# 查询服务器列表
curl -X POST http://localhost:3001/api/mcp/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "server.list",
      "arguments": { "limit": 10 }
    }
  }'
```

### 4. REST 方式（非 MCP 客户端）

```bash
# 工具清单
curl http://localhost:3001/api/mcp/manifest

# 直接调用
curl -X POST http://localhost:3001/api/mcp/call \
  -H "Content-Type: application/json" \
  -d '{"name":"alert.list","arguments":{"limit":5}}'
```

---

## 五、Available Tools（可用工具速查）

| 工具名 | 说明 | 风险等级 |
|--------|------|----------|
| `alert.list` | 查询告警列表 | READONLY |
| `alert.analyze` | AI 根因分析 | LOW |
| `alert.correlate` | 告警关联分析 | READONLY |
| `server.list` | 服务器列表 | READONLY |
| `server.detail` | 服务器详情 | READONLY |
| `network.device.list` | 网络设备列表 | READONLY |
| `network.topology` | 网络拓扑 | READONLY |
| `container.list` | 容器列表 | READONLY |
| `vm.list` | 虚拟机列表 | READONLY |
| `k8s.cluster.summary` | K8s 集群摘要 | READONLY |
| `k8s.pod.list` | K8s Pod 列表 | READONLY |
| `dc.rack.list` | 机柜列表 | READONLY |
| `dc.device.list` | 数据中心设备 | READONLY |
| `monitor.health` | 系统健康状态 | READONLY |
| `monitor.metrics` | 系统运行指标 | READONLY |
| `workflow.list` | 工作流列表 | READONLY |
| `workflow.task.list` | 任务列表 | READONLY |
| `remediation.policy.list` | 修复策略 | READONLY |
| `remediation.audit` | 修复审计 | READONLY |
| `database.list` | 数据库列表 | READONLY |
| `infra.script.list` | 脚本列表 | READONLY |
| `infra.backup.list` | 备份记录 | READONLY |
| `aiops.knowledge` | 知识图谱 | READONLY |
| `aiops.session.list` | AI 会话历史 | READONLY |
| `auth.user.list` | 用户列表 | READONLY |

---

## 六、REST API 端点总览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mcp/sse` | GET | SSE 传输端点（客户端连接入口） |
| `/api/mcp/message` | POST | 消息端点（SSE Session 内） |
| `/api/mcp/rpc` | POST | JSON-RPC 2.0 统一入口 |
| `/api/mcp/manifest` | GET | 工具清单（REST） |
| `/api/mcp/call` | POST | 工具调用（REST） |
| `/api/mcp/health` | GET | 健康检查 |
| `/api/mcp/approval/create` | POST | 创建审批票据 |
| `/api/mcp/approval/approve` | POST | 审批通过票据 |
| `/api/mcp/approval/:ticketId` | GET | 查询票据状态 |
| `/api/mcp/audit` | GET | 安全审计日志 |
| `/api/mcp/security/config` | GET | 安全门配置 |

---

## 七、故障排查

### Claude Desktop 看不到工具

1. 检查 daima 是否启动：`curl http://localhost:3001/api/mcp/health`
2. 检查配置路径是否正确
3. 查看 Claude Desktop 日志：
   - macOS: `~/Library/Logs/Claude/mcp.log`
   - Windows: `%APPDATA%\Claude\logs\mcp.log`

### tools/call 返回 "Security check failed"

说明工具的 `riskLevel` 或 `requiresApproval` 配置导致安全门拦截。

**解决**：
```bash
# 1. 创建审批票据
curl -X POST http://localhost:3001/api/mcp/approval/create \
  -H "Content-Type: application/json" \
  -d '{"toolName":"alert.analyze","userId":"user1","reason":"需要分析告警"}'

# 2. 审批通过
curl -X POST http://localhost:3001/api/mcp/approval/approve \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"<返回的ticketId>","approverId":"admin"}'

# 3. 调用时携带票据
# 在 arguments 中添加 __approval_ticket
```

### Session expired

```
curl: (404) Session not found or expired. Reconnect via GET /api/mcp/sse
```

**解决**：重新发起 SSE 连接获取新的 sessionId。
