package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalGitChangeServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void prefersConfiguredUpstreamAsComparisonBase() throws Exception {
        Path repo = initializeRepository("upstream");
        git(repo, "checkout", "-b", "feature/upstream");
        git(repo, "branch", "--set-upstream-to=main");
        Files.writeString(repo.resolve("app.txt"), "upstream change\n");
        git(repo, "add", "app.txt");
        git(repo, "commit", "-m", "change from upstream");

        LocalGitChangeService.LocalChangeResult result = new LocalGitChangeService().collectChanges(repo, "main");

        assertThat(result.getStatus()).isEqualTo(LocalGitChangeService.LocalStatus.OK);
        assertThat(result.getBaseBranch()).isEqualTo("main");
        assertThat(result.getFiles()).extracting(LocalGitChangeService.LocalFileChange::getFilename)
            .containsExactly("app.txt");
    }

    @Test
    void usesOldestDistinctReflogEntryWhenUpstreamIsMissing() throws Exception {
        Path repo = initializeRepository("reflog");
        String mainCommit = git(repo, "rev-parse", "HEAD").trim();
        git(repo, "checkout", "-b", "feature/reflog");
        Files.writeString(repo.resolve("app.txt"), "reflog change\n");
        git(repo, "add", "app.txt");
        git(repo, "commit", "-m", "change from reflog");

        LocalGitChangeService.LocalChangeResult result = new LocalGitChangeService().collectChanges(repo, "main");

        assertThat(result.getStatus()).isEqualTo(LocalGitChangeService.LocalStatus.OK);
        assertThat(result.getBaseBranch()).isEqualTo(mainCommit);
        assertThat(result.getFiles()).hasSize(1);
    }

    @Test
    void fallsBackToMainWhenReflogHasNoDistinctCommit() throws Exception {
        Path repo = initializeRepository("main-fallback");
        git(repo, "checkout", "-b", "feature/uncommitted");
        Files.writeString(repo.resolve("app.txt"), "working tree change\n");

        LocalGitChangeService.LocalChangeResult result = new LocalGitChangeService().collectChanges(repo, "main");

        assertThat(result.getStatus()).isEqualTo(LocalGitChangeService.LocalStatus.OK);
        assertThat(result.getBaseBranch()).isEqualTo("main");
        assertThat(result.getFiles()).extracting(LocalGitChangeService.LocalFileChange::getFilename)
            .containsExactly("app.txt");
    }

    @Test
    void expandsUntrackedDirectoriesIntoIndividualFiles() throws Exception {
        Path repo = initializeRepository("untracked-directory");
        Files.createDirectories(repo.resolve("scripts/nested"));
        Files.writeString(repo.resolve("scripts/setup.sh"), "echo setup\n");
        Files.writeString(repo.resolve("scripts/nested/run.sh"), "echo run\n");

        LocalGitChangeService.LocalChangeResult result = new LocalGitChangeService().collectChanges(repo, "main");

        assertThat(result.getFiles()).extracting(LocalGitChangeService.LocalFileChange::getFilename)
            .contains("scripts/setup.sh", "scripts/nested/run.sh")
            .doesNotContain("scripts");
    }

    @Test
    void returnsContentDiffForUntrackedFile() throws Exception {
        Path repo = initializeRepository("untracked-file-diff");
        Files.writeString(repo.resolve("prd.md"), "# Product requirements\n\n- First item\n");

        LocalGitChangeService.FileDiffResult result = new LocalGitChangeService().fileDiff(repo, "main", "prd.md");

        assertThat(result.getStatus()).isEqualTo(LocalGitChangeService.LocalStatus.OK);
        assertThat(result.getDiff()).contains("+# Product requirements", "+- First item");
    }

    @Test
    void returnsContentDiffForStagedAddedFile() throws Exception {
        Path repo = initializeRepository("staged-file-diff");
        Files.createDirectories(repo.resolve(".trellis/tasks/00-join"));
        Files.writeString(repo.resolve(".trellis/tasks/00-join/prd.md"), "# Product requirements\n");
        git(repo, "add", ".trellis/tasks/00-join/prd.md");

        LocalGitChangeService.FileDiffResult result = new LocalGitChangeService().fileDiff(
            repo, "main", ".trellis/tasks/00-join/prd.md");

        assertThat(result.getStatus()).isEqualTo(LocalGitChangeService.LocalStatus.OK);
        assertThat(result.getDiff()).contains("+# Product requirements");
    }

    private Path initializeRepository(String name) throws Exception {
        Path repo = tempDir.resolve(name);
        Files.createDirectories(repo);
        git(repo, "init", "-b", "main");
        git(repo, "config", "user.name", "ByClaw Test");
        git(repo, "config", "user.email", "test@byclaw.local");
        Files.writeString(repo.resolve("app.txt"), "initial\n");
        git(repo, "add", "app.txt");
        git(repo, "commit", "-m", "initial");
        return repo;
    }

    private String git(Path repo, String... arguments) throws IOException, InterruptedException {
        String[] command = new String[arguments.length + 1];
        command[0] = "git";
        System.arraycopy(arguments, 0, command, 1, arguments.length);
        Process process = new ProcessBuilder(command).directory(repo.toFile()).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes());
        if (process.waitFor() != 0) {
            throw new IllegalStateException(output);
        }
        return output;
    }
}
