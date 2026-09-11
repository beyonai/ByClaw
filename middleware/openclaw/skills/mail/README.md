# Mail runtime: 浩鲸邮箱网页账号

浩鲸邮箱使用 `node /app/skills/mail/scripts/iwhalecloud-mail.mjs`。QQ/163/Gmail 等原有投影账号仍使用 `mailctl.py`。本文件说明网页分支的运维与验证方式。

## 用户流程

1. 发布账号模板迁移后，账号列表通过既有模板服务补齐“浩鲸邮箱”。已有及已删除的同模板账号不重复创建。
2. 用户在“浩鲸邮箱”账号的浏览器打开 https://mail.iwhalecloud.com/ 完成登录。连接器是登录入口，不保存密码或导出 Cookie，也不自动证明网页已登录。
3. 用户提出邮件任务；mail 必须在同一用户、对应账号的沙箱浏览器中运行。多个浏览器/账号有歧义时先明确，不能把当前任意浏览器当成指定身份。
4. mail 调用 `check`；wrapper 调用既有 bycli bridge bootstrap，成功后执行最小 list。空邮箱成功，登录失效返回 AUTH_REQUIRED。check 不返回邮件详情或声称验证邮箱地址。
5. `list` 返回邮件摘要与稳定 emailId，`read` 获取完整正文且不标记已读。日期/关键词筛选基于有界扫描，明确记录范围；不宣称具备全邮箱服务端搜索。
6. 用户要求附件时先读取附件 ID，再逐个下载至同一个私有会话目录。单附件 25 MiB、会话累计 100 MiB；附件仅 FileAttachment，禁止 all；成功结果保留，失败项分别报告。下载后不得执行文件。
7. 未来 knowledge-collection 将消费 mail 的结构化结果，生成可追溯 Markdown 与本地附件，本轮没有注册该采集来源或执行命令。

## 结果与限制

结果包含 schemaVersion=1、source=iwhalecloud-mail、sourceSkill=mail、backend=bycli、operation、status、items、coverage。identityVerified=false 表示 bycli 尚不提供 whoami，不得据此验证指定邮箱所有权。

list 的 coverage 包含 returnedCount、offset、nextOffset、endObserved；complete 和 snapshotConsistent 固定为 false，因为邮箱无快照游标。bodyType=text/html，正文 full-text 仅用于通过完整度校验的 read。HTML 是原始不可信内容，调用方禁止执行脚本或加载远程资源。

read-only 命令为 check/list/read/download。search/send/reply/delete 返回 UNSUPPORTED。错误仅输出稳定代码与安全提示，不透传 bycli stderr 或错误 cause。上层不重复执行 bridge 恢复。

下载必须使用既有 `/by/.sessions/<session-id>` 或 `/by/workspace/<task>` 的真实目录，拒绝符号链接路径。文件先放进 0700 staging，完成验证后排他发布到 `mail-attachments/`，不覆盖旧文件；保存过程每 25ms 监督磁盘用量，超限终止进程组，结束后再次校验。监督属于采样限额，瞬时写入可能短暂超出预算，不等于文件系统硬配额。异常退出的残留 `.mail-download.lock` 会阻止新的下载；运维确认无活跃进程后方可清理本次残留，不能自动抢占未知持有者的锁。

## 镜像与发布

本次仅维护 `middleware/openclaw/Dockerfile`，按用户要求不修改 `Dockerfile.byclaw`。核对实际流水线所用配方及 build-arg 覆盖值。bycli 2.1.61 已包含 iwhalecloud list/read/download。发布需同时更新技能和 bycli/browser-extension 配套产物，已有沙箱必须按部署流程替换后才运行新代码；仅更新 BE 不生效。

本次无线上部署或真实邮箱登录验证。账号模板幂等 DML 已加入用户指定的 `deploy/migrations/versions/V0.5.0/V0.5.0__dml.sql`，未执行到线上或合并初始化 SQL。

## 验证

```sh
node --test middleware/openclaw/skills/mail/scripts/iwhalecloud-mail.test.mjs
python3 -m unittest discover -s middleware/openclaw/skills/mail/tests -p 'test_*.py'
python3 -m unittest discover -s middleware/openclaw/tests -p 'test_mail_skill.py'
```

登录态验收在用户明确选择的测试账号浏览器中完成：check、list、read 和单个测试附件下载；确认收件箱未读状态未被改变，并测试登录过期错误。不要把 Cookie、canary 或邮箱正文放进调试日志。
