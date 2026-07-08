# 视频会议 / 妙记

用于已结束会议、会议记录、会议纪要、妙记、逐字稿、录制文件和会议 AI 产物。

## 路由边界

- 未来会议/日程安排：`calendar`。
- 已结束会议、即时会议、会议记录：`vc`。
- 已有 `minute_token`、妙记 URL、本地音视频转纪要：`minutes`。
- 文档正文中的纪要文档内容：拿到 token 后可用 `docs` 读取。

## 常用命令

```bash
# 搜索历史会议
lark-cli vc +search --query "周会" --start 2026-07-01 --end 2026-07-07 --as user --format json

# 获取会议详情，包含 note_id / minute_token 等
lark-cli vc +detail --meeting-ids <meeting_id> --as user --format json

# 查询妙记详情和产物
lark-cli minutes +detail --minute-tokens <minute_token> --transcript --as user --format json

# 搜索妙记
lark-cli minutes +search --query "周会" --as user --format json
```

## 产物选择

| 用户意图 | 优先产物 |
|----------|----------|
| 只要链接/基础信息 | `vc +detail` / `minutes minutes get` |
| 总结/复盘/分析会议 | 原始逐字稿或 transcript，再独立总结 |
| 查看 AI 总结/待办/章节 | `minutes +detail` 对应产物或 note 文档 |
| 谁说了什么 | 逐字稿 / transcript |
| 本地音视频转纪要 | `drive +upload` -> `minutes +upload` -> `minutes +detail` |

不要在用户要求重新总结时直接搬运 AI 总结。

## 妙记待办

用户说"在妙记里添加/修改/删除待办"时，用 `minutes +todo`，不是 `task`。

## 注意事项

- 会议标题可能重复；多候选时展示时间、组织者、参会人让用户选择。
- 会议产物可能不存在；如无录制/无纪要，直接说明，不要编造 token。
