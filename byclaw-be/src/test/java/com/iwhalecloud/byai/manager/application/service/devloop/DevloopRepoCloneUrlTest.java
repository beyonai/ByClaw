package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 代码平台 clone 地址与安全凭据提示。 */
class DevloopRepoCloneUrlTest {

    @Test
    @DisplayName("github: 保留标准 https 地址，由 Git credential helper 提供凭据")
    void keepsGithubHttpsUrlTokenFree() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("github", "https://github.com/acme/app.git"))
            .isEqualTo("https://github.com/acme/app.git");
    }

    @Test
    @DisplayName("gitlab: 用 oauth2:$GL_TOKEN@ 前缀")
    void tokenizesGitlabUrl() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("gitlab", "https://gitlab.example.com/g/app.git"))
            .isEqualTo("https://oauth2:$GL_TOKEN@gitlab.example.com/g/app.git");
    }

    @Test
    @DisplayName("gitea: 用 $GITEA_TOKEN@ 前缀")
    void tokenizesGiteaUrl() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("gitea", "https://gitea.com/acme/app.git"))
            .isEqualTo("https://$GITEA_TOKEN@gitea.com/acme/app.git");
    }

    @Test
    @DisplayName("github 显式地址不再改写或注入令牌")
    void keepsExplicitGithubUrl() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("github", "http://git.internal/acme/app.git"))
            .isEqualTo("http://git.internal/acme/app.git");
    }

    @Test
    @DisplayName("provider 为空或大写都落到 github 约定")
    void fallsBackToGithubSpec() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl(null, "https://github.com/acme/app.git"))
            .isEqualTo("https://github.com/acme/app.git");
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("GitLab", "https://gitlab.com/g/app.git"))
            .isEqualTo("https://oauth2:$GL_TOKEN@gitlab.com/g/app.git");
    }

    @Test
    @DisplayName("非 http(s) 地址原样返回，令牌注入对 SSH 无意义")
    void keepsNonHttpUrlUnchanged() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("github", "git@github.com:acme/app.git"))
            .isEqualTo("git@github.com:acme/app.git");
    }

    @Test
    @DisplayName("平台令牌变量名与域名约定")
    void exposesProviderConventions() {
        assertThat(DevloopApplicationService.repoProviderTokenEnv("gitlab")).isEqualTo("GL_TOKEN");
        assertThat(DevloopApplicationService.repoProviderTokenEnv("gitea")).isEqualTo("GITEA_TOKEN");
        assertThat(DevloopApplicationService.repoProviderTokenEnv(null)).isEqualTo("GH_TOKEN");
        assertThat(DevloopApplicationService.repoProviderHost("gitlab")).isEqualTo("gitlab.com");
        assertThat(DevloopApplicationService.repoProviderHost(null)).isEqualTo("github.com");
    }

    @Test
    @DisplayName("GitHub clone 提示使用标准地址和平台 credential helper")
    void buildRepoCloneHintHandlesExplicitUrl() {
        String hint = DevloopApplicationService.buildRepoCloneHint("github", "https://github.com/acme/app.git",
            "acme/app");
        assertThat(hint)
            .contains("git clone https://github.com/acme/app.git", "Git 凭据助手", "平台 GitHub 连接器")
            .doesNotContain("$GH_TOKEN", "https://GH_TOKEN@");
    }
}
