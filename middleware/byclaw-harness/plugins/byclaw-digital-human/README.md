# 火山单图音频驱动 DSH 插件

独立 Cordis/DSH 插件，使用宿主 `tools`、`fs` 核心服务，以及阿里云 `ali-oss` SDK 生成 OSS V4 签名。
没有 `byclaw-integration`、`byclaw-image`、`byclaw-tts` 或共享媒体插件依赖，也不监听 ByClaw 专属事件。
适配已核对的 DSH `0.2.1-rc.2` 文件系统接口；不安装或改动正在运行的 DSH。

## 安装

将整个目录作为本地包安装到 DSH，由插件管理器加载 `@byclaw/byclaw-digital-human`，
或使用随包 `cordis.patch.yml`。宿主需提供 `tools` 与 `fs`。
在插件目录运行 `npm ci --registry=https://registry.npmmirror.com` 安装依赖。
火山配置和本地素材通过插件上下文每次查找的 `ctx.get('fs')`（同一个 `ctx.fs` 核心服务）读取，
支持文件实际位于远程工具环境的宿主。不会解析 `FsTarget.targetKey` 或使用 `node:fs`。

部署配置仅允许 `configPath`，默认 `/by/.connector-auth/.model/digital-human.json`，
与图片的 `.model/image.json`、语音的 `.model/tts.json` 使用同一目录约定。
此路径属于用户连接器投影，必须由宿主隔离到当前用户；多租户宿主应将插件挂载到用户作用域，
并提供该用户的文件系统能力与投影路径，不要在全局工具作用域暴露用户凭据。
火山 AK/SK 由此投影提供。OSS 凭据由 DSH 宿主进程的环境变量提供。

## 用户连接器与投影契约

用户应在连接器界面配置火山 AK/SK，并启用连接器；火山账号还需开通单图音频驱动服务。
插件只消费连接器生成的投影，不写入或管理连接器凭据。每次调用重新读取，更新、禁用、撤销应由投影生产者原子更新或删除文件。
文件缺失、禁用、格式错误、过期、符号链接或超过 16 KiB 均拒绝调用并返回配置引导。

投影协议如下（占位示例，不能直接用于调用）：

```json
{
  "schemaVersion": 1,
  "connectorCode": "volcengine-digital-human",
  "enabled": true,
  "accessKeyId": "<由连接器投影>",
  "secretAccessKey": "<由连接器投影>"
}
```

可选 `securityToken` 用于临时凭据，可选 `expiresAt` 为 ISO 时间戳。生产者须使用用户私有权限保存文件，
撤销时删除文件。插件不提供模型可见的凭据写入工具，不将凭据、原始配置、供应商响应体或请求头写入输出或错误。

当前接入的原生视觉接口使用 AK/SK 计算 HMAC-SHA256 签名；插件不支持用单个 `apiToken` 替代这两个字段。
`securityToken` 是临时 AK/SK 配套的 STS Token，也不能单独使用。
图片/TTS 投影中的 `apiToken` 属于各自适配协议，不能据此推断本服务支持 Bearer Token。

**接入边界：** 本目录提供独立插件与投影消费协议。现有 ByClaw 图片/TTS 的 `.model` 投影不包含本服务的 AK/SK，
不能直接复用；新增 ByClaw 连接器表单、服务端校验/投影及连接器列表记录需另外接通此协议。
迁移版本须由用户指定后才能新增 DML。本插件安装本身不会让新连接器自动出现在 ByClaw 界面。

## 调用流程

| 工具 | 必填参数 | 结果 |
| --- | --- | --- |
| `digital_human_create_role` | `mode`，`imageUrl` / `imagePath` 二选一 | 形象创建任务 `taskId` |
| `digital_human_get_role` | `mode`, `taskId` | 状态；成功时 `resourceId` |
| `digital_human_create_video` | `mode`、`resourceId`，`audioUrl` / `audioPath` 二选一 | 视频生成任务 `taskId` |
| `digital_human_get_video` | `mode`, `taskId` | 状态；成功时 `videoUrls` |
| `digital_human_check_configuration` | 无，传 `{}` | 本地配置状态及安全的失败阶段/原因 |

配置读取优先使用受大小限制的 `readBytes`；提供者没有字节读取时，支持 `streamText`，
以及 devflow 使用的 `resolve` / `lstat` / `readText` 最小接口。纯 `readText` 回退要求元数据有明确且不超过
16 KiB 的大小，并在读取后再次检查字节数；此回退不能保证提供者内部在并发文件替换时仍限制内存占用。
提供者有 `readBytes` 时不因权限错误回退到其他方法，保持原访问边界。

排查配置失败时先调用 `digital_human_check_configuration({})`，不调用收费服务，也不返回凭据。
`ready` 仅证明文件可读且本地格式校验通过。失败结果例如：

```json
{
  "status": "configuration_required",
  "stage": "lstat",
  "reason": "FILE_NOT_FOUND",
  "connectorCode": "volcengine-digital-human",
  "message": "MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=volcengine-digital-human; 火山数字人视频连接器不可用（stage=lstat; reason=FILE_NOT_FOUND）。请点击工具结果中的配置按钮，检查并重新保存连接信息；配置完成前停止重试当前工具。"
}
```

阶段分为 `provider`、`lstat`、`resolve`、`read`、`parse`、`validate`。
缺文件、符号链接、超限、非法 JSON、禁用、字段不匹配以及已知 `FS_*` 权限错误分别返回安全原因；
未知异常不携带原始错误文本。创建、查询工具的配置异常及供应商鉴权失败也返回上述消息标记，
供前端识别并显示“需要配置火山数字人视频连接器”按钮；配置完成前应停止重试。
OSS 环境变量配置错误不使用此连接器标记，仍由部署环境配置。
更新插件后须通过宿主重载插件或重启，使运行进程加载新代码；`--dump-config` 正确不代表运行中代码已更新。

`mode` 为 `normal`、`loopy`、`loopyb`，全过程须一致，形象 ID 可以配合不同音频复用。
排队或处理中返回 `pollAfterSeconds: 10`；由调用方等待后再次查询，不在工具内长时间轮询。
`done` 只有包含有效形象 ID 或视频链接且算法未报错才返回成功。`not_found` 和 `expired` 保留原状态。
视频链接约 1 小时有效，插件不下载或保存视频，不创建本地视频制品。

创建形象和视频均产生供应商费用。插件不自动重试任何请求；提交超时、断连时可能已经受理，
应先核对供应商记录，不要直接重新提交。查询错误只需稍后查原任务。单次请求最多 60 秒，转发调用方取消信号。

URL 入参为火山可访问的 HTTP(S) 地址，拒绝 data URL、内网 IP 和带用户名密码的 URL。
本地路径入参先经 `ctx.fs` 读取，再上传 OSS。插件校验路径、格式标记和大小，火山最终校验素材内容。

普通模式最长音频 180 秒；灵动模式宠物 90 秒、真人 180 秒；大画幅灵动 45 秒，不支持宠物。
请使用完整清晰无遮挡的正脸图片，避免多人、偏转、张嘴过大及有效人脸区域过小。

## OSS 本地素材上传

在启动 DSH 的进程环境中配置以下变量，已有运行实例需要重新启动以继承环境。

```bash
export OSS_BUCKET='your-bucket'
export OSS_REGION='cn-beijing'
export OSS_ACCESS_KEY_ID='<阿里云 AK>'
export OSS_ACCESS_KEY_SECRET='<阿里云 SK>'
# 使用 STS 临时凭据时设置 OSS_SESSION_TOKEN
```

`OSS_REGION` 填 Bucket 的实际地域，支持 `cn-beijing` 或 `oss-cn-beijing` 格式。
使用 `imageUrl` / `audioUrl` 时无需 OSS 配置，`digital_human_check_configuration` 检查的是火山连接器投影。

`imagePath` 支持 JPG/JPEG/PNG（10 MiB 以内），`audioPath` 支持 MP3/WAV（32 MiB 以内）。
相对路径以会话初始工作区为基准，绝对路径也必须在该工作区内。读取需要支持 `readBytes` 的 `ctx.fs` 提供者。

例如，创建形象时传 `{"mode":"normal","imagePath":"assets/portrait.jpg"}`。获得形象 ID 后，提交视频生成时传
`{"mode":"normal","resourceId":"your-resource-id","audioPath":"assets/voice.mp3"}`。

插件把素材上传到 `digital-human/` 下的随机对象键。PUT 使用有效期 600 秒的 V4 签名，设置对象 ACL 为 `public-read`，
火山接收无签名的公网 HTTPS 对象 URL。OSS 全局与 Bucket 的「阻止公共访问」必须允许此操作，上传身份需具备相应权限。
对象公开读权限和存留时间由 OSS 管理。上传失败时工具不会提交火山任务。

## 验证

```bash
node --test tests/*.test.js
npm run build
# 可选：用已安装的真实 DSH 核心包执行注册、输出校验、作用域与卸载测试；不下载依赖。
DSH_NODE_MODULES=/absolute/path/to/dsh/node_modules node --test tests/runtime.test.js
```

本地测试使用脱敏响应及模拟网络，不证明火山真实账号权限、素材接受率、模型工具选择或线上平台兼容性。
测试使用 SDK 实际签名和模拟 OSS/火山网络响应。安装依赖使用国内 npm 镜像，运行时从已安装的依赖加载 SDK。

## 官方协议依据

- [形象创建](https://docs.volcengine.com/docs/intelligent-vision-services/call-step1-image-creation?lang=zh)
- [视频生成](https://docs.volcengine.com/docs/intelligent-vision-services/call-step2-video-generation?lang=zh)
- [入参图片规则](https://docs.volcengine.com/docs/intelligent-vision-services/imported-para-meter-image-support-rule-description?lang=zh)
- [签名方法](https://docs.volcengine.com/docs/6369/67269)
- [OSS Node.js SDK 预签名上传](https://help.aliyun.com/zh/oss/developer-reference/upload-objects-using-a-signed-url-generated-with-oss-sdk-for-node-js)
- [DSH 源码](https://github.com/deepseek-ai/deepseek-harness)，对应 `packages/fs/fs` 与工具注册接口。

接口为 `CVSubmitTask` / `CVGetResult`、版本 `2022-08-31`、Region `cn-north-1`、Service `cv`；
不混用 `CVSync2AsyncSubmitTask` 或方舟视频接口。
