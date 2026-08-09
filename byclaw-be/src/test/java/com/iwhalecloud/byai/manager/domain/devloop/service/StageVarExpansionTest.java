package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.manager.domain.devloop.service.IntegrationRunExecutor.StageDef;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 环境 stage 脚本的 ${...} 变量替换。契约是环境配置页「脚本可用变量」那句提示,
 * 用户按提示写 ${envAddress} 就必须真被替换——此前没有替换实现,变量被 shell 当字面量,
 * 出厂的健康检查示例脚本必然请求失败。
 */
class StageVarExpansionTest {

    private static StageDef stage(String source, String script) {
        StageDef stage = new StageDef();
        stage.name = "健康检查";
        stage.source = source;
        stage.script = script;
        stage.workdir = "/opt/byclaw/ci";
        stage.timeoutSec = 120;
        return stage;
    }

    private static StageDef expand(StageDef stage) {
        return IntegrationRunExecutor.expandStageVars(stage, "release/2026.6.6", "a1b2c3d",
            "https://github.com/acme/cases.git", "http://10.0.0.9:8080");
    }

    @Test
    @DisplayName("inline 脚本里四个变量都按平台取值替换")
    void expandsAllVarsForInlineScript() {
        StageDef expanded = expand(stage("inline",
            "echo ${branch} ${commit} ${repoUrl} ${envAddress}"));

        assertThat(expanded.script)
            .isEqualTo("echo release/2026.6.6 a1b2c3d https://github.com/acme/cases.git http://10.0.0.9:8080");
    }

    @Test
    @DisplayName("同一变量出现多次时全部替换")
    void expandsRepeatedVar() {
        StageDef expanded = expand(stage("inline", "curl ${envAddress}/a && curl ${envAddress}/b"));

        assertThat(expanded.script).isEqualTo("curl http://10.0.0.9:8080/a && curl http://10.0.0.9:8080/b");
    }

    @Test
    @DisplayName("source=path 时脚本是文件路径,不替换")
    void keepsPathScriptIntact() {
        // 路径被替换会指向不存在的文件;这类脚本取变量应走已 export 的环境变量。
        StageDef stage = stage("path", "/opt/ci/deploy-${branch}.sh");

        assertThat(expand(stage).script).isEqualTo("/opt/ci/deploy-${branch}.sh");
    }

    @Test
    @DisplayName("无变量时原样返回同一对象,不做多余拷贝")
    void returnsSameInstanceWhenNoVar() {
        StageDef stage = stage("inline", "docker compose up -d");

        assertThat(expand(stage)).isSameAs(stage);
    }

    @Test
    @DisplayName("变量无对应数据时替换成空串,不残留 ${...} 被 shell 当字面量")
    void replacesMissingValueWithEmpty() {
        // commit 实测恒为 null:byai_integration_run.commit_ref 全仓没有写入点。
        StageDef expanded = IntegrationRunExecutor.expandStageVars(
            stage("inline", "echo [${commit}][${repoUrl}]"), "main", null, null, "http://h");

        assertThat(expanded.script).isEqualTo("echo [][]");
    }

    @Test
    @DisplayName("替换不回写原始 StageDef,避免污染后续使用")
    void doesNotMutateOriginal() {
        StageDef original = stage("inline", "curl ${envAddress}");

        expand(original);

        assertThat(original.script).isEqualTo("curl ${envAddress}");
    }
}
