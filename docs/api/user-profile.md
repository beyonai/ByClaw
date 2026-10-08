# 当前用户个人资料（D0.5.0）

个人资料保存于 `byai.byai_customer_leads`。姓名、公司/组织复用已有 `contact_name`、`company_name`，岗位和兴趣使用新增 `profile_role`、`profile_interests`。额外新增可空 `user_id` 关联当前登录用户，并用唯一索引保证每位用户只有一条关联资料。

`po_users` 不新增字段。姓名在同一事务同步到其已有 `user_name`，头像继续使用已有 `thumbnail_uri`。自填组织和岗位不改变组织成员、岗位权限或企业归属，兴趣保存为 JSON 字符串数组，不复用行业或咨询问题字段。

## 接口

- `GET /byaiService/system/user/profile`：读取当前登录且启用用户的数据库资料。
- `POST /byaiService/system/user/updateProfile`：沿用 multipart/form-data，同一事务保存当前登录用户的资料。客户端不能指定其他用户 ID。

| 字段 | 更新请求 | 读取/更新响应 |
| --- | --- | --- |
| userName | 必填，2–20 位中文、英文字母、数字 | 字符串 |
| avatar / avatarFile | 沿用旧协议，文件优先；省略保留 | avatar 地址 |
| companyName | 可省略以兼容旧调用；提供时不能为空且不超过 100 字符 | 字符串或 null |
| profileRole | 选填岗位分类；省略保留，空字符串清空 | 字符串或 null |
| profileInterests | JSON 字符串数组；省略保留，`[]` 清空 | 字符串数组，历史空值返回 `[]` |

岗位：产品 / 设计、研发 / 测试、市场 / 运营、销售 / 商务、客户服务、管理 / 创业、教育 / 科研、其他。

兴趣：产品研发、内容创作、营销推广、数据分析、办公提效、教育学习、知识管理、其他。服务端拒绝未知选项或无效 JSON，同一兴趣去重。`profileRole` 不使用已有权限字段 `role`。

## 完善资料与兼容

新弹窗提交姓名、组织、选填岗位和兴趣，保存成功后更新前端当前用户状态。回读优先按当前登录用户 ID 查询关联线索；没有关联记录时，使用当前用户手机号查询最新的未关联历史留资。首次保存会创建关联记录，若使用历史资料则复制其原有行业、咨询问题等字段，保留历史记录原样；后续保存更新同一条关联记录，不改其行业和咨询问题。

用户行更新先取得事务锁，再读取和保存关联线索，串行化同一用户的并发提交。用户名更新与线索保存处于同一事务，线索失败时不更新登录快照。旧的只修改用户名/头像调用在无留资时不创建空白线索。旧留资 insertLead/insertBatch 不允许客户端指定 user_id；关联只能由当前用户资料接口创建。

登录及 currentUser 根据用户关联线索，或手机号对应的未关联历史线索判定 isRetented。无手机号的用户也可通过 user_id 保存和回读资料；历史留资判定继续兼容。

前端“个人资料”入口复用同一表单，打开时读取数据库；读取失败禁用保存并提供重试，防止空白表单覆盖资料。选填岗位可清空，兴趣可全部取消。

## 迁移与发布

增量 SQL 位于 `deploy/migrations/versions/V0.5.0/V0.5.0__ddl.sql` 的“完善个人资料”段。复用已有姓名、公司字段；为兼容 openGauss，使用普通 ALTER TABLE ADD COLUMN 添加线索表的 user_id/profile_role/profile_interests，并添加 user_id 唯一索引和列注释，不使用 SQL function，不回填或覆盖历史数据，不修改初始化 SQL 或 .applied。

发布顺序：执行新增 ALTER 与索引段，再部署后端与 Hacu 前端。如果环境已应用 V0.5.0，本次追加段仍需单独执行，不能仅依赖整版已应用标记。开发验证只运行迁移合并器 --dry-run，不执行数据库迁移。新增列和创建索引使用普通语法，不支持重复执行；执行前查询 information_schema.columns 与 pg_indexes，仅执行缺失字段的 ADD COLUMN 和缺失索引的 CREATE INDEX。H2 迁移测试用于验证字段新增与数据保留，正式目标数据库仍需发布验证。
