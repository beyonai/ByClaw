# 链接预览接口

`POST /byaiService/link-preview`（应用 context path 后的控制器路径为 `/link-preview`）。使用现有登录和请求签名机制，不新增匿名放行路径。

请求：

```json
{ "url": "https://example.com/article" }
```

成功响应沿用 ResponseUtil：

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": {
    "resolved": true,
    "title": "Article title",
    "description": "Article summary",
    "siteName": "Example",
    "favicon": "https://example.com/favicon.ico",
    "ogImage": "https://example.com/cover.jpg"
  }
}
```

不可抓取或没有有效预览内容时，返回成功 envelope，`data.resolved=false`，其余字段为空字符串。前端隐藏卡片、保留原始消息链接，不弹出错误提示。未登录拒绝访问；空 URL 或超过 4096 字符的 URL 校验失败。

## 抓取边界

- 只抓取公开 HTTP(S) HTML；允许所有合法端口（1–65535，包括 18080 等非默认端口），拒绝 URL 用户名/密码、本地/内网/保留地址。每次重定向校验目标，并在实际 DNS 解析时校验所有地址，防止验证与连接使用不同 DNS 结果。
- 不使用系统代理，不转发用户 Cookie、Authorization 或其他业务请求头，不执行页面脚本。最多跟随 3 次重定向，禁止 OkHttp 自动重定向与自动重试。
- 连接超时 3 秒，单次调用最多 5 秒，重定向链使用 8 秒 HTTP 时间预算；DNS 查找单独限时 2 秒，使用有界线程池。HTTP 超时无法强行中断系统原生 DNS，因此线程数与排队数也设上限。
- 只接受 `text/html` / `application/xhtml+xml`，解压后读取上限 1 MiB。使用 HTTP charset 或 Jsoup 编码检测；标题最多 300 字符、摘要 600 字符、站点名 120 字符。
- Open Graph 标题/摘要优先，回退到 HTML title/description。图片相对路径按最终页面地址解析；favicon 回退至该站点 `/favicon.ico`。仅输出文本和受限 HTTP(S) 图片地址，不返回原始 HTML。
- 每个应用实例最多同时抓取 8 个不同 URL，同 URL 请求合并。最多缓存 512 项，成功和不可用结果均缓存 5 分钟。过载时不排队、不缓存，返回不可用。
- 图片由浏览器直接加载，不经过图片代理；前端禁用 Referrer，并在加载失败时隐藏图片。防盗链、登录页、反爬或仅靠 JavaScript 生成的元数据仍可能不可预览。
- 不记录完整 URL、查询参数、网页正文或远程响应头。

## 验证

```bash
mvn -B -f byclaw-be/pom.xml -Dtest=LinkPreviewFetcherTest,LinkPreviewControllerTest verify
```

前端适配位于 HACU Overlay 的 `src/service/linkPreview.ts` 和 `src/components/LinkPreview/`。前后端需配套发布；前端不回退到浏览器抓取网页 HTML。
