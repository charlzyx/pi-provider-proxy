# pi-llm-proxy

Pi coding agent 通用**按 provider 走代理**扩展：一个代理地址 + 一个 provider 列表，列表里的 provider 的模型请求和认证请求全部走该代理。移植自 [dshwork/packages/llm-provider-proxy](../dshwork/packages/llm-provider-proxy)。

## 为什么需要

Node 的全局 `fetch` 不读 `http_proxy` / `https_proxy` 环境变量，而部分 provider 端点（如 `chatgpt.com`、`auth.openai.com`）在部分地区网络不可直达。本扩展包装全局 `fetch`，命中配置 provider 的请求经零依赖 CONNECT 隧道走代理，其余请求原样放行——不是全局代理。

## 配置（`~/.pi/agent/llm-proxy.json`，热生效）

```json
{
    "proxy": "http://127.0.0.1:7897",
    "providers": ["openai-codex"],
    "hosts": []
}
```

- `proxy`：一个 HTTP 代理（Clash/ClashX/公司代理均可），需要认证时写 `http://user:pass@host:port`
- `providers`：哪些 provider 走这个代理
- `hosts`：额外要走的请求 host（provider 覆盖不到的自建网关）

`PI_LLM_PROXY_CONFIG` 环境变量可指向其他配置文件。文件按 mtime 热重载，改完即生效，无需重启 Pi；改坏了会沿用上一份有效配置。

## 安装

扩展零运行时依赖，直接把仓库给 Pi 加载：

```bash
git clone <repo> ~/github/pi-llm-proxy
cd ~/github/pi-llm-proxy && npm install   # 仅装 devDependencies 用于开发
ln -s ~/github/pi-llm-proxy ~/.pi/agent/extensions/pi-llm-proxy
```

或在 `~/.pi/agent/settings.json` 里加：

```json
{
    "extensions": ["~/github/pi-llm-proxy/src/index.ts"]
}
```

## 内置 provider host 表

内置表覆盖 pi-ai 全部常见 provider 的请求与 OAuth 域名，例如：

| provider | hosts |
| --- | --- |
| `openai-codex` | `chatgpt.com`, `auth.openai.com` |
| `openai` | `api.openai.com`, `auth.openai.com` |
| `anthropic` | `api.anthropic.com`, `console.anthropic.com` |
| `csdn` | `ai.csdn.net` |
| `deepseek-official` | `api.deepseek.com` |
| `google` | `generativelanguage.googleapis.com`, `oauth2.googleapis.com` |
| `openrouter` | `openrouter.ai` |

`~/.pi/agent/models.json` 里自定义 provider 的 `baseUrl` host 也会自动归属到对应 provider（比如自建网关）。

## 工作原理

- 扩展加载时包装全局 `fetch`：每个请求按 host 判断属于哪个 provider，命中配置则经代理 CONNECT 隧道发出，否则原样放行
- **回环地址（127.0.0.1 / localhost / ::1）永不代理**，本机网关（如 magpie、combo）不受影响
- 隧道由 Node 内置模块实现，包内无任何运行时依赖
- `/llm-proxy` 命令查看当前代理、生效 host 列表和请求计数

## 开发

```bash
npm run check   # tsc --noEmit
npm test        # node --test（CONNECT 隧道、host 路由、回环放行、配置热重载）
```

## 许可证

MIT
