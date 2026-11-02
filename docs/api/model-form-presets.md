# 新增模型的简化表单与确定性填充

系统模型与个人模型共用新增流程。选择“快速配置模型”或输入能唯一识别的型号后，填充名称、类型、提供商、协议、地址和已知能力参数；API Key 由用户填写。Header、超时重试、可选基本信息、参数和应用配置默认折叠，保存时有错误则展开相关区域。

## 自动填充边界

- 仅对尚未保存的新增记录启用；编辑旧记录和“保存并继续”后的记录不自动重新计算能力。
- 新增表单默认勾选应用范围“对话模型”（`abilities: ['3']`），管理员与个人入口一致；前端不会补回用户手动取消的值，编辑时回显原值。个人保存接口原有的强制追加该标签逻辑不变。数字员工问答模型的“公共”列表按此标签及启用状态筛选，“我的”列表查询本人已启用的模型，不使用该标签过滤。
- 只更新空白或上次自动填入且未修改的值。用户主动修改、清空、设为 0 或 false 都视为手动设置。密钥和自定义 Header 不参与模板填充。
- 型号精确匹配，不根据前缀猜能力。相同型号在多个渠道出现时，由用户明确选择渠道模板。
- 切换到未知型号时撤销旧的自动能力值，保留连接信息和手动设置。未知非图片模型需要确认并填写上下文长度；不再假设 202752 上下文或 65536 输出预算。
- 前端容量校验允许正整数，取消统一的 200000/65536 最低限制。有官方容量的模板按对应渠道的上下文上限和最大输出上限填充，不再统一预填 8192。官方未明确独立输出上限时保持留空，不把示例值或上下文窗口当作输出上限。新增表单的型号、类型、协议、地址都匹配官方模板时，校验已登记的容量上限；自定义代理及旧记录不受该上限约束。
- 新增流程的自动调试同步当前采样参数和输出预算；未填参数不发送。已保存记录的既有调试模板与协议路径保留。

## 模板来源与维护

快速配置与型号候选项只读取代码中维护的官方模板目录，不查询系统模型、个人模型或公共模型列表。已有记录的 `displayName`、型号别名、地址和参数不作为模板来源。模板显示为“型号 · 模型厂商（接入渠道）”，例如“GLM-5.3 · 智谱（阿里云百炼接入）”“Kimi-K3 · 月之暗面（阿里云百炼接入）”；厂商直连模板只显示型号与厂商。厂商和渠道按界面语言显示，型号置于最前。列表先按本地化的模型厂商名称排序，再在同厂商内按型号自然排序、忽略大小写；保持平铺列表，不添加分组标题。同厂商的图片与文本模型连续排列，例如 MiniMax 的 image-01、M2.7、M2.7-highspeed、M3；Kimi Code 和百炼渠道的 Kimi 也排在一起。排序依据是模型厂商而非接入渠道，缺少厂商信息时按型号名称排序，排序不修改模板内容或实际调用配置。

`developer` 和 `channel` 是模板展示元数据，不参与自动填充或保存。百炼是接入渠道，不能据此把 GLM、Kimi 的模型厂商标为阿里云；调整展示名称不会把实际 `providerName: Bailian`、百炼地址或请求参数改成原厂直连。使用这些模板仍需对应渠道的 API Key。

模板集中在 `modelFormPresets.ts`，每项保留官方文档链接。只登记明确的 API 型号、渠道、协议及已核实参数，不根据名称或前缀推断能力。图片模板使用明确型号清单，复用现有连接协议；ComfyUI 工作流、LiteLLM 网关等不会因协议已支持就自动成为官方模型模板。

本次核对日期：2026-10-15。覆盖此前生产/测试记录中已确认可作为通用模板的 MiniMax-M3、MiniMax-M2.7-highspeed、deepseek-flash、deepseek-v4-pro、Kimi K2.6、Qwen3.6 Plus、Qwen3.7 Max、GLM-5.2、Claude Sonnet 5、text-embedding-v4、MiniMax Image 和 Seedream 4/5；另保留已支持的官方图片模板，并提供 MiniMax-M2.7。

以下 11 个主流型号均有对应模板。补充 GLM-5.3、GLM-5.3-Flash、GLM-5.1、Kimi-K3、Kimi-K2.7-Code、Kimi-K2.8-Preview。前五项使用百炼公开渠道；K2.8 Preview 使用 Kimi Code 专用渠道。展示型号名称、厂商和渠道，实际请求 ID 独立保存，不以市场名称猜测 API 型号：

容量核对覆盖当前全部文本与向量模板，实际自动填充值如下（token 数）：

| 市场型号 | 模板渠道 | 请求 model | 最大上下文长度 | Max Tokens |
| --- | --- | --- | --- | --- |
| GLM-5.3 | 百炼 | `glm-5.3` | 1048576 | 131072 |
| GLM-5.3-Flash | 百炼（智谱直供） | `ZHIPU/GLM-5.3-Flash` | 1048576 | 131072 |
| GLM-5.2 | 百炼 | `glm-5.2` | 1048576 | 131072 |
| GLM-5.1 | 百炼 | `glm-5.1` | 202745 | 131072 |
| MiniMax-M3 | MiniMax | `MiniMax-M3` | 1000000 | 524288 |
| MiniMax-M2.7 | MiniMax | `MiniMax-M2.7` | 204800 | 204800 |
| MiniMax-M2.7-highspeed | MiniMax | `MiniMax-M2.7-highspeed` | 204800 | 204800 |
| Kimi-K3 | 百炼 | `kimi-k3` | 1048576 | 1048576 |
| Kimi-K2.8-Preview | Kimi Code | `kimi-for-coding` | 1048576 | 留空：公开文档未明确独立输出上限 |
| Kimi-K2.7-Code | 百炼 | `kimi-k2.7-code` | 262144 | 16384 |
| Kimi-K2.6 | 百炼 | `kimi-k2.6` | 262144 | 16384 |
| DeepSeek-V4.1-Flash | DeepSeek | `deepseek-flash` | 1048576 | 393216 |
| DeepSeek-V4-Pro | DeepSeek | `deepseek-v4-pro` | 1048576 | 393216 |
| Qwen3.6-Plus | 百炼 | `qwen3.6-plus` | 1000000 | 65536 |
| Qwen3.7-Max | 百炼 | `qwen3.7-max` | 1000000 | 131072 |
| Claude Sonnet 5 | Anthropic | `claude-sonnet-5` | 1000000 | 128000 |
| text-embedding-v4 | 百炼 | `text-embedding-v4` | 8192（单条输入） | 不适用 |

`limits` 是容量的唯一来源，模板的 `values` 从同一份上限生成，避免校验上限与自动填充值不一致。新增表单、保存数据和自动调试请求使用用户当前表单值；手动降低或清空 Max Tokens 后不会被模板补回。

这些数字是独立容量上限，不保证在输入已占满上下文时仍可生成同等数量的输出。输入、输出及思考 token 的计算规则、模式限制以对应渠道文档为准；本次不修改运行时上下文裁剪或预算分配逻辑。

- GLM-5.3/5.3-Flash 与 Kimi-K3 默认启用思考，使用百炼 `enable_thinking: true` 和 `reasoning_effort: max`，支持 `low/high/max`，不发送预算或采样参数。
- Kimi-K2.7-Code 仅开启思考，不套用 K3 的 effort 参数。GLM-5.3 系列与 K2.7 Code 的新增表单展示保持思考开启的提示；用户显式修改仍遵守手填值优先规则。
- GLM-5.1 使用本渠道文档的精确上下文值 202745；其思考模式输入上限为 169984，不能把上下文上限当作任意模式下的可用输入长度。
- K2.8 Preview 使用 `https://api.kimi.com/coding/v1`，需要有效 Kimi Code 订阅与该平台 API Key。不能替换为 `api.moonshot.cn` 或把 `kimi-k2.8-preview` 作为官方请求型号；表单显示专用渠道提示。默认使用 `reasoning_effort: max`，显式映射 `low/high/max`，不改变旧模型的 effort 兼容规则。该服务的 `kimi-for-coding` 是滚动别名，未来对应版本以官方说明为准。
- DeepSeek-V4.1-Flash 的模板标签补充市场名称便于搜索，原请求 ID 和地址保持不变，输出预算按上表填充。所有新增项继续使用原来的 `OpenAI` 协议；没有新增协议值、保存字段或修改运行时调用逻辑。

- [MiniMax OpenAI SDK](https://platform.minimax.io/docs/api-reference/text-openai-api) 给出上下文；[Chat Completions 参数](https://platform.minimax.io/docs/api-reference/text-chat-openai) 给出输出上限：M3 为 524288，M2.x 为 204800。131072 / 65536 是其建议值，本模板按用户要求使用上限。保留现有 max_tokens 参数及协议，不改为另一套调用字段。M2.x 思考不能关闭，不自动注入思考开关。
- [DeepSeek 型号规格](https://api-docs.deepseek.com/api/list-models/) 明确 context_window=1048576、max_output_tokens=393216。使用公开 API 型号 `deepseek-flash`，不把环境中的 `:cloud` 后缀当作官方通用型号。
- 百炼模型页：[Kimi K2.6](https://help.aliyun.com/zh/model-studio/kimi-k2-6)、[Qwen3.6 Plus](https://help.aliyun.com/zh/model-studio/qwen3-6-plus)、[Qwen3.7 Max](https://help.aliyun.com/zh/model-studio/qwen3-7-max)、[GLM-5.2](https://help.aliyun.com/zh/model-studio/glm-5-2)。模板明确为百炼渠道，使用 `bailian` 思考格式，不混用其他渠道的能力值。
- [百炼 OpenAI 兼容地址](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)：预填仍可用的北京公共地址，用户可按 Key 所属地域改为自己的工作区地址。
- 新增 GLM 来源：[GLM-5.3](https://help.aliyun.com/zh/model-studio/glm-5-3)、[GLM-5.3-Flash](https://help.aliyun.com/zh/model-studio/glm-5-3-flash-by-zhipu)、[GLM-5.1](https://help.aliyun.com/zh/model-studio/glm-5-1)、[智谱直供思考参数](https://help.aliyun.com/zh/model-studio/glm-zhipu)。
- 新增 Kimi 来源：[Kimi-K3](https://help.aliyun.com/zh/model-studio/kimi-k3)、[Kimi-K2.7-Code](https://help.aliyun.com/zh/model-studio/kimi-k2-7-code)、[百炼 Kimi 参数](https://help.aliyun.com/zh/model-studio/kimi-api)、[Kimi Code 型号与专用入口](https://www.kimi.com/code/docs/kimi-code/models.html)。
- [Claude Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/overview)：不预填采样参数，使用自适应思考，不发送手动思考预算。
- [文本向量 API](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)：text-embedding-v4 单条输入上限 8192；维度沿用服务端默认设置，已有知识库仍需与其实际维度匹配。
- 图片模型的来源链接随模板展示。Seedream 的 2K、URL、水印继续作为当前单图调试默认配置。

目录不是市场全量清单，也不宣称所有环境记录都能自动配置。任意测试名、`model2`、`tts`、错误版本后缀均不入选；已下线的 Kimi K2.5 不作为新建推荐模板（见 [Kimi 模型列表](https://platform.kimi.com/docs/models)）；M3.1 预览版存在套餐限制，语音模型还有不同协议/资源参数，均不直接沿用环境中的 OpenAI 配置冒充通用模板。未登记的模型仍可手动配置，旧模型的展示名称、编辑回显、协议、调用和保存接口保持原样。

Kimi Code 的公开型号页仅确认 K2.8 Preview 的 1048576 上下文，未明确独立输出上限，因此撤销原先无官方依据的 8192 自动值并展示说明；允许用户按实际服务限制手动填写。图片模板不增加文本 token 字段，向量模型只填单条输入上限。模型别名能力可能随供应商调整；更新模板应重新核对来源，不能自动修改已有数据库记录。自定义代理可有不同限制，应保留用户显式配置。

本功能不调用“一键完善全部模型参数”接口，不使用 LLM 猜参数，不新增数据库字段，不修改 DSH 或现有保存 API。cURL 导入及远程型号发现不在本次范围内。
