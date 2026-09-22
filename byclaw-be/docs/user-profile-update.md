# Update current user profile

`POST /system/user/updateProfile` accepts `multipart/form-data` with required `userName`, optional `avatar` string, and optional `avatarFile` image file. Authentication determines the user; the request has no user ID. The username uses the existing user rules: 2–20 Chinese characters, Latin letters, or digits.

```text
userName: 张三
avatar: /commonFile/preview?style=minio&bucketName=byai-icon&filePath=/user/avatar.png
avatarFile: <optional image file>
```

The `avatar` can be the URL returned by `POST /system/user/uploadAvatar`. When `avatarFile` has content, it is uploaded using the same image rules as `/system/user/uploadAvatar`, and its URL takes precedence over `avatar`. An empty `avatarFile` is treated as absent. If both avatar inputs are omitted or blank, the saved avatar remains unchanged. A supplied avatar string must be at most 400 characters. The response `data` contains the saved `userName` and `avatar`. The endpoint updates only the authenticated user's `user_name`, optional `thumbnail_uri`, and `update_date` columns. It does not accept organization or role changes.
