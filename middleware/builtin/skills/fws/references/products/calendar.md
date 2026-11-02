# 日历

用于查看日程、创建/更新会议、管理参会人、查询忙闲、推荐时间和预定会议室。

## 身份选择

日历是用户个人资源，默认显式使用 `--as user`。`--as bot` 只能访问 bot 自己的日历，查用户日程通常会返回空。

## 常用命令

```bash
# 查看近期日程
lark-cli calendar +agenda --start 2026-07-07 --end 2026-07-08 --as user --format json

# 按关键词搜索日程
lark-cli calendar +search-event --query "周会" --start 2026-07-01 --end 2026-07-31 --as user --format json

# 创建日程
lark-cli calendar +create --summary "项目沟通" \
  --start "2026-07-08T14:00:00+08:00" \
  --end "2026-07-08T15:00:00+08:00" \
  --attendee-ids <ou_open_id> \
  --as user --format json

# 查询忙闲
lark-cli calendar +freebusy --user-id <ou_open_id> --start "2026-07-08T09:00:00+08:00" --end "2026-07-08T18:00:00+08:00" --as user --format json
```

## 路由规则

- "今天/明天/下周有哪些会议"：未来或当天未开始的会议用 `calendar`。
- "昨天的会议记录/纪要/逐字稿"：切 `vc`。
- "预约会议室"：先确定时间块；时间模糊时先推荐时间，再查会议室。
- "改这个会议时间/加参会人/移除会议室"：先定位既有 `event_id`，不要新建。

## 时间规则

- 使用 ISO-8601，带时区：`2026-07-08T14:00:00+08:00`。
- 用户说"今天/明天"等相对日期时，基于当前真实日期计算，并在回复中使用明确日期。
- 不能预约已经完全过去的时间。

## 危险操作

删除日程、移除参会人/会议室、改期会影响所有参会人；执行前确认。
