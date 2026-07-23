# 技能超市绑定接口接入说明

本文档供技能超市（对端智能体）接入百应门户的技能安装与数字员工绑定接口使用。

## 1. 接口概览

| 项目 | 内容 |
| --- | --- |
| 接口名称 | 第三方技能安装与数字员工绑定 |
| Method | `POST` |
| Path | `/byaiService/tool/installThirdPartySkill` |
| Content-Type | `application/json; charset=UTF-8` |
| 用户认证 | 请求头 `Beyond-Token` |
| 系统来源 | 请求头 `System-Code: BYAI` |
| 下载协议 | 支持 HTTP 和 HTTPS |

门户和技能超市属于同一可信安全域。门户把当前登录用户的 `Beyond-Token` 传给技能超市；技能超市调用绑定接口时，必须把它原样放在 HTTP Header 中。门户以 Token 解析出的登录用户作为唯一可信身份。

完整请求地址示例：

```text
http://portal.internal.example/byaiService/tool/installThirdPartySkill
```

## 2. iframe URL 对接说明

### 2.1 地址与参数

技能超市页面地址由对端提供，并按门户所在的开发、测试或生产环境分别配置在
`byai.byai_system_config` 表中：

| 字段 | 配置值 |
| --- | --- |
| `param_code` | `WHALE_AGENT_SKILL_MARKET_URL` |
| `param_value` | 当前环境的技能超市完整页面地址，包含原页面参数，例如 `https://www.iwhaleai.com/skillHub/dashboard?tab=skills` |

以下使用对端阿里云页面地址举例：

```text
https://www.iwhaleai.com/skillHub/dashboard?tab=skills&digId=10029822&BeyondToken=<URL编码后的Token>&parentOrigin=https%3A%2F%2Fportal.example.com
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `digId` | 是 | 当前数字员工资源 ID |
| `BeyondToken` | 是 | 门户当前登录用户的 `Beyond-Token` |
| `parentOrigin` | 是 | 门户页面 Origin，用于安装成功后的 `postMessage` 通知 |

拼接规则：

- 技能超市页面地址取 `WHALE_AGENT_SKILL_MARKET_URL` 的配置值，地址中包含协议、域名、页面路径及对端原有参数。
- `https://www.iwhaleai.com/skillHub/dashboard` 仅作为对端阿里云页面地址示例，各环境使用对应的配置值。
- `tab=skills` 是示例原地址的一部分，门户不生成或修改该参数。
- `digId` 取门户当前正在操作的数字员工 ID。
- `BeyondToken` 取门户当前登录用户的 `Beyond-Token`。
- `parentOrigin` 取门户页面的 `window.location.origin`，只包含协议、域名和端口。
- 必须使用 `URL`/`URLSearchParams` 拼接参数，不能直接使用字符串连接 Token。

例如，门户地址为 `https://portal.example.com`，当前数字员工 ID 为 `10029822`，则最终 iframe URL 形式为：

```text
https://www.iwhaleai.com/skillHub/dashboard?tab=skills&digId=10029822&BeyondToken=eyJhbGciOiJSUzI1NiJ9.example.signature&parentOrigin=https%3A%2F%2Fportal.example.com
```

示例 Token 仅用于展示参数位置，不是真实有效凭证。

### 2.2 门户侧生成与嵌入示例

门户侧应从当前环境配置中取得技能超市页面地址，再生成 iframe URL：

```typescript
import { getToken } from '@/utils/auth';

function buildSkillMarketplaceUrl(skillMarketplacePageUrl: string, digId: string | number) {
  const url = new URL(skillMarketplacePageUrl);
  url.searchParams.set('digId', String(digId));
  url.searchParams.set('BeyondToken', getToken());
  url.searchParams.set('parentOrigin', window.location.origin);
  return url.toString();
}
```

iframe 嵌入示例：

```tsx
<iframe
  title="技能超市"
  src={buildSkillMarketplaceUrl(runtimeConfig.skillMarketplacePageUrl, currentDigitalEmployeeId)}
  allow="fullscreen"
  referrerPolicy="no-referrer"
/>
```

门户切换当前数字员工或登录 Token 发生变化时，应重新生成 `src`，确保 iframe 中的 `digId` 和 `BeyondToken` 与当前门户上下文一致。

### 2.3 对端读取参数

对端页面读取 `BeyondToken` 后应遵守以下要求：

- 仅保存在当前页面内存中，不写入 `localStorage`、`sessionStorage`、Cookie 或数据库。
- 不在控制台、访问日志、错误日志、链路标签或埋点中打印 Token。
- 调用门户接口时放在 `Beyond-Token` Header，不能放在安装接口的 URL 或 JSON 请求体中。
- 建议读取后通过 `history.replaceState` 从浏览器地址栏中删除 `BeyondToken` 参数，内存中继续保留其值。
- 收到 HTTP `401` 时停止重试，提示用户刷新门户登录状态并重新进入技能超市。

删除地址栏 Token 的前端示例：

```javascript
const currentUrl = new URL(window.location.href);
const beyondToken = currentUrl.searchParams.get('BeyondToken') || '';
const digId = currentUrl.searchParams.get('digId') || '';
const parentOrigin = currentUrl.searchParams.get('parentOrigin') || '';

currentUrl.searchParams.delete('BeyondToken');
window.history.replaceState(null, '', currentUrl.toString());
```

## 3. 安装请求

### 3.1 Header

```http
Content-Type: application/json; charset=UTF-8
System-Code: BYAI
Beyond-Token: <iframe参数中的BeyondToken>
```

`Beyond-Token` 和 HTTP Header 名称不区分大小写，但建议按本文格式传递。

### 3.2 JSON 请求体

```json
{
  "digId": 10029822,
  "downloadUrl": "http://skill-files.internal.example/subtitle-generator.zip"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `digId` | long | 是 | 需要绑定技能的数字员工资源 ID，应与 iframe 中的 `digId` 一致 |
| `downloadUrl` | string | 是 | 技能 ZIP 下载地址，支持 HTTP 和 HTTPS |

请求约束：

- `downloadUrl` 必须可由门户后端直接访问。
- 技能包不能超过 50 MB，并且必须是门户能够识别的合法技能 ZIP。
- Token 对应用户必须仍然有效，并拥有目标数字员工的管理权限。
- 覆盖已有技能时，Token 对应用户还必须拥有该技能的管理权限。
- 对端不得接受用户手工输入或其他页面传入的 `digId`、`Beyond-Token` 替换 iframe 原始参数。

## 4. curl 联调示例

```bash
curl --request POST 'https://portal.example.com/byaiService/tool/installThirdPartySkill' \
  --header 'Content-Type: application/json; charset=UTF-8' \
  --header 'System-Code: BYAI' \
  --header 'Beyond-Token: <从iframe地址取得的当前门户登录Token>' \
  --data-raw '{
    "digId": 10029822,
    "downloadUrl": "http://skill-files.internal.example/subtitle-generator.zip"
  }'
```

内部可信网络可以使用 HTTP 调用门户接口；跨网络调用仍建议使用 HTTPS，避免 Token 在传输途中被截获。

## 5. JavaScript 调用示例

```javascript
export async function installSkill({ portalOrigin, beyondToken, digId, downloadUrl }) {
  const response = await fetch(`${portalOrigin}/byaiService/tool/installThirdPartySkill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'System-Code': 'BYAI',
      'Beyond-Token': beyondToken,
    },
    body: JSON.stringify({
      digId: Number(digId),
      downloadUrl,
    }),
  });

  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new Error(result.msg || result.resultMsg || `技能安装失败（HTTP ${response.status}）`);
  }
  return result.data;
}
```

如果由对端后端转发请求，对端前端应把当前 iframe 会话中的 Token 安全地交给对端后端；对端后端再将其原样写入门户请求的 `Beyond-Token` Header，不得记录或长期保存。

## 6. 门户鉴权与业务处理

门户收到请求后按以下顺序处理：

1. `AccessTokenVerifyInterceptor` 从 `Beyond-Token` Header 读取 Token。
2. 校验 JWT 签名和过期时间。
3. 根据 Token 中的用户信息建立 `CurrentUserHolder` 登录上下文；请求体中的业务参数不能覆盖该身份。
4. 校验 `digId` 对应数字员工存在，并校验当前用户具有管理权限。
5. 下载并检查技能 ZIP。
6. 写入或覆盖资源表、技能扩展表，并上传到当前 Token 用户对应的 Hub。
7. 绑定技能与当前数字员工。
8. 重建数字员工关联技能缓存，并发布数字员工更新事件。

`userCode` 由门户从 `Beyond-Token` 中解析，并用于后续用户权限上下文和 Hub 路径处理。

### 6.1 调用日志

门户分别记录接口调用开始、安装成功、业务失败和系统异常日志。日志包含用户编码、数字员工 ID、
新增或覆盖类型、资源 ID/编码/名称、技能版本、Hub 路径、技能包大小、下载地址摘要、下载地址哈希及耗时。
下载地址摘要不包含账号信息、查询参数和 fragment，日志中不会记录 `Beyond-Token`。

## 7. 新增与覆盖规则

门户根据以下组合定位技能：

```text
systemCode=WHALE_AGENT
resourceBizType=SKILL
resourceCode=SHA-256(trim(downloadUrl))
```

- 没有找到时新增技能。
- 找到已有资源时覆盖更新。
- 相同 `downloadUrl` 会定位到同一资源；URL 任一部分发生变化，都可能被识别为不同资源。

对端应尽量提供稳定的下载地址。

## 8. 响应说明

### 8.1 新增成功

```json
{
  "code": 0,
  "msg": "第三方技能安装成功",
  "data": {
    "total": 1,
    "success": 1,
    "failed": 0,
    "createdCount": 1,
    "updatedCount": 0,
    "createdItems": [
      {
        "resourceCode": "<下载地址的SHA-256值>",
        "resourceName": "subtitle-generator",
        "resourceBizType": "SKILL",
        "resourceId": "7301",
        "updated": false,
        "success": true
      }
    ]
  }
}
```

### 8.2 覆盖成功

```json
{
  "code": 0,
  "msg": "第三方技能安装成功",
  "data": {
    "createdCount": 0,
    "updatedCount": 1,
    "createdItems": [],
    "updatedItems": [
      {
        "updated": true,
        "success": true
      }
    ]
  }
}
```

### 8.3 Token 无效或过期

Token 校验发生在 Controller 之前，HTTP 状态码为 `401`，响应格式可能是：

```json
{
  "resultCode": 401,
  "resultMsg": "Token已失效或已过期",
  "type": 1
}
```

### 8.4 业务校验失败

```json
{
  "code": -1,
  "msg": "具体失败原因",
  "data": null
}
```

对端必须同时检查 HTTP 状态码和响应 JSON 中的 `code`；仅当 HTTP 为 2xx 且 `code=0` 时才视为安装成功。

## 9. 安装成功后刷新门户技能左边栏

安装接口成功后，iframe 页面向门户发送：

```javascript
window.parent.postMessage(
  {
    type: 'BYCLAW_SKILL_INSTALLED',
    digId: String(digId),
  },
  parentOrigin,
);
```

其中 `parentOrigin` 取 iframe URL 中的同名参数，禁止使用 `'*'`。

消息只需要以下字段：

| 字段 | 说明 |
| --- | --- |
| `type` | 固定为 `BYCLAW_SKILL_INSTALLED` |
| `digId` | 本次安装绑定的数字员工 ID |

消息体限定为 `type` 和 `digId` 两个字段。门户会校验消息来源、iframe 窗口和当前数字员工 ID，然后重新查询当前数字员工关联的全部技能并刷新整个技能左边栏。

## 10. 安全要求

- 当前方案以门户和技能超市属于同一可信安全域为前提。
- `Beyond-Token` 只能用于当前用户主动打开的技能超市页面和本接口调用。
- 禁止记录、持久化、转发给其他系统或用于调用无关门户接口。
- iframe 和对端页面不得加载会收集完整页面 URL 的第三方统计脚本。
- 门户 iframe 已设置 `referrerPolicy="no-referrer"`；对端仍应及时从地址栏删除 Token。
- 对端必须限制允许发起门户安装请求的页面来源和服务端调用路径。
- HTTP 仅用于受控内部网络；公网或跨安全域传输必须使用 HTTPS。
