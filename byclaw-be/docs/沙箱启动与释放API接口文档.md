# 1.按用户启动沙箱

按用户工号启动个人沙箱。

## 1.1接口说明

该接口按工号为指定用户启动个人沙箱，可选传入 `serviceKey` 指定沙箱规格。同一用户、同一沙箱类型下若已有运行中且访问地址不为空的实例，直接返回该实例，不重复创建。

`serviceKey` 省略或为空时，优先使用该用户已保存的首选规格；没有首选规格时使用 `openclaw`。显式传入非 `openclaw` 的规格会保存为该用户的首选规格。显式传入 `openclaw` 会清除首选规格，并释放该首选规格下启动中或运行中的个人实例。

`serviceKey` 以 `openclaw-` 开头时，沙箱类型为 `openclaw`，横线后的部分为规格档。`byclaw-code-agent` 使用独立资源键。`owner_scope` 为 `TENANT` 的规格，以及 `tenant-opengauss`、`tenant-data-node`，不能通过本接口启动。

缺少 `userCode` 时返回失败，`msg` 为 `userCode is required`。启动失败时 `msg` 为 `沙箱启动失败` 或 `沙箱启动失败: <原因>`，例如沙箱正在创建中、运行实例达到上限、传入了租户规格。

## 1.2请求路径(POST)

```
/byaiService/sandbox/launchByUserCode
```

## 1.3请求

**请求参数说明**

| 参数名称 | 参数类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| userCode | String | 是 | 目标用户工号 |
| serviceKey | String | 否 | 沙箱规格键，对应 `sandbox_service_spec.service_key`。省略时使用首选规格，没有首选规格时为 `openclaw` |

## 1.4请求示例

```json
{
    "userCode": "0027021534",
    "serviceKey": "openclaw"
}
```

## 1.5响应

**响应参数说明**

| 参数名称 | 参数类型 | 说明 |
| --- | --- | --- |
| code | Integer | 响应码，0表示成功，-1表示失败 |
| success | Boolean | 是否成功 |
| msg | String | 响应消息，成功时为 `Operation successful` |
| data | SandboxLaunchResult | 启动结果。失败时为空 |

**SandboxLaunchResult对象说明**

| 参数名称 | 参数类型 | 说明 |
| --- | --- | --- |
| endpoint | String | 主访问地址 |
| sandboxId | String | 沙箱实例ID |
| endpoints | List&lt;String&gt; | 访问地址列表，当前仅包含主访问地址 |
| instanceEndpoints | Map&lt;String, String&gt; | 按镜像内逻辑实例名索引的访问地址 |

## 1.6响应示例

```json
{
    "code": 0,
    "data": {
        "endpoint": "http://alb-5wrz1941z61urx2uha.cn-beijing.alb.aliyuncsslb.com/kruise/byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5/8080/chat?token=<TOKEN>",
        "endpoints": [
            "http://alb-5wrz1941z61urx2uha.cn-beijing.alb.aliyuncsslb.com/kruise/byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5/8080/chat?token=<TOKEN>"
        ],
        "instanceEndpoints": {
            "openclaw": "http://alb-5wrz1941z61urx2uha.cn-beijing.alb.aliyuncsslb.com/kruise/byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5/8080/chat?token=<TOKEN>",
            "vnc": "http://alb-5wrz1941z61urx2uha.cn-beijing.alb.aliyuncsslb.com/kruise/byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5/8081/?token=<TOKEN>",
            "bycli": "http://alb-5wrz1941z61urx2uha.cn-beijing.alb.aliyuncsslb.com/kruise/byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5/19825/?token=<TOKEN>"
        },
        "sandboxId": "byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5"
    },
    "msg": "Operation successful",
    "success": true
}
```

---

# 2.按记录释放沙箱

按沙箱记录 ID 或运行中的沙箱实例 ID 释放个人沙箱。

## 2.1接口说明

该接口用于管理端释放一条个人沙箱。传入 `id` 时直接按记录 ID 释放；未传 `id`、只传 `sandboxId` 时，查询状态为 `RUNNING` 的个人沙箱记录，取得其 `id` 后按记录 ID 释放。两者都传时优先使用 `id`。按 `id` 释放时，记录状态为 `STARTING` 则直接把本地记录标为已释放；状态为 `RUNNING` 时，销毁远端实例后再把本地记录标为已释放。远端销毁失败仍会完成本地释放。`RELEASING`、`RELEASED`、`FAILED` 等其他状态不重复操作，接口仍返回成功。

平台管理员可释放任意个人沙箱。企业管理员只能释放本企业的个人沙箱。其他用户返回 HTTP 403，`msg` 为「无权访问该企业」。租户沙箱不能通过本接口释放，`msg` 为「租户沙箱只能由租户开通流程管理」。

同时缺少 `id` 和 `sandboxId` 时 `msg` 为 `id or sandboxId is required`。`id` 不是数字时 `msg` 为 `id must be a valid number`。根据 `sandboxId` 查不到运行中记录时 `msg` 为 `running sandbox record not found`；根据 `id` 查不到记录时 `msg` 为 `sandbox record not found`。

## 2.2请求路径(POST)

```
/byaiService/sandbox/removeSandboxById
```

## 2.3请求

**请求参数说明**

| 参数名称 | 参数类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| id | Long | 二选一 | 沙箱记录ID，对应 `ss_sandbox_record.id` |
| sandboxId | String | 二选一 | 沙箱实例ID，与启动接口返回的 `sandboxId` 一致；只查询运行中的个人沙箱 |

## 2.4请求示例

```json
{
    "sandboxId": "byclaw-sandbox--byclaw-1832c0535c1d0302b8425c73ab92c6d5"
}
```

## 2.5响应

**响应参数说明**

| 参数名称 | 参数类型 | 说明 |
| --- | --- | --- |
| code | Integer | 响应码，0表示成功，-1表示失败 |
| success | Boolean | 是否成功 |
| msg | String | 响应消息，成功时为 `Operation successful` |
| data | Object | 成功时为空 |

## 2.6响应示例

```json
{
    "code": 0,
    "data": null,
    "msg": "Operation successful",
    "success": true
}
```
