package com.iwhalecloud.byai.state.application.service.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.resource.qo.WorkspaceSkillCenterQo;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

class WorkspaceSkillCenterApplicationServiceTest {
    private static final String ROOT = "/.openclaw/workspace-baiying-agent-10/skills/";
    private static final String PATH = ROOT + "demo";
    private final SsResourceRelDetailService relations = mock(SsResourceRelDetailService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final AuthApplicationService auth = mock(AuthApplicationService.class);
    private final UserFS files = mock(UserFS.class);
    private final ByClawSkillPathResolver paths = mock(ByClawSkillPathResolver.class);
    private final ByClawSkillResourceApplicationService packages = mock(ByClawSkillResourceApplicationService.class);
    private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    private final Map<String, byte[]> source = new LinkedHashMap<>();
    private WorkspaceSkillCenterApplicationService service;
    private WorkspaceSkillCenterQo request;
    private SsResource employee;
    private MockedStatic<I18nUtil> messages;

    @BeforeEach
    void setup() {
        messages = mockStatic(I18nUtil.class);
        messages.when(() -> I18nUtil.get(anyString())).thenAnswer(call -> call.getArgument(0));
        LoginInfo login = new LoginInfo();
        login.setUserId(1L);
        login.setUserCode("me");
        login.setEnterpriseId(100L);
        CurrentUserHolder.setLoginInfo(login);
        employee = resource(10L, "personal", 1L);
        employee.setResourceBizType("DIG_EMPLOYEE");
        when(resources.findById(10L)).thenReturn(employee);
        when(resources.findByIdForUpdate(10L)).thenReturn(employee);
        when(auth.hasResourceInstallTargetManagePermission(employee)).thenReturn(true);
        when(paths.resolveSkillRootPrefix("me", 10L)).thenReturn(ROOT);
        when(resources.getResourceListByCode(any())).thenReturn(List.of());
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        source.put("SKILL.md", "---\nname: demo\n---\nnew body\n".getBytes(StandardCharsets.UTF_8));
        source.put("scripts/run.sh", "echo test".getBytes(StandardCharsets.UTF_8));
        when(files.read(anyString())).thenAnswer(call -> {
            byte[] bytes = source.get(call.<String>getArgument(0).substring((PATH + "/").length()));
            return bytes == null ? null : new ByteArrayInputStream(bytes);
        });
        when(files.list(PATH + "/", Integer.MAX_VALUE))
            .thenAnswer(call -> source.keySet().stream().map(key -> PATH + "/" + key).toList());
        when(files.delete(PATH + "/")).thenAnswer(call -> { source.clear(); return true; });
        when(packages.saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L)))
            .thenReturn(new ByClawSkillResourceApplicationService.SkillImportResult(resource(20L, "personal", 1L), null, false));
        when(packages.readCenterSkillFiles(any())).thenCallRealMethod();
        when(packages.replaceCenterSkillFiles(any(), any())).thenCallRealMethod();
        service = new WorkspaceSkillCenterApplicationService(resources, auth, files, paths, packages, transactions, relations);
        request = new WorkspaceSkillCenterQo();
        request.setResourceId(10L);
        request.setSkillPath(PATH);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.clearLoginInfo();
        messages.close();
    }

    @Test
    void installsCompletePersonalDirectoryAndDeletesOnlyAfterCommit() throws Exception {
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("INSTALL");
        assertThat(preview.ownerType()).isEqualTo("personal");
        request.setRevision(preview.revision());
        var result = service.sync(request);
        assertThat(result.sourceDeleted()).isTrue();
        var order = inOrder(packages, transactions, files);
        order.verify(packages).saveWorkspaceSkillCenterPackage(any(), eq("personal"), eq("demo"), eq("demo"), isNull(), eq(10L));
        order.verify(transactions).commit(any());
        order.verify(files).delete(PATH + "/");
        var archive = ArgumentCaptor.forClass(byte[].class);
        verify(packages).saveWorkspaceSkillCenterPackage(archive.capture(), eq("personal"), eq("demo"), eq("demo"), isNull(), eq(10L));
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive.getValue()))) {
            assertThat(zip.getNextEntry().getName()).isEqualTo("demo/SKILL.md");
            assertThat(new String(zip.readAllBytes(), StandardCharsets.UTF_8)).contains("new body");
            assertThat(zip.getNextEntry().getName()).isEqualTo("demo/scripts/run.sh");
            assertThat(new String(zip.readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("echo test");
        }
    }

    @Test
    void personalMatchingExcludesOtherCreatorsAndEnterpriseResources() {
        when(resources.getResourceListByCode(any())).thenReturn(List.of(resource(21L, "personal", 2L),
            resource(22L, "enterprise", 1L)));
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("INSTALL");
        request.setRevision(preview.revision());
        service.sync(request);
        verify(packages).saveWorkspaceSkillCenterPackage(any(), eq("personal"),
            org.mockito.ArgumentMatchers.startsWith("workspace-"), eq("demo"), isNull(), eq(10L));
        verify(packages, never()).readCenterSkillPackage(any());
    }

    @Test
    void enterpriseMatchingIncludesOtherCreatorsAndEnterprisesAndUpdatesTheSameResource() {
        employee.setOwnerType("enterprise");
        SsResource target = resource(21L, "enterprise", 2L);
        target.setComAcctId(999L);
        // 企业范围不因创建人、企业 ID 或资源来源系统而缩小。
        target.setSystemCode("WHAGE_AGENT");
        existing(target, "old body");
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("UPDATE");
        assertThat(preview.targetResourceId()).isEqualTo(21L);
        request.setRevision(preview.revision());
        service.sync(request);
        verify(packages, times(2)).assertSkillManagePermission(target);
        verify(packages).saveWorkspaceSkillCenterPackage(any(), eq("enterprise"), eq("demo"), eq("demo"), eq(target), eq(10L));
    }

    @Test
    void identicalPackageHasNoActionAndCannotDeleteSource() {
        SsResource target = resource(21L, "personal", 1L);
        existing(target, new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("NONE");
        request.setRevision(preview.revision());
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("unchanged");
        verify(files, never()).delete(anyString());
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
    }

    @Test
    void markdownWhitespaceChangesRequireUpdate() {
        existing(resource(21L, "personal", 1L), new String(source.get("SKILL.md"), StandardCharsets.UTF_8).stripTrailing());
        assertThat(service.preview(request).action()).isEqualTo("UPDATE");
    }

    @Test
    void rejectsStaleSourceAndDoesNotWriteOrDelete() {
        request.setRevision(service.preview(request).revision());
        source.put("SKILL.md", "changed".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("changed");
        verify(files, never()).delete(anyString());
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
    }

    @Test
    void rejectsChangedCenterPackageAndMissingTargetPermission() {
        SsResource target = resource(21L, "personal", 1L);
        existing(target, "old body");
        request.setRevision(service.preview(request).revision());
        when(packages.readCenterSkillPackage(target)).thenReturn(archive(Map.of("SKILL.md", new byte[] {3, 4}), "demo/", 0L));
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("changed");
        doThrow(new IllegalArgumentException("permission")).when(packages).assertSkillManagePermission(target);
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("permission");
        verify(files, never()).delete(anyString());
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
    }

    @Test
    void rejectsAmbiguousMatchesInsteadOfOverwritingMultipleSkills() {
        when(resources.getResourceListByCode(any())).thenReturn(List.of(
            resource(21L, "personal", 1L), resource(22L, "personal", 1L)));
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("ambiguous");
        verify(packages, never()).readCenterSkillPackage(any());
        verify(files, never()).delete(anyString());
    }

    @Test
    void savingFailureRollsBackWithoutDeletingSource() {
        request.setRevision(service.preview(request).revision());
        when(packages.saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L)))
            .thenThrow(new IllegalStateException("storage failed"));
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("storage failed");
        verify(transactions).rollback(any());
        verify(transactions, never()).commit(any());
        verify(files, never()).delete(anyString());
    }

    @Test
    void bindingFailureRollsBackAndRetainsSourceDirectory() {
        request.setRevision(service.preview(request).revision());
        when(packages.saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L)))
            .thenThrow(new IllegalStateException("employee binding failed"));
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("employee binding failed");
        verify(transactions).rollback(any());
        verify(transactions, never()).commit(any());
        verify(files, never()).delete(anyString());
        assertThat(source).containsKey("SKILL.md");
    }

    @Test
    void failedCommitNeverDeletesSource() {
        request.setRevision(service.preview(request).revision());
        doThrow(new IllegalStateException("commit failed")).when(transactions).commit(any());
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("commit failed");
        verify(files, never()).delete(anyString());
    }

    @Test
    void cleanupFailureReportsSavedResourceWithoutRollingBack() {
        request.setRevision(service.preview(request).revision());
        doThrow(new IllegalStateException("delete failed")).when(files).delete(PATH + "/");
        var result = service.sync(request);
        assertThat(result.resourceId()).isEqualTo(20L);
        assertThat(result.sourceDeleted()).isFalse();
        assertThat(source).containsKey("SKILL.md");
        verify(transactions).commit(any());
        verify(transactions, never()).rollback(any());
    }

    @Test
    void newFilesWrittenDuringSavePreventDirectoryDeletion() {
        request.setRevision(service.preview(request).revision());
        doAnswer(call -> { source.put("new.txt", new byte[] {1}); return null; }).when(transactions).commit(any());
        assertThat(service.sync(request).sourceDeleted()).isFalse();
        verify(files, never()).delete(anyString());
    }

    @Test
    void rejectsUnavailableEmployeeAndTraversalBeforeReadingFiles() {
        when(auth.hasResourceInstallTargetManagePermission(employee)).thenReturn(false);
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("permission");
        when(auth.hasResourceInstallTargetManagePermission(employee)).thenReturn(true);
        for (String invalid : List.of(ROOT, ROOT + "../demo", ROOT + "demo/nested", "/other/skills/demo")) {
            request.setSkillPath(invalid);
            assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("invalid");
        }
        verify(files, never()).read(anyString());
        verify(files, never()).delete(anyString());
    }

    @Test
    void installedSkillComparesMd5AndUpdatesBoundResourceWithoutDeletingDirectory() {
        SsResource target = installed("old body");
        // 即使员工与技能归属不同，也更新真实安装的资源，而不是创建同名副本。
        employee.setOwnerType("enterprise");
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("UPDATE");
        assertThat(preview.ownerType()).isEqualTo("personal");
        assertThat(preview.targetResourceId()).isEqualTo(21L);
        request.setRevision(preview.revision());
        assertThat(service.sync(request).sourceDeleted()).isFalse();
        verify(packages).saveWorkspaceSkillCenterPackage(any(), eq("personal"), eq("demo"), eq("demo"), eq(target), eq(10L));
        verify(files, never()).delete(anyString());
        verify(resources, never()).getResourceListByCode(any());
        assertThat(source).containsKey("SKILL.md");
    }

    @Test
    void installedIdenticalPackageHasNoUpdate() {
        installed(new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        assertThat(service.preview(request).action()).isEqualTo("NONE");
        verify(packages, never()).assertSkillManagePermission(any());
    }

    @Test
    void installedSkillWithCleanedSourceSkipsComparisonAndCannotSync() {
        installed("old body");
        source.clear();
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("NONE");
        assertThat(preview.revision()).isNotBlank();
        verify(packages, never()).readCenterSkillFiles(any());
        verify(packages, never()).assertSkillManagePermission(any());
        request.setRevision(preview.revision());
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("unchanged");
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
        verify(files, never()).delete(anyString());
    }

    @Test
    void installedSkillRejectsSubmissionIfSourceWasCleanedAfterPreview() {
        installed("old body");
        request.setRevision(service.preview(request).revision());
        source.clear();
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("changed");
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
    }

    @Test
    void installedSkillStillReportsReadAndListingFailures() {
        installed("old body");
        when(files.read(PATH + "/scripts/run.sh")).thenReturn(null);
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("missing");
        when(files.list(PATH + "/", Integer.MAX_VALUE)).thenThrow(new IllegalStateException("storage unavailable"));
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("storage unavailable");
    }

    @Test
    void installedSkillRejectsUnboundIdsMissingFilesAndStaleContent() {
        installed("old body");
        request.setRevision(service.preview(request).revision());
        source.put("SKILL.md", "newer body".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("changed");
        source.remove("SKILL.md");
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("missing");
        when(relations.findByResourceId(10L)).thenReturn(List.of());
        assertThatThrownBy(() -> service.preview(request)).hasMessageContaining("permission");
        verify(files, never()).delete(anyString());
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
    }

    @Test
    void attachmentChangesTriggerUpdateAndSaveTheEntireDirectory() throws Exception {
        SsResource target = resource(21L, "personal", 1L);
        existing(target, new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        source.put("scripts/run.sh", "echo changed".getBytes(StandardCharsets.UTF_8));
        source.put("references/resourceMate.json", "{}".getBytes(StandardCharsets.UTF_8));
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("UPDATE");
        request.setRevision(preview.revision());
        Map<String, byte[]> expected = new LinkedHashMap<>(source);
        service.sync(request);
        var archive = ArgumentCaptor.forClass(byte[].class);
        verify(packages).saveWorkspaceSkillCenterPackage(archive.capture(), eq("personal"), eq("demo"),
            eq("demo"), eq(target), eq(10L));
        Map<String, byte[]> actual = packages.readCenterSkillFiles(archive.getValue());
        assertThat(actual.keySet()).containsExactlyInAnyOrderElementsOf(expected.keySet());
        expected.forEach((name, bytes) -> assertThat(actual.get(name)).isEqualTo(bytes));
        verify(packages, never()).replaceCenterSkillDocument(any(), any());
    }

    @Test
    void removingAnAttachmentTriggersUpdate() {
        existing(resource(21L, "personal", 1L), new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        source.remove("scripts/run.sh");
        assertThat(service.preview(request).action()).isEqualTo("UPDATE");
    }

    @Test
    void completeUpdateRemovesDeletedFilesAndConvergesToNoAction() {
        SsResource target = installed(new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        source.remove("scripts/run.sh");
        var preview = service.preview(request);
        assertThat(preview.action()).isEqualTo("UPDATE");
        request.setRevision(preview.revision());
        service.sync(request);
        var archive = ArgumentCaptor.forClass(byte[].class);
        verify(packages).saveWorkspaceSkillCenterPackage(archive.capture(), eq("personal"), eq("demo"),
            eq("demo"), eq(target), eq(10L));
        assertThat(packages.readCenterSkillFiles(archive.getValue())).doesNotContainKey("scripts/run.sh");
        when(packages.readCenterSkillPackage(target)).thenReturn(archive.getValue());
        assertThat(service.preview(request).action()).isEqualTo("NONE");
    }

    @Test
    void fullPackageUpdatePreservesExistingExecutableMode() throws Exception {
        byte[] original;
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            var zip = new org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream(bytes)) {
            for (var file : source.entrySet()) {
                var entry = new org.apache.commons.compress.archivers.zip.ZipArchiveEntry("demo/" + file.getKey());
                entry.setUnixMode(file.getKey().endsWith(".sh") ? 0100755 : 0100644);
                zip.putArchiveEntry(entry);
                zip.write(file.getValue());
                zip.closeArchiveEntry();
            }
            zip.finish();
            original = bytes.toByteArray();
        }
        source.put("scripts/run.sh", "echo updated".getBytes(StandardCharsets.UTF_8));
        byte[] updated = packages.replaceCenterSkillFiles(original, source);
        try (var channel = new org.apache.commons.compress.utils.SeekableInMemoryByteChannel(updated);
            var zip = new org.apache.commons.compress.archivers.zip.ZipFile(channel)) {
            assertThat(zip.getEntry("demo/scripts/run.sh").getUnixMode()).isEqualTo(0100755);
        }
    }

    @Test
    void addingAnAttachmentTriggersUpdate() {
        existing(resource(21L, "personal", 1L), new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        source.put("references/data.json", "{}".getBytes(StandardCharsets.UTF_8));
        assertThat(service.preview(request).action()).isEqualTo("UPDATE");
    }

    @Test
    void packageOrderTimestampAndWrapperDirectoryDoNotTriggerUpdate() {
        SsResource target = resource(21L, "personal", 1L);
        existing(target, new String(source.get("SKILL.md"), StandardCharsets.UTF_8));
        Map<String, byte[]> reversed = new LinkedHashMap<>();
        reversed.put("scripts/run.sh", source.get("scripts/run.sh"));
        reversed.put("SKILL.md", source.get("SKILL.md"));
        for (String prefix : List.of("", "another-wrapper/")) {
            when(packages.readCenterSkillPackage(target)).thenReturn(archive(reversed, prefix, 1700000000000L));
            assertThat(service.preview(request).action()).isEqualTo("NONE");
        }
    }

    @Test
    void attachmentChangesAfterPreviewRejectStaleSubmission() {
        request.setRevision(service.preview(request).revision());
        source.put("scripts/run.sh", "changed after preview".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> service.sync(request)).hasMessageContaining("changed");
        verify(packages, never()).saveWorkspaceSkillCenterPackage(any(), anyString(), anyString(), anyString(), any(), eq(10L));
        verify(files, never()).delete(anyString());
    }

    private byte[] archive(Map<String, byte[]> contents, String prefix, long timestamp) {
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (var file : contents.entrySet()) {
                ZipEntry entry = new ZipEntry(prefix + file.getKey());
                entry.setTime(timestamp);
                zip.putNextEntry(entry);
                zip.write(file.getValue());
                zip.closeEntry();
            }
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private SsResource installed(String document) {
        SsResource target = resource(21L, "personal", 1L);
        existing(target, document);
        when(resources.findById(21L)).thenReturn(target);
        when(packages.readCenterSkillDirectoryName(any(), eq("demo"))).thenReturn("demo");
        SsResourceRelDetail binding = new SsResourceRelDetail();
        binding.setRelResourceId(21L);
        when(relations.findByResourceId(10L)).thenReturn(List.of(binding));
        request.setTargetResourceId(21L);
        request.setSkillPath(null);
        return target;
    }

    private void existing(SsResource resource, String document) {
        when(resources.getResourceListByCode(any())).thenReturn(List.of(resource));
        when(resources.findByIdForUpdate(resource.getResourceId())).thenReturn(resource);
        Map<String, byte[]> center = new LinkedHashMap<>(source);
        center.put("SKILL.md", document.getBytes(StandardCharsets.UTF_8));
        when(packages.readCenterSkillPackage(resource)).thenReturn(archive(center, "demo/", 0L));
    }

    private SsResource resource(Long id, String owner, Long creator) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setResourceCode("demo");
        resource.setResourceName("demo");
        resource.setResourceBizType("SKILL");
        resource.setSystemCode("BYAI");
        resource.setOwnerType(owner);
        resource.setCreateBy(creator);
        resource.setResourceStatus(2);
        return resource;
    }
}
