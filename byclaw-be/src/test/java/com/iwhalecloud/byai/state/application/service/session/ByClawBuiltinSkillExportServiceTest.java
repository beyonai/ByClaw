package com.iwhalecloud.byai.state.application.service.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;

class ByClawBuiltinSkillExportServiceTest {
    private final SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
    private final UserSandboxResolver resolver = mock(UserSandboxResolver.class);
    private final ByClawBuiltinSkillExportService service = new ByClawBuiltinSkillExportService(executor, resolver);

    @Test
    void exportsOriginalZipForOrdinaryUserAndImportRecognizesSkillCode() throws Exception {
        var output = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("demo/SKILL.md"));
            zip.write("---\nname: demo\ndescription: Example\n---\nBody".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("demo/scripts/run.sh"));
            zip.write("echo example".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        when(resolver.resolve("ordinary", "openclaw"))
            .thenReturn(new UserSandboxResolver.UserSandboxContext("sandbox", "ordinary", null, null));
        when(executor.run(eq("sandbox"), any())).thenReturn(new SandboxCommandResult(0,
            Base64.getEncoder().encodeToString(output.toByteArray()), "", false, false));
        byte[] result = service.exportPackage("ordinary", "demo");
        assertThat(result).isEqualTo(output.toByteArray());
        var metadata = new ByClawSkillResourceApplicationService().inspectSkillPackage(
            new MockMultipartFile("file", "demo.zip", "application/zip", result));
        assertThat(metadata.skillCode()).isEqualTo("demo");
        var request = ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(executor).run(eq("sandbox"), request.capture());
        assertThat(request.getValue().argv()).startsWith("python3", "-c").endsWith("demo");
        assertThat(request.getValue().background()).isFalse();
    }

    @Test
    void rejectsPathTraversalBeforeResolvingRuntime() {
        try (var messages = mockStatic(I18nUtil.class)) {
            assertThatThrownBy(() -> service.exportPackage("ordinary", "../secret"))
                .isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(resolver, executor);
    }

    @Test
    void rejectsFailedTimedOutTruncatedAndInvalidOutputWithoutReturningPartialPackages() {
        when(resolver.resolve("ordinary", "openclaw"))
            .thenReturn(new UserSandboxResolver.UserSandboxContext("sandbox", "ordinary", null, null));
        var results = java.util.List.of(
            new SandboxCommandResult(1, "", "missing", false, false),
            new SandboxCommandResult(0, "UEsDBA==", "", true, false),
            new SandboxCommandResult(0, "UEsDBA==", "", false, true),
            new SandboxCommandResult(0, "not base64", "", false, false));
        try (var messages = mockStatic(I18nUtil.class)) {
            for (var result : results) {
                when(executor.run(eq("sandbox"), any())).thenReturn(result);
                assertThatThrownBy(() -> service.exportPackage("ordinary", "demo"))
                    .isInstanceOf(IllegalArgumentException.class);
            }
        }
    }
}
