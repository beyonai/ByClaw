# 用户头像上传

`POST /system/user/uploadAvatar` 接收 `multipart/form-data`，文件字段名为 `file`。接口从登录态获取用户身份，将图片保存为当前用户的头像，再返回头像 URL。无需传入用户 ID 或再调用用户资料更新接口。

支持的文件 MIME 类型为 `image/png`、`image/jpeg`、`image/gif`、`image/webp`，大小不超过 5 MB。允许中文文件名，后端生成唯一对象名。

文件复用数字员工图标的存储逻辑，存放于 `byai-icon` bucket。上传成功后，接口更新 `po_users.thumbnail_uri` 和 `update_date`，数据库更新成功才返回标准 `ResponseUtil`：

```json
{
  "code": 0,
  "msg": "Operation successful",
  "data": "/commonFile/preview?style=minio&bucketName=byai-icon&filePath=/userCode/20260922130000/unique-id.png"
}
```

`data` 为相对后端服务的预览 URL；部署存在统一 API 前缀时，由调用方按现有数字员工头像的方式补齐。`Users.avatar` 通过 `@TableField("thumbnail_uri")` 映射现有数据库列；当前用户信息接口返回 `avatar`，刷新页面时可读取已保存的头像。

未登录、用户不存在或禁用、空文件、类型不支持、文件过大、存储或数据库更新失败时，接口返回错误，不返回成功 URL。沿用现有异常处理和登录鉴权。缺少 `file` 参数由 Spring MVC 拒绝。

原 `/commonFile/uploadUserAvatar` 已移除。数字员工的 `/commonFile/uploadIcon` 保持原有用途。
