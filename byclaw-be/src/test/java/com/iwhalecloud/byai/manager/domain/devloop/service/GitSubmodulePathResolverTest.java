package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class GitSubmodulePathResolverTest {

    @Test
    void resolvesNestedSubmodulePathByRepositoryUrl() throws Exception {
        Path workspace = Files.createTempDirectory("workspace-repo");
        Files.writeString(workspace.resolve(".gitmodules"), "[submodule \"backend\"]\n"
            + "\tpath = services/backend\n"
            + "\turl = https://github.com/acme/backend.git\n");
        ProjectRepo codeRepo = repo("acme/backend", "https://github.com/acme/backend.git");

        assertThat(new GitSubmodulePathResolver().resolve(workspace, codeRepo))
            .contains(workspace.resolve(Path.of("services", "backend")));
    }

    @Test
    void returnsEmptyWhenRepositoryIsNotDeclaredAsSubmodule() throws Exception {
        Path workspace = Files.createTempDirectory("workspace-repo");
        Files.writeString(workspace.resolve(".gitmodules"), "[submodule \"frontend\"]\n"
            + "\tpath = frontend\n"
            + "\turl = https://github.com/acme/frontend.git\n");

        assertThat(new GitSubmodulePathResolver().resolve(workspace, repo("acme/backend", null))).isEmpty();
    }

    private static ProjectRepo repo(String fullName, String url) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoFullName(fullName);
        repo.setRepoUrl(url);
        return repo;
    }
}
