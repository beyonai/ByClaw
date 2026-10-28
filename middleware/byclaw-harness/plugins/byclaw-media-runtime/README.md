# ByClaw media runtime

`byclaw-image` 与 `byclaw-tts` 的内部共享库，不单独注册 Cordis 插件。

会话工具通过 `byclaw/session-setup` 取得已认证 host；执行时从与 byclaw-context 相同的 workspace registry 读取 session_root。图片只写入 `session_root/image/`，音频只写入 `session_root/tts/`；唯一文件名、排他写入，不覆盖现有制品，不允许模型传入路径、端点或凭据。无可信 session_root 会在请求供应商前失败。

integration 先读取有效的用户媒体连接器投影，缺失时读取 Redis 已启用的 IMAGE_GENERATION/TTS 默认配置；损坏投影不会静默回退。可用部署变量 BYCLAW_IMAGE_MODEL_ID/BYCLAW_TTS_MODEL_ID 选择明确 ID，仍须校验类型与启用状态。凭据通过 integration 现有解密函数读取；模型端只收到供应商、模型代码与制品路径。

网络请求支持超时和取消，拒绝重定向以避免凭据转发。供应商错误正文不回显。外部制品下载不携带鉴权头，只接受公网 HTTPS 或 base64 data URL。HTTPS 下载将已校验的公网 DNS 地址固定到实际连接，保留原主机名和 TLS SNI，防止二次解析造成 DNS 重绑定。单个制品最大 50 MiB，JSON 响应最大 70 MiB，每次最多 8 个制品。目录符号链接会拒绝。

验证：`node --test tests/*.test.js`。供应商协议与配置见两套插件的 README；契约测试不代表每家供应商均已通过付费线上调用。

插件支持部署层 `config.provider` / `config.protocol` 显式覆盖历史模型记录中错误的标签，不改变地址、凭据或全局记录。不要把这些部署字段传入模型工具参数。

真实主 agent 验证脚本：`BYCLAW_INTEGRATION_ROOT=/path/to/built/byclaw-integration node --env-file=/path/to/dsh/.env scripts/live-main-e2e.mjs image`（或 `tts`）。被测实例应配置专属 `agentTypes: [BYCLAW_DSH_MEDIA_E2E_<USER_CODE>]`，避免与线上同账号容器竞争；也可通过 `E2E_TARGET_AGENT_TYPE` 指定。终态响应本身不是供应商成功证据，验收还应核对 DSH 持久化工具事件与真实可解码文件。

Voice admission also resolves the enabled system-default `ASR` configuration. It stores original MP3 input under the current authoritative `session_root/asr/`; this does not alter the `image/` and `tts/` output directories. Provider ASR and TTS credentials/entitlements are configured independently.


### Speech capability feedback

`mountMediaPlugin` accepts an optional `describe(model)` for TTS. It registers the
session-scoped, read-only `text_to_speech_options` tool using the same live model
resolution and deployment overrides as synthesis. The query does not need a session
artifact directory. Registration, identity checks, disposal, and session restore
apply to both speech tools.

Generators may return the existing `MediaAsset[]` or `{ assets, warnings }`.
TTS outputs include `status` and `warnings`; an explicit limitation with no assets
returns `unsupported` without persisting files or disguising it as a connector error.
Image output remains unchanged. Artifacts are read and written through the host's `artifactIo` when it supplies one (the shared DSH host does, so files land in the user's tool environment); otherwise through this process's filesystem. Keep speech controls in provider adapters rather
than adding provider-specific request logic to this shared runtime.
