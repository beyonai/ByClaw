package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitResultDto.PresplitTask;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

/**
 * AI 预拆的模型输出解析。回归重点:模型输出不可信,未知 repoId、重复仓库、悬空/成环依赖必须在这里拦掉,
 * 否则用户点了启动才在 splitTask 里失败,或者落库成永远等不到上游的依赖图。
 */
class RequirementPresplitServiceTest {

    private static ProjectRepo repo(long repoId, String name) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(repoId);
        repo.setRepoFullName(name);
        return repo;
    }

    private static final List<ProjectRepo> REPOS = List.of(repo(1L, "acme/be"), repo(2L, "acme/fe"));

    @Test
    @DisplayName("正常输出：rowId 重编为 row-0..N，依赖按新 rowId 翻译")
    void parsesTasksAndTranslatesDeps() throws Exception {
        String json = """
            {"tasks":[
              {"rowId":"a","repoId":1,"title":"后端加接口","branch":"feat/x","dependsOn":[],"reason":"提供接口"},
              {"rowId":"b","repoId":2,"title":"前端接入","branch":"feat/x","dependsOn":["a"],"reason":"依赖接口"}
            ]}""";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, REPOS, "需求");

        assertThat(tasks).hasSize(2);
        assertThat(tasks.get(0).getRowId()).isEqualTo("row-0");
        assertThat(tasks.get(0).getDependsOn()).isEmpty();
        assertThat(tasks.get(1).getRowId()).isEqualTo("row-1");
        assertThat(tasks.get(1).getDependsOn()).containsExactly("row-0");
        assertThat(tasks.get(1).getReason()).isEqualTo("依赖接口");
    }

    @Test
    @DisplayName("未知 repoId 与重复仓库整条丢弃，不会带着假仓库进 splitTask")
    void dropsUnknownAndDuplicateRepos() throws Exception {
        String json = """
            {"tasks":[
              {"repoId":1,"title":"t1","branch":"feat/x","dependsOn":[]},
              {"repoId":99,"title":"编造的仓库","branch":"feat/x","dependsOn":[]},
              {"repoId":1,"title":"重复仓库","branch":"feat/x","dependsOn":[]}
            ]}""";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, REPOS, "需求");

        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getRepoId()).isEqualTo(1L);
    }

    @Test
    @DisplayName("悬空依赖与自环依赖被剔除")
    void dropsDanglingAndSelfDeps() throws Exception {
        String json = """
            {"tasks":[
              {"rowId":"a","repoId":1,"title":"t1","branch":"feat/x","dependsOn":["a","nope"]},
              {"rowId":"b","repoId":2,"title":"t2","branch":"feat/x","dependsOn":["missing"]}
            ]}""";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, REPOS, "需求");

        assertThat(tasks).hasSize(2);
        assertThat(tasks.get(0).getDependsOn()).isEmpty();
        assertThat(tasks.get(1).getDependsOn()).isEmpty();
    }

    @Test
    @DisplayName("成环依赖只保留不成环的那条边，图始终可执行")
    void breaksCycles() throws Exception {
        String json = """
            {"tasks":[
              {"rowId":"a","repoId":1,"title":"t1","branch":"feat/x","dependsOn":["b"]},
              {"rowId":"b","repoId":2,"title":"t2","branch":"feat/x","dependsOn":["a"]}
            ]}""";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, REPOS, "需求");

        assertThat(tasks).hasSize(2);
        // a←b 先建立，b←a 会成环被剔除；至少有一个入度为 0 的起点。
        assertThat(tasks.stream().filter(task -> task.getDependsOn().isEmpty())).isNotEmpty();
        assertThat(tasks.get(0).getDependsOn()).containsExactly("row-1");
        assertThat(tasks.get(1).getDependsOn()).isEmpty();
    }

    @Test
    @DisplayName("分支名全批统一取第一条，避免子任务落到不同分支")
    void unifiesBranchAcrossTasks() throws Exception {
        String json = """
            {"tasks":[
              {"repoId":1,"title":"t1","branch":"feat/one","dependsOn":[]},
              {"repoId":2,"title":"t2","branch":"feat/two","dependsOn":[]}
            ]}""";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, REPOS, "需求");

        assertThat(tasks).extracting(PresplitTask::getBranch).containsOnly("feat/one");
    }

    @Test
    @DisplayName("缺 title/branch 时回退需求标题与按标题生成的分支")
    void fallsBackToRequirementTitleAndBranch() throws Exception {
        String json = "{\"tasks\":[{\"repoId\":1,\"dependsOn\":[]}]}";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, REPOS, "Add Login Api");

        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getTitle()).isEqualTo("Add Login Api");
        assertThat(tasks.get(0).getBranch()).isEqualTo("feat/add-login-api");
    }

    @Test
    @DisplayName("有工作区仓库时强制用工作区分支，模型给的分支被覆盖")
    void forcesWorkspaceBranch() throws Exception {
        ProjectRepo workspace = repo(3L, "acme/workspace");
        workspace.setRepoType("workspace");
        workspace.setDefaultBranch("release/2026.6");
        List<ProjectRepo> repos = List.of(workspace, repo(1L, "acme/be"));
        String json = """
            {"tasks":[
              {"repoId":1,"title":"t1","branch":"feat/model-guess","dependsOn":[]},
              {"repoId":3,"title":"t2","branch":"feat/other","dependsOn":[]}
            ]}""";
        List<PresplitTask> tasks = RequirementPresplitService.parseTasks(json, repos, "需求");

        assertThat(tasks).extracting(PresplitTask::getBranch).containsOnly("release/2026.6");
    }

    @Test
    @DisplayName("工作区仓库没配分支时不影响原有回退逻辑")
    void ignoresBlankWorkspaceBranch() throws Exception {
        ProjectRepo workspace = repo(3L, "acme/workspace");
        workspace.setRepoType("workspace");
        List<ProjectRepo> repos = List.of(workspace, repo(1L, "acme/be"));

        assertThat(RequirementPresplitService.findWorkspaceBranch(repos)).isNull();
        List<PresplitTask> tasks = RequirementPresplitService
            .parseTasks("{\"tasks\":[{\"repoId\":1,\"branch\":\"feat/model-guess\",\"dependsOn\":[]}]}", repos, "需求");
        assertThat(tasks.get(0).getBranch()).isEqualTo("feat/model-guess");
    }

    @Test
    @DisplayName("tasks 缺失或全部不可用时返回空，交由调用方降级")
    void returnsEmptyWhenNothingUsable() throws Exception {
        assertThat(RequirementPresplitService.parseTasks("{\"foo\":1}", REPOS, "需求")).isEmpty();
        assertThat(RequirementPresplitService.parseTasks("{\"tasks\":[{\"repoId\":99}]}", REPOS, "需求")).isEmpty();
    }
}
