package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 带令牌 clone 地址拼接。回归重点:令牌前缀含 $,曾用 replaceFirst 实现,替换串里的 $GH_TOKEN
 * 被正则当成分组引用,集成测试 backend 直跑的 clone 步骤直接抛 IllegalArgumentException。
 */
class DevloopRepoCloneUrlTest {

    @Test
    @DisplayName("github: https 地址插入 $GH_TOKEN@ 前缀，不触发正则分组引用")
    void tokenizesGithubHttpsUrl() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("github", "https://github.com/acme/app.git"))
            .isEqualTo("https://$GH_TOKEN@github.com/acme/app.git");
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
    @DisplayName("http 自建实例升级为 https 并注入令牌")
    void upgradesHttpToHttps() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl("github", "http://git.internal/acme/app.git"))
            .isEqualTo("https://$GH_TOKEN@git.internal/acme/app.git");
    }

    @Test
    @DisplayName("provider 为空或大写都落到 github 约定")
    void fallsBackToGithubSpec() {
        assertThat(DevloopApplicationService.tokenizedRepoCloneUrl(null, "https://github.com/acme/app.git"))
            .isEqualTo("https://$GH_TOKEN@github.com/acme/app.git");
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
    @DisplayName("buildRepoCloneHint 对显式完整地址也不再抛分组引用异常")
    void buildRepoCloneHintHandlesExplicitUrl() {
        String hint = DevloopApplicationService.buildRepoCloneHint("github", "https://github.com/acme/app.git",
            "acme/app");
        assertThat(hint).contains("git clone https://$GH_TOKEN@github.com/acme/app.git").contains("GH_TOKEN");
    }
}
