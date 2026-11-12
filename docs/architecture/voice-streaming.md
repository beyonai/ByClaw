# Web 语音听写

ByClaw 和 Hacu 的听写入口读取 `POST /byaiService/system/staticdata/getDcSystemConfig`，参数 `paramCode` 为 `VOICE_STREAM_SERVICE_CONFIG`。将下面任一对象序列化到系统参数的 `paramValue`，凭证字段使用已有的 SM4 格式。

讯飞中英 V2.0

```json
{
  "type": "xunfei-spark-asr-v2",
  "appIdEncrypted": "<AppID 密文>",
  "credentials": {
    "apiKeyEncrypted": "<APIKey 密文>",
    "apiSecretEncrypted": "<APISecret 密文>"
  }
}
```

可选 `hotwordResourceId`。浏览器每次听写重新签名，直连讯飞 `/v1`，应用动态修正结果。需要麦克风权限和可用的浏览器安全上下文。[讯飞 V2.0 协议](https://www.xfyun.cn/doc/spark/spark_zh_iat_new.html)

火山大模型 2.0

```json
{
  "type": "volcengine-streaming-asr-v2",
  "resourceId": "volc.seedasr.sauc.duration",
  "credentials": {
    "apiKeyEncrypted": "<API Key 密文>"
  }
}
```

并发版使用 `volc.seedasr.sauc.concurrent`。旧版控制台使用 `appIdEncrypted` 和 `credentials.accessTokenEncrypted`。火山要求在握手时传自定义请求头，浏览器通过同源 `/byaiService/voice/stream` 连接 ByClaw 后端。连接收到并校验当前账号凭证后，后端读取同一系统参数、添加火山握手头并发送固定的 16 kHz 单声道 PCM 初始化包。后端通知就绪后，浏览器发送音频和结束帧，接收实时文字快照及最终结果。[火山大模型流式协议](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=zh)

Web 开发代理已配置火山转发，standalone Nginx 沿用现有的 `/byaiService` WebSocket Upgrade 规则。其他反向代理需把上述路径的 WebSocket Upgrade 请求转发到 ByClaw 的 HTTP 服务端口并保留浏览器请求的 Host。Hacu Web 与 ByClaw 使用同一个转发入口。部署使用火山配置时，前后端需一起更新。

每次听写重新读取配置，切换供应商影响下一次听写。空配置提示未配置，其他类型或非法字段提示配置无效。静态参数接口可以被匿名读取，密文字段沿用客户端可解密的现有配置格式，真实试切凭证应由受控环境供给。
