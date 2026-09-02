# GitHub OAuth2 连接器

本目录实现 ByClaw 平台的 GitHub OAuth App 授权流程。这是平台级 OAuth App，不需要在每个研发项目或 GitHub 代码仓库中单独配置。

## GitHub OAuth App 注册

在 GitHub 的 **Settings > Developer settings > OAuth Apps > New OAuth App** 中注册。不同环境建议使用独立 OAuth App，因为一个 GitHub OAuth App 只有一个主回调地址。

### 本地环境

```text
Application name: ByClaw Local
Homepage URL: http://localhost:8000
Authorization callback URL: http://localhost:8000/byaiService/connector/authorization/callback/github-oauth2
```

### 非本地环境

```text
Application name: ByClaw <Environment>
Homepage URL: https://<your-public-domain>
Authorization callback URL: https://<your-public-domain>/byaiService/connector/authorization/callback/github-oauth2
```

生产环境建议使用 HTTPS 域名作为 Homepage URL 和 Authorization callback URL。

## OAuth App 选项

### Enable Device Flow

**不勾选。**

当前实现使用浏览器 Authorization Code + PKCE 流程，授权完成后回调 ByClaw 后端，没有使用 GitHub Device Flow。

### Expire user access tokens

**当前不勾选。**

当前代码能够解析并保存 GitHub 返回的 `refresh_token`，但还没有实现使用 `refresh_token` 自动换取新 `access_token` 的逻辑。如果现在勾选，用户的 access token 到期后连接器将无法继续访问 GitHub，需要用户重新授权。

后续完成 GitHub refresh token 自动续期、并发刷新和刷新失败重新授权机制后，再启用该选项。

## 部署配置

注册后把该环境对应的 Client ID、Client Secret 和回调地址注入 ByClaw 后端：

```env
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_REDIRECT_URI=
```

非本地环境的回调地址示例：

```env
GITHUB_OAUTH_REDIRECT_URI=https://<your-public-domain>/byaiService/connector/authorization/callback/github-oauth2
```

环境变量修改后必须重启后端服务。`GITHUB_OAUTH_CLIENT_SECRET` 不得写入数据库、提交到 Git，或输出到日志。

GitHub 连接器数据库配置只保存环境变量名，不保存真实密钥：

```json
{
  "clientIdEnv": "GITHUB_OAUTH_CLIENT_ID",
  "clientSecretEnv": "GITHUB_OAUTH_CLIENT_SECRET",
  "redirectUriEnv": "GITHUB_OAUTH_REDIRECT_URI",
  "scope": "read:user repo"
}
```

## 仓库访问范围

OAuth App 本身不绑定某个代码仓库。用户授权后，ByClaw 获得的是 GitHub OAuth access token，而不是用户手工创建的 PAT。它可访问的仓库由以下条件共同决定：

- 用户本身拥有的 GitHub 仓库权限。
- OAuth App 请求的 scope，当前为 `read:user repo`。
- GitHub Organization 的 OAuth App 访问策略和 SAML SSO 授权状态。

如果组织禁止未批准的 OAuth App，组织管理员还需要批准 ByClaw OAuth App；这不是逐仓库配置。

## 主要代码

- `GithubOAuth2AuthorizationProvider.java`：生成授权 URL、校验回调、保存用户凭据和撤销授权。
- `JdkGithubOAuth2Client.java`：调用 GitHub token、user 和 revoke API。
- `EnvironmentOAuth2ClientSecretResolver.java`：从后端运行环境读取 OAuth App 配置。
