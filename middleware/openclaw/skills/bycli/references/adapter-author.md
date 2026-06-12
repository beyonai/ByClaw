# Adapter Author — 从零编写 byCLI 适配器

目标：**从零到通过 `bycli browser verify` 的 30 分钟内闭环**。

全程用现有工具：`bycli browser *` / `bycli doctor` / `bycli browser init` / `bycli browser verify`。

调试浏览器型 adapter 时，优先带上 `--trace on --keep-tab true --window foreground`。

---

## 前置：看你落在哪

先用 [coverage-matrix.md](./coverage-matrix.md) 自测三个问题：

1. 数据在浏览器里看得到吗？（否 → 先解决鉴权）
2. 数据是 HTTP/JSON/HTML 吗？（否 → 不在范围内）
3. 需要实时推送吗？（是 → 找 HTTP 轮询接口；没有就放弃）

三个都 yes → 继续。

---

## 顶层决策树

```
START
  │
  ▼
┌──────────────────────────┐
│ bycli doctor 通？      │── no ──→ 修桥接（doctor 输出提示）
└──────────────────────────┘
  │ yes
  ▼
┌────────────────────────────────────────────────────┐
│ 读站点记忆：                                        │
│   1. ~/.bycli/sites/<site>/endpoints.json         │
│   2. ~/.bycli/sites/<site>/notes.md               │
│   3. references/site-memory/<site>.md               │
└────────────────────────────────────────────────────┘
  │ 命中 endpoint → 跳到【endpoint 验证】（memory 可能过期）
  │ 没命中 → 继续
  ▼
┌──────────────────────────┐
│ 站点侦察（site-recon）    │  → Pattern A/B/C/D/E
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ API 发现（api-discovery）│  §1 network → §2 state → §3 bundle → §4 token → §5 intercept
└──────────────────────────┘
  │ 拿到候选 endpoint
  ▼
┌────────────────────────────────────────────┐
│ 直接 fetch 验证 endpoint                   │── 401/403 → 回 §4
│ 数据非空 + 200                             │── 空/HTML → 回 site-recon
└────────────────────────────────────────────┘
  │ OK
  ▼
┌───────────────────────────────────────┐
│ 字段解码                               │  自解释→直接 / 已知代号→field-conventions / 未知→decode-playbook
└───────────────────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ 设计 columns (output)    │  对照 output-design.md
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ bycli browser init      │  生成骨架 → 复制最像的邻居 → 改三处
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ bycli browser verify    │── 失败 → autofix 流程
└──────────────────────────┘
  │ 成功
  ▼
┌──────────────────────────┐
│ 字段 vs 网页肉眼对一遍   │── 不对 → 回字段解码
└──────────────────────────┘
  │ 对得上
  ▼
┌──────────────────────────┐
│ 回写站点记忆              │  endpoints / field-map / notes / fixtures
└──────────────────────────┘
  │
  ▼
DONE
```

---

## Runbook（勾选式）

```
[ ] 1. bycli doctor 返回 "Everything looks good"
[ ] 2. 读站点记忆：
       [ ] ~/.bycli/sites/<site>/endpoints.json 存在？
       [ ] references/site-memory/<site>.md 存在？
       [ ] 命中后：跳到第 5（endpoint 验证）+ 第 7（字段核对）
       [ ] memory 超 30 天（看 verified_at）→ 按冷启动走
[ ] 3. 侦察（site-recon.md）：
       [ ] 首选：`bycli browser analyze <url>` 一步拿结论
       [ ] 结论模糊时手跑：open → wait → network
       [ ] 定 Pattern（A/B/C/D/E）
[ ] 4. API 发现（api-discovery.md）按 Pattern 选 §
[ ] 5. 直接 fetch 验证 endpoint：200 + 含目标数据
[ ] 6. 定鉴权策略：PUBLIC / COOKIE / INTERCEPT / UI
[ ] 7. 字段解码：自解释→直接 / 已知→field-conventions / 未知→decode-playbook
[ ] 8. 设计 columns（output-design.md）：camelCase、类型、顺序
[ ] 9. 写 adapter：
       [ ] bycli browser init <site>/<name>
       [ ] 找最像的邻居 adapter 复制
       [ ] 改 name / URL / 字段映射
[ ] 10. bycli browser verify：
        [ ] 首轮通过后 --write-fixture 生成种子
        [ ] 加 patterns + notEmpty + 收紧 rowCount
        [ ] 再跑一次确认
[ ] 11. 字段值 vs 网页肉眼比对
[ ] 12. 回写站点记忆（schema 见 site-memory.md）：
        [ ] endpoints.json
        [ ] field-map.json（已有 key 不覆盖）
        [ ] notes.md（顶部追加）
        [ ] verify/<cmd>.json
        [ ] fixtures/<cmd>-<YYYYMMDDHHMM>.json（去敏感字段）
        [ ] 清理临时 dump 文件
```

---

## 降级路径

| 卡在 | 现象 | 跳去 |
|------|------|------|
| Step 4 | network 空，`__INITIAL_STATE__` 也空 | §3 bundle 搜 baseURL |
| Step 4 | bundle 搜不到 | §5 intercept |
| Step 5 | 401/403 | §4 token 排查 |
| Step 5 | 200 但 HTML | 回 Step 3 换 Pattern |
| Step 5 | 200 但 `data: []` | 参数错 / 接口换版，回 §1 |
| Step 7 | 排序键推不出 | decode-playbook §3 |
| Step 10 | verify 失败 | autofix 流程 + `--trace retain-on-failure` |
| Step 11 | 数值差 10000 倍 | 单位不统一（"万" vs "元"） |

---

## 关键约定

- Adapter 只引 `@sovovs/bycli/registry` + `@sovovs/bycli/errors`
- `columns` 与 `func` 返回 keys 完全对齐（含顺序）
- 中间解析对象 key 不能跟 `columns` 重叠
- `browser: false → (args)`，`browser: true → (page, args)` — 搞反时参数 silent fallback
- 已知失败按 [typed-errors.md](./typed-errors.md) 抛 typed error；禁止 silent `return []`
- 私人 adapter：`~/.bycli/clis/<site>/<name>.js`（免 build）
- 提 PR：copy 到 `clis/<site>/<name>.js`
- 站点记忆每轮回写
- 调试 dump 只落在 `~/.bycli/sites/<site>/fixtures/` 或 `/tmp/`

---

## 参考文件索引

| 文件 | 何时翻 |
|------|--------|
| [coverage-matrix.md](./coverage-matrix.md) | 动手前可行性自测 |
| [site-recon.md](./site-recon.md) | Step 3 定站点类型 |
| [api-discovery.md](./api-discovery.md) | Step 4 找 endpoint |
| [field-conventions.md](./field-conventions.md) | Step 7 查已知代号 |
| [field-decode-playbook.md](./field-decode-playbook.md) | 字段不在词典时 |
| [output-design.md](./output-design.md) | Step 8 columns 规范 |
| [adapter-template.md](./adapter-template.md) | Step 9 文件结构 |
| [site-memory.md](./site-memory.md) | 站点记忆两层结构 |
| [success-rate-pitfalls.md](./success-rate-pitfalls.md) | 静默失败陷阱 |
| [jsdom-fixture-pattern.md](./jsdom-fixture-pattern.md) | JSDOM 测试模式 |
| [typed-errors.md](./typed-errors.md) | 5 类 typed error |

---

## 卡住了

- 诊断类：`bycli doctor` → 看 `notes.md` → 搜 autofix 流程
- 字段解码类：`field-decode-playbook.md` 全三节走完 → 先输出 raw 迭代
- Endpoint 找不到：api-discovery §5 intercept 兜底

不要猜。猜错了 verify 能通过但数据是错的。