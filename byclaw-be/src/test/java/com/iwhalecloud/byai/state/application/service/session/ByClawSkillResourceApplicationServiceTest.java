package com.iwhalecloud.byai.state.application.service.session;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceArtifactTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.resource.vo.SkillMarketplaceDigitalEmployeeVo;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Locale;

class ByClawSkillResourceApplicationServiceTest {

    private SsResourceService ssResourceService;
    private SsResExtSkillService ssResExtSkillService;
    private SsResourceRelDetailService ssResourceRelDetailService;
    private SsResourceArtifactService ssResourceArtifactService;
    private ResourceArtifactStorageService resourceArtifactStorageService;
    private SequenceService sequenceService;
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;
    private DigitalEmployeeRuntimeRefreshService digitalEmployeeRuntimeRefreshService;
    private AuthApplicationService authApplicationService;
    private com.iwhalecloud.byai.manager.application.service.resource.SkillPublicationService publications;
    private ByClawSkillResourceApplicationService service;

    @BeforeEach
    void setUp() {
        ssResourceService = mock(SsResourceService.class);
        ssResExtSkillService = mock(SsResExtSkillService.class);
        ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        ssResourceArtifactService = mock(SsResourceArtifactService.class);
        resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        sequenceService = mock(SequenceService.class);
        digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);
        digitalEmployeeRuntimeRefreshService = mock(DigitalEmployeeRuntimeRefreshService.class);
        authApplicationService = mock(AuthApplicationService.class);

        service = new ByClawSkillResourceApplicationService();
        publications = mock(com.iwhalecloud.byai.manager.application.service.resource.SkillPublicationService.class);
        ReflectionTestUtils.setField(service, "skillPublicationService", publications);
        when(publications.canReview()).thenAnswer(invocation ->
            CurrentUserHolder.isAdminVip() || CurrentUserHolder.isPlatformManager());
        var transactions = mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenAnswer(invocation ->
            new org.springframework.transaction.support.SimpleTransactionStatus());
        ReflectionTestUtils.setField(service, "transactionManager", transactions);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResExtSkillService", ssResExtSkillService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", ssResourceArtifactService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "digitalEmployeeApplicationService", digitalEmployeeApplicationService);
        ReflectionTestUtils.setField(service, "digitalEmployeeRuntimeRefreshService",
            digitalEmployeeRuntimeRefreshService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        prepareI18nUtil();
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10001L);
        loginInfo.setUserCode("user001");
        loginInfo.setEnterpriseId(1L);
        loginInfo.setDefaultDigEmployeeId(9001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @ParameterizedTest
    @ValueSource(strings = {"adminvip", "AdminVip", "PLAT_MAN", "plat_man", "PLAT_DEVOPS", "ORG_MAN", "BUSINESS_MAN", "ORD_USER"})
    void officialImportOnlyBypassesReviewForAdminVipOrPlatformManager(String identity) throws Exception {
        CurrentUserHolder.getLoginInfo().setUserCode(identity.equalsIgnoreCase("adminvip") ? identity : "role-user");
        var role = new com.iwhalecloud.byai.common.login.bean.UsersOrganization();
        role.setUserType(identity);
        CurrentUserHolder.getLoginInfo().setUsersOrganizations(List.of(role));
        prepareImportSnapshotPersistence();
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {file}, 10L, "enterprise");

        boolean direct = identity.equalsIgnoreCase("adminvip") || identity.equalsIgnoreCase("PLAT_MAN");
        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getItems().get(0).isReviewRequired()).isEqualTo(!direct);
        assertThat(result.getItems().get(0).getResourceCode()).isEqualTo("demo");
        ArgumentCaptor<SsResource> saved = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(saved.capture());
        assertThat(saved.getValue().getResourceStatus()).isEqualTo(direct ? 2 : 4);
        if (direct) {
            verify(publications, never()).submit(any(), any());
            verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
                eq("SKILL_8101.json"), eq("application/json"));
        } else {
            verify(publications).submit(org.mockito.ArgumentMatchers.isNull(), eq(saved.getValue()));
            verify(resourceArtifactStorageService, never()).uploadToSubdirectory(any(byte[].class), eq("skill"),
                any(), eq("application/json"));
            verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class),
                eq("skill/org-hub/import-review/8101/" + DigestUtils.sha256Hex(file.getBytes())),
                eq("demo.zip"), eq("application/zip"));
            org.mockito.Mockito.verifyNoInteractions(digitalEmployeeApplicationService, digitalEmployeeRuntimeRefreshService);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"enterprise", "personal"})
    void ordinaryEnterpriseOverwriteWaitsForReviewEvenThroughPersonalEntry(String ownerType) {
        prepareImportSnapshotPersistence();
        SsResource original = prepareImportOriginal();
        SsResExtSkill ext = ssResExtSkillService.findById(original.getResourceId());
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        var preview = service.previewSkillZipImportConflicts(new org.springframework.web.multipart.MultipartFile[] {file}, ownerType);
        assertThat(preview.getUpdatedItems().get(0).isReviewRequired()).isTrue();
        var result = service.importSkillZip(file, 10L, ownerType, "SKILL_MANAGE_IMPORT");
        assertThat(result.updated()).isTrue();
        assertThat(result.resource().getResourceId()).isEqualTo(8101L);
        assertThat(result.resource().getResourceStatus()).isEqualTo(4);
        assertThat(original.getResourceName()).isEqualTo("Original");
        assertThat(original.getResourceStatus()).isEqualTo(2);
        assertThat(ext.getVersion()).isEqualTo("v0.1");
        assertThat(ext.getSkillUrl()).isEqualTo("/byclaw/resource/skill/org-hub/demo.zip");
        verify(ssResourceService, never()).updateResourceEntity(original);
        verify(ssResExtSkillService, never()).saveOrUpdate(ext);
        org.mockito.Mockito.verifyNoInteractions(digitalEmployeeApplicationService, digitalEmployeeRuntimeRefreshService);
    }

    @Test
    void duplicatePendingImportIsRejectedByPreflightAndSubmission() {
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        String code = "skill-import-review-" + DigestUtils.sha256Hex("1:10001:demo");
        SsResource pending = new SsResource();
        pending.setSystemCode("BYAI");
        pending.setResourceBizType("SKILL");
        pending.setResourceCode(code);
        when(ssResourceService.getResourceListByCode(List.of(code))).thenReturn(List.of(pending));
        var result = service.previewSkillZipImportConflicts(new org.springframework.web.multipart.MultipartFile[] {file}, "enterprise");
        assertThat(result.getFailed()).isEqualTo(1);
        assertThatThrownBy(() -> service.importSkillZip(file, 10L, "enterprise", "SKILL_MANAGE_IMPORT"))
            .hasMessage("byclaw.skill.import.review.pending");
        verify(ssResourceService, never()).saveResource(any());
        org.mockito.Mockito.verifyNoInteractions(resourceArtifactStorageService);
    }

    @Test
    void reviewApprovesNewImportUsingOriginalCodeAndPublishesOnlyAfterCommit() {
        prepareImportSnapshotPersistence();
        var result = service.importSkillZip(new MockMultipartFile("file", "demo.zip", "application/zip",
            skillZipBytes("demo")), 10L, "enterprise", "SKILL_MANAGE_IMPORT");
        when(ssResExtSkillService.findById(8101L)).thenReturn(result.extSkill());
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        result.resource().setResourceStatus(2);
        org.mockito.Mockito.clearInvocations(resourceArtifactStorageService);
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            service.applySkillImportReview(result.resource(), true);
            assertThat(result.resource().getResourceCode()).isEqualTo("demo");
            org.mockito.Mockito.verifyNoInteractions(resourceArtifactStorageService);
            var callbacks = org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations();
            assertThat(callbacks).hasSize(1);
            callbacks.forEach(org.springframework.transaction.support.TransactionSynchronization::afterCommit);
            verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
                eq("SKILL_8101.json"), eq("application/json"));
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void reviewReplacesOriginalResourceAndArchivesUpdateSnapshot() {
        prepareImportSnapshotPersistence();
        SsResource original = prepareImportOriginal();
        var result = service.importSkillZip(new MockMultipartFile("file", "demo.zip", "application/zip",
            skillZipBytes("demo")), 10L, "enterprise", "SKILL_MANAGE_IMPORT");
        when(ssResExtSkillService.findById(8101L)).thenReturn(result.extSkill());
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        result.resource().setResourceStatus(2);
        org.mockito.Mockito.clearInvocations(ssResExtSkillService);
        org.mockito.Mockito.doAnswer(invocation -> {
            SsResExtSkill approved = invocation.getArgument(0);
            when(ssResExtSkillService.findById(approved.getResourceId())).thenReturn(approved);
            return null;
        }).when(ssResExtSkillService).saveOrUpdate(any(SsResExtSkill.class));
        service.applySkillImportReview(result.resource(), true);
        assertThat(original.getResourceId()).isEqualTo(7101L);
        assertThat(original.getResourceName()).isEqualTo("demo");
        assertThat(original.getResourceStatus()).isEqualTo(2);
        assertThat(result.resource().getResourceStatus()).isEqualTo(-1);
        assertThat(result.resource().getResourceCode()).endsWith("-8101");
        ArgumentCaptor<SsResExtSkill> saved = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(saved.capture());
        assertThat(saved.getValue().getResourceId()).isEqualTo(7101L);
        assertThat(saved.getValue().getVersion()).isEqualTo("v0.2");
        assertThat(saved.getValue().getSkillUrl()).isEqualTo(result.extSkill().getSkillUrl());
    }

    @ParameterizedTest
    @ValueSource(strings = {"version", "status", "tenant", "hash", "newTarget"})
    void reviewRejectsStaleOrChangedTargetWithoutReplacingOnlineContent(String change) {
        prepareImportSnapshotPersistence();
        SsResource original = prepareImportOriginal();
        var result = service.importSkillZip(new MockMultipartFile("file", "demo.zip", "application/zip",
            skillZipBytes("demo")), 10L, "enterprise", "SKILL_MANAGE_IMPORT");
        when(ssResExtSkillService.findById(8101L)).thenReturn(result.extSkill());
        SsResExtSkill ext = ssResExtSkillService.findById(7101L);
        switch (change) {
            case "version" -> ext.setVersion("v0.2");
            case "status" -> original.setResourceStatus(-1);
            case "tenant" -> original.setComAcctId(2L);
            case "hash" -> ext.setSkillPackageHash("changed");
            case "newTarget" -> when(ssResourceService.getResourceListByCode(List.of("demo"))).thenReturn(List.of());
        }
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        org.mockito.Mockito.clearInvocations(resourceArtifactStorageService, ssResourceService, ssResExtSkillService);
        assertThatThrownBy(() -> service.applySkillImportReview(result.resource(), true))
            .hasMessage("byclaw.skill.import.review.stale");
        verify(ssResourceService, never()).updateResourceEntity(any());
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
        org.mockito.Mockito.verifyNoInteractions(resourceArtifactStorageService);
    }

    @Test
    void rejectedImportKeepsOnlineVersionAndAllowsFreshSubmission() {
        prepareImportSnapshotPersistence();
        SsResource original = prepareImportOriginal();
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        var result = service.importSkillZip(file, 10L, "enterprise", "SKILL_MANAGE_IMPORT");
        String pendingCode = result.resource().getResourceCode();
        when(ssResExtSkillService.findById(8101L)).thenReturn(result.extSkill());
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        result.resource().setResourceStatus(5);
        org.mockito.Mockito.clearInvocations(resourceArtifactStorageService);
        service.applySkillImportReview(result.resource(), false);
        assertThat(result.resource().getResourceCode()).isEqualTo(pendingCode + "-8101");
        assertThat(original.getResourceStatus()).isEqualTo(2);
        verify(ssResourceService, never()).updateResourceEntity(original);
        org.mockito.Mockito.verifyNoInteractions(resourceArtifactStorageService);
        CurrentUserHolder.getLoginInfo().setUserCode("user001");
        when(ssResExtSkillService.findById(8101L)).thenReturn(null);
        assertThat(service.importSkillZip(file, 10L, "enterprise", "SKILL_MANAGE_IMPORT").resource().getResourceStatus())
            .isEqualTo(4);
    }

    @Test
    void personalNewImportRemainsAvailableWithoutPublicationReview() {
        prepareImportSnapshotPersistence();
        var result = service.importSkillZip(new MockMultipartFile("file", "demo.zip", "application/zip",
            skillZipBytes("demo")), 10L, "personal", "SKILL_MANAGE_IMPORT");
        assertThat(result.resource().getResourceStatus()).isEqualTo(2);
        assertThat(result.resource().getOwnerType()).isEqualTo("personal");
        verify(publications, never()).submit(any(), any());
    }

    @Test
    void batchRollsBackFailedPackageAndCommitsNextPackageIndependently() {
        prepareImportSnapshotPersistence();
        var first = new MockMultipartFile("file", "bad.zip", "application/zip", skillZipBytes("bad"));
        var second = new MockMultipartFile("file", "good.zip", "application/zip", skillZipBytes("good"));
        doThrow(new IllegalStateException("storage unavailable")).when(resourceArtifactStorageService)
            .uploadToSubdirectory(any(byte[].class), any(), eq("bad.zip"), eq("application/zip"));
        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {first, second},
            10L, "enterprise");
        assertThat(result.getFailed()).isEqualTo(1);
        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getItems().get(1).isReviewRequired()).isTrue();
        var transactions = (org.springframework.transaction.PlatformTransactionManager)
            ReflectionTestUtils.getField(service, "transactionManager");
        verify(transactions).rollback(any());
        verify(transactions).commit(any());
        verify(publications).submit(org.mockito.ArgumentMatchers.isNull(), any());
    }

    @Test
    void ordinaryImportCannotOverwriteAnotherTenantEvenWithManageCapability() {
        SsResource original = prepareImportOriginal();
        original.setComAcctId(2L);
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        assertThat(service.previewSkillZipImportConflicts(new org.springframework.web.multipart.MultipartFile[] {file},
            "enterprise").getFailed()).isEqualTo(1);
        assertThatThrownBy(() -> service.importSkillZip(file, 10L, "enterprise", "SKILL_MANAGE_IMPORT"))
            .hasMessage("byclaw.skill.enterprise.code.conflict");
        verify(ssResourceService, never()).saveResource(any());
        org.mockito.Mockito.verifyNoInteractions(resourceArtifactStorageService);
    }

    private void prepareImportSnapshotPersistence() {
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(8101L);
            resource.setComAcctId(1L);
            resource.setCreateBy(10001L);
            when(ssResourceService.findByIdForUpdate(8101L)).thenReturn(resource);
            return resource;
        });
    }

    private SsResource prepareImportOriginal() {
        SsResource original = new SsResource();
        original.setResourceId(7101L);
        original.setSystemCode("BYAI");
        original.setResourceBizType("SKILL");
        original.setOwnerType("enterprise");
        original.setResourceCode("demo");
        original.setResourceName("Original");
        original.setComAcctId(1L);
        original.setResourceStatus(2);
        when(ssResourceService.getResourceListByCode(List.of("demo"))).thenReturn(List.of(original));
        when(ssResourceService.findByIdForUpdate(7101L)).thenReturn(original);
        when(authApplicationService.hasResourceManagePermission(original)).thenReturn(true);
        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(7101L);
        ext.setVersion("v0.1");
        ext.setSkillPackageHash("original-hash");
        ext.setSkillUrl("/byclaw/resource/skill/org-hub/demo.zip");
        when(ssResExtSkillService.findById(7101L)).thenReturn(ext);
        return original;
    }

    @Test
    void centerMarkdownUpdatePreservesOtherFilesNestedSkillsAndExecutableModes() throws Exception {
        byte[] original;
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            ZipArchiveOutputStream zip = new ZipArchiveOutputStream(bytes)) {
            for (String name : List.of("demo/SKILL.md", "demo/scripts/run.sh", "demo/nested/child/SKILL.md")) {
                ZipArchiveEntry entry = new ZipArchiveEntry(name);
                entry.setUnixMode(name.endsWith(".sh") ? 0100755 : 0100644);
                zip.putArchiveEntry(entry);
                zip.write(("original:" + name).getBytes(StandardCharsets.UTF_8));
                zip.closeArchiveEntry();
            }
            zip.finish();
            original = bytes.toByteArray();
        }
        byte[] document = "---\nname: demo\n---\nnew content\n".getBytes(StandardCharsets.UTF_8);
        // 安装后的目录按包内根目录定位，不使用可能已变化的资源编码。
        assertThat(service.readCenterSkillDirectoryName(original, "workspace-scoped-code")).isEqualTo("demo");
        byte[] updated = service.replaceCenterSkillDocument(original, document);
        assertThat(service.readCenterSkillDocument(updated)).isEqualTo(document);
        try (var channel = new org.apache.commons.compress.utils.SeekableInMemoryByteChannel(updated);
            var zip = new org.apache.commons.compress.archivers.zip.ZipFile(channel)) {
            var script = zip.getEntry("demo/scripts/run.sh");
            assertThat(script.getUnixMode()).isEqualTo(0100755);
            try (var input = zip.getInputStream(script)) {
                assertThat(new String(input.readAllBytes(), StandardCharsets.UTF_8))
                    .isEqualTo("original:demo/scripts/run.sh");
            }
            try (var input = zip.getInputStream(zip.getEntry("demo/nested/child/SKILL.md"))) {
                assertThat(new String(input.readAllBytes(), StandardCharsets.UTF_8))
                    .isEqualTo("original:demo/nested/child/SKILL.md");
            }
        }
    }

    @Test
    void centerSaveCreatesScopedResourceAndBindsTheSourceEmployee() {
        byte[] bytes = skillZipBytes("demo");
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7101L);
            resource.setCreateBy(10001L);
            return resource;
        });
        var result = service.saveWorkspaceSkillCenterPackage(bytes, "personal", "workspace-scoped-demo", "demo", null, 9001L);
        assertThat(result.resource().getResourceCode()).isEqualTo("workspace-scoped-demo");
        assertThat(result.resource().getResourceName()).isEqualTo("demo");
        assertThat(result.resource().getOwnerType()).isEqualTo("personal");
        assertThat(result.resource().getCreateBy()).isEqualTo(10001L);
        verify(authApplicationService).ensureCreatorDefaultPrivileges(result.resource());
        verify(resourceArtifactStorageService).uploadToSubdirectory(eq(bytes),
            eq("skill/user001-hub/directory-sync/7101/" + DigestUtils.sha256Hex(bytes)),
            eq("demo.zip"), eq("application/zip"));
        var relation = org.mockito.ArgumentCaptor.forClass(SsResourceRelDetail.class);
        var order = org.mockito.Mockito.inOrder(ssResourceRelDetailService, digitalEmployeeApplicationService,
            digitalEmployeeRuntimeRefreshService);
        order.verify(ssResourceRelDetailService).save(relation.capture());
        assertThat(relation.getValue().getResourceId()).isEqualTo(9001L);
        assertThat(relation.getValue().getRelResourceId()).isEqualTo(7101L);
        order.verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
        order.verify(digitalEmployeeRuntimeRefreshService).scheduleSkillRuntimeRefreshAfterCommit(
            org.mockito.ArgumentMatchers.argThat(ids -> ids.contains(9001L)));
    }

    @Test
    void centerSaveDoesNotDuplicateAnExistingEmployeeBinding() {
        byte[] bytes = skillZipBytes("demo");
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7101L);
            resource.setCreateBy(10001L);
            return resource;
        });
        when(ssResourceRelDetailService.find(9001L, 7101L)).thenReturn(List.of(new SsResourceRelDetail()));
        service.saveWorkspaceSkillCenterPackage(bytes, "personal", "demo", "demo", null, 9001L);
        verify(ssResourceRelDetailService, never()).save(any(SsResourceRelDetail.class));
        verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
    }

    @Test
    void centerSaveUpdatesWithoutChangingExistingOwnershipOrStatus() {
        byte[] bytes = skillZipBytes("demo");
        SsResource target = new SsResource();
        target.setResourceId(7101L);
        target.setResourceCode("demo");
        target.setResourceName("Existing name");
        target.setOwnerType("enterprise");
        target.setResourceBizType("SKILL");
        target.setSystemCode("BYAI");
        target.setCreateBy(20002L);
        target.setCatalogId(99L);
        target.setResourceStatus(1);
        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(7101L);
        ext.setVersion("v0.1");
        ext.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(ssResExtSkillService.findById(7101L)).thenReturn(ext);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");
        when(ssResourceService.updateResourceEntity(target)).thenReturn(target);

        var result = service.saveWorkspaceSkillCenterPackage(bytes, "enterprise", "demo", "demo", target);
        assertThat(result.updated()).isTrue();
        assertThat(result.resource().getResourceId()).isEqualTo(7101L);
        assertThat(target.getResourceName()).isEqualTo("Existing name");
        assertThat(target.getOwnerType()).isEqualTo("enterprise");
        assertThat(target.getCreateBy()).isEqualTo(20002L);
        assertThat(target.getCatalogId()).isEqualTo(99L);
        assertThat(target.getResourceStatus()).isEqualTo(1);
        // 与现有导入覆盖一致，管理员覆盖内置技能后使用新的独立包。
        assertThat(result.extSkill().getSkillType()).isEqualTo(SsResExtSkillService.DEFAULT_SKILL_TYPE);
        assertThat(result.extSkill().getVersion()).isEqualTo("v0.2");
        verify(ssResourceService, never()).saveResource(any());
        verify(resourceArtifactStorageService).uploadToSubdirectory(eq(bytes),
            eq("skill/org-hub/directory-sync/7101/" + DigestUtils.sha256Hex(bytes)),
            eq("demo.zip"), eq("application/zip"));
    }

    @Test
    void centerComparisonReadsBuiltinDocumentFromActualPackage() {
        var exporter = mock(ByClawBuiltinSkillExportService.class);
        ReflectionTestUtils.setField(service, "builtinSkillExportService", exporter);
        SsResource resource = new SsResource();
        resource.setResourceId(7101L);
        resource.setResourceCode("demo");
        SsResExtSkill ext = new SsResExtSkill();
        ext.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);
        when(ssResExtSkillService.findById(7101L)).thenReturn(ext);
        byte[] bytes = skillZipBytes("demo");
        when(exporter.exportPackage("user001", "demo")).thenReturn(bytes);
        assertThat(service.readCenterSkillPackage(resource)).isEqualTo(bytes);
        assertThat(new String(service.readCenterSkillDocument(bytes), StandardCharsets.UTF_8))
            .contains("## demo");
        org.mockito.Mockito.verifyNoInteractions(resourceArtifactStorageService);
    }

    @Test
    void personalDirectoryResourceizationDoesNotBindOrValidateDefaultEmployee() throws Exception {
        var query = mock(ByClawSkillQueryApplicationService.class);
        var paths = mock(ByClawSkillPathResolver.class);
        var files = mock(com.iwhalecloud.byai.common.storage.UserFS.class);
        ReflectionTestUtils.setField(service, "personalSkillQueryService", query);
        ReflectionTestUtils.setField(service, "skillPathResolver", paths);
        ReflectionTestUtils.setField(service, "userFS", files);
        String root = "/.openclaw/workspace/skills/";
        String path = root + "demo-skill";
        when(query.resolveMySkillSource(path)).thenReturn(null);
        when(paths.resolveSkillRootPrefix("user001", null)).thenReturn(root);
        when(files.list(path + "/", null)).thenReturn(List.of(path + "/SKILL.md"));
        when(files.read(path + "/SKILL.md")).thenAnswer(invocation -> new java.io.ByteArrayInputStream(
            "---\nname: demo-skill\ndescription: Demo\n---\nBody".getBytes(StandardCharsets.UTF_8)));
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7101L);
            resource.setCreateBy(10001L);
            return resource;
        });

        var result = service.resourceizeMyDirectorySkill(path, false);
        assertThat(result.resource().getOwnerType()).isEqualTo("personal");
        assertThat(result.resource().getCreateBy()).isEqualTo(10001L);
        verify(authApplicationService).ensureCreatorDefaultPrivileges(result.resource());
        verify(authApplicationService, never()).hasResourceInstallTargetManagePermission(any());
        org.mockito.Mockito.verifyNoInteractions(digitalEmployeeApplicationService, ssResourceRelDetailService);
        verify(paths, never()).resolveSkillRootPrefix("user001", 9001L);

        // 同码企业资源即使可管理，也不能被个人目录资源化覆盖。
        SsResource enterprise = new SsResource();
        enterprise.setResourceId(8001L);
        enterprise.setResourceCode("demo-skill");
        enterprise.setResourceBizType("SKILL");
        enterprise.setSystemCode("BYAI");
        enterprise.setOwnerType("enterprise");
        enterprise.setCreateBy(10001L);
        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of(enterprise));
        when(authApplicationService.hasResourceManagePermission(enterprise)).thenReturn(true);
        assertThatThrownBy(() -> service.resourceizeMyDirectorySkill(path, true))
            .isInstanceOf(IllegalArgumentException.class);
        verify(ssResourceService, times(1)).saveResource(any(SsResource.class));
        verify(ssResourceService, never()).updateResourceEntity(enterprise);
    }

    @Test
    void publishEnterpriseStoresIndependentRenamedPackage() throws Exception {
        SsResource source = prepareEnterpriseCopy();
        SsResExtSkill sourceExt = ssResExtSkillService.findById(7001L);
        sourceExt.setSyncStatus("SUCCESS");
        sourceExt.setSkillPackageSize(123L);
        sourceExt.setSkillPackageHash("source-hash");
        sourceExt.setSkillOriginalFilename("personal-skill.zip");
        var result = service.publishSkillToEnterprise(7001L);

        assertThat(result.alreadyExists()).isFalse();
        SsResource target = result.resource();
        assertThat(target.getResourceId()).isEqualTo(7101L);
        assertThat(target.getResourceCode()).isEqualTo("enterprise-skill-7001");
        assertThat(target.getOwnerType()).isEqualTo("enterprise");
        assertThat(target.getResourceStatus()).isEqualTo(4);
        verify(publications).submit(source, target);
        assertThat(target.getResourceName()).isEqualTo(enterpriseName(source.getResourceName()));
        verify(ssResourceService).existsEnterpriseSkillByName(enterpriseName(source.getResourceName()));
        assertThat(target.getAvatar()).isEqualTo("skill-logo");
        assertThat(target.getCatalogId()).isEqualTo(10L);
        assertThat(source.getOwnerType()).isEqualTo("personal");
        assertThat(source.getResourceName()).isEqualTo("Personal skill");
        verify(ssResourceService, never()).updateResourceEntity(source);
        verify(authApplicationService).ensureCreatorDefaultPrivileges(target);
        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        SsResExtSkill copy = extCaptor.getValue();
        assertThat(copy).isNotSameAs(sourceExt);
        assertThat(copy.getResourceId()).isEqualTo(7101L);
        assertThat(sourceExt.getResourceId()).isEqualTo(7001L);
        assertThat(copy.getSkillUrl()).isEqualTo("/byclaw/resource/skill/org-hub/7101/personal-skill.zip");
        assertThat(copy.getVersion()).isEqualTo("v0.3");
        byte[] uploaded = assertPublishedPackageName(target.getResourceName());
        assertThat(copy.getSkillPackageSize()).isEqualTo((long)uploaded.length);
        assertThat(copy.getSkillPackageHash()).isEqualTo(DigestUtils.sha256Hex(uploaded));
        assertThat(sourceExt.getSkillUrl()).isEqualTo("/byclaw/resource/skill/user002-hub/personal-skill.zip");
        assertThat(sourceExt.getSkillPackageHash()).isEqualTo("source-hash");
        assertThat(sourceExt.getSkillPackageSize()).isEqualTo(123L);
        assertThat(copy.getSkillOriginalFilename()).isEqualTo("personal-skill.zip");
        assertThat(copy.getSyncStatus()).isEqualTo("SUCCESS");
        var json = com.alibaba.fastjson2.JSON.parseObject(copy.getTargetContent());
        assertThat(json.getString("sourceResourceId")).isEqualTo("7001");
        assertThat(json.getString("sourceCreatorId")).isEqualTo("10002");
        assertThat(json.getString("ownerType")).isEqualTo("enterprise");
        assertThat(json.getString("skillUrl")).endsWith("skillId=7101");
        verify(ssResourceArtifactService).upsertArtifact(eq(7101L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.IMPORT_ZIP.name()), eq("minio"),
            eq("skill/org-hub/7101/personal-skill.zip"), any());
        verify(resourceArtifactStorageService).readWithinResourceRoot("skill/user002-hub/personal-skill.zip");
    }

    @Test
    void publicationWarnsAboutPersonalDependenciesButCopiesOnlyEnterpriseDependencies() throws Exception {
        prepareEnterpriseCopy();
        SsResource personal = new SsResource();
        personal.setResourceId(8001L);
        personal.setResourceName("个人知识");
        personal.setResourceBizType("KG_DOC");
        personal.setOwnerType("personal");
        SsResource enterprise = new SsResource();
        enterprise.setResourceId(8002L);
        enterprise.setResourceBizType("TOOLKIT");
        enterprise.setOwnerType("enterprise");
        SsResourceRelDetail personalRel = new SsResourceRelDetail();
        personalRel.setResourceId(7001L);
        personalRel.setRelResourceId(8001L);
        SsResourceRelDetail enterpriseRel = new SsResourceRelDetail();
        enterpriseRel.setResourceId(7001L);
        enterpriseRel.setRelResourceId(8002L);
        SsResource employee = new SsResource();
        employee.setResourceId(8003L);
        employee.setResourceName("个人数字员工");
        employee.setResourceBizType("DIG_EMPLOYEE");
        employee.setOwnerType("personal_default");
        SsResource tool = new SsResource();
        tool.setResourceId(8004L);
        tool.setResourceName("个人工具");
        tool.setResourceBizType("MCP");
        tool.setOwnerType("personal");
        // 数字员工安装技能是反向关联，也必须纳入提醒。
        SsResourceRelDetail employeeRel = new SsResourceRelDetail();
        employeeRel.setResourceId(8003L);
        employeeRel.setRelResourceId(7001L);
        SsResourceRelDetail toolRel = new SsResourceRelDetail();
        toolRel.setResourceId(7001L);
        toolRel.setRelResourceId(8004L);
        when(ssResourceRelDetailService.list(any(LambdaQueryWrapper.class)))
            .thenReturn(List.of(personalRel, enterpriseRel, employeeRel, toolRel));
        when(ssResourceService.findByIdList(List.of(8001L, 8002L, 8004L)))
            .thenReturn(List.of(personal, enterprise, tool));
        when(ssResourceService.findByIdList(List.of(8001L, 8002L, 8003L, 8004L)))
            .thenReturn(List.of(personal, enterprise, employee, tool));

        var result = service.publishSkillToEnterprise(7001L);

        assertThat(result.personalDependencies()).extracting(
            ByClawSkillResourceApplicationService.PublicationDependency::resourceName)
            .containsExactly("个人知识", "个人数字员工", "个人工具");
        assertThat(result.resource().getResourceStatus()).isEqualTo(4);
        ArgumentCaptor<SsResourceRelDetail> relation = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(ssResourceRelDetailService).save(relation.capture());
        assertThat(relation.getValue().getResourceId()).isEqualTo(7101L);
        assertThat(relation.getValue().getRelResourceId()).isEqualTo(8002L);
    }

    @Test
    void publishEnterpriseAppendsPublisherNameWhenEnterpriseSkillNameExists() throws Exception {
        SsResource source = prepareEnterpriseCopy();
        source.setResourceName("技能1");
        CurrentUserHolder.getLoginInfo().setUserName("张三");
        when(ssResourceService.existsEnterpriseSkillByName(enterpriseName("技能1"))).thenReturn(true);
        var result = service.publishSkillToEnterprise(7001L);
        assertThat(result.resource().getResourceName()).isEqualTo(enterpriseName("技能1（张三）"));
        assertThat(source.getResourceName()).isEqualTo("技能1");
        verify(ssResourceService).existsEnterpriseSkillByName(enterpriseName("技能1"));
        ArgumentCaptor<SsResExtSkill> extension = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extension.capture());
        assertThat(extension.getValue().getTargetContent()).contains(enterpriseName("技能1（张三）"));
    }

    @Test
    void publishEnterpriseFallsBackToPublisherAccountWhenDisplayNameIsMissing() throws Exception {
        SsResource source = prepareEnterpriseCopy();
        when(ssResourceService.existsEnterpriseSkillByName(enterpriseName(source.getResourceName()))).thenReturn(true);
        var result = service.publishSkillToEnterprise(7001L);
        assertThat(result.resource().getResourceName()).isEqualTo(enterpriseName(source.getResourceName() + "（user001）"));
    }

    @ParameterizedTest
    @CsvSource({
        "zh-CN, 技能1, 技能1(企业)",
        "zh-CN, 技能1(企业), 技能1(企业)",
        "en-US, Skill one (Enterprise), Skill one (Enterprise)",
        "en-US, 技能1(企业), 技能1(企业)",
        "en-US, Skill one, Skill one (Enterprise)"
    })
    void publishEnterpriseLocalizesNameInResourceAndMetadata(String language, String sourceName, String expectedName)
        throws Exception {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        SsResource source = prepareEnterpriseCopy();
        source.setResourceName(sourceName);

        var result = service.publishSkillToEnterprise(7001L);

        assertThat(result.resource().getResourceName()).isEqualTo(expectedName);
        assertThat(source.getResourceName()).isEqualTo(sourceName);
        verify(ssResourceService).existsEnterpriseSkillByName(expectedName);
        ArgumentCaptor<SsResExtSkill> extension = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extension.capture());
        assertThat(com.alibaba.fastjson2.JSON.parseObject(extension.getValue().getTargetContent())
            .getString("resourceName")).isEqualTo(expectedName);
        assertPublishedPackageName(expectedName);
    }

    @ParameterizedTest
    @CsvSource({
        "zh-CN, 技能1, 技能1(企业), 技能1（张三）(企业)",
        "zh-CN, 技能1, 技能1, 技能1（张三）(企业)",
        "zh-CN, 技能1(企业), 技能1(企业), 技能1（张三）(企业)",
        "en-US, Skill one, Skill one (Enterprise), Skill one（张三） (Enterprise)",
        "en-US, Skill one, Skill one, Skill one（张三） (Enterprise)"
    })
    void publishEnterpriseChecksNameWithSuffixForConflicts(String language, String sourceName, String existingName,
        String expectedName) throws Exception {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        SsResource source = prepareEnterpriseCopy();
        source.setResourceName(sourceName);
        CurrentUserHolder.getLoginInfo().setUserName("张三");
        when(ssResourceService.existsEnterpriseSkillByName(existingName)).thenReturn(true);

        assertThat(service.publishSkillToEnterprise(7001L).resource().getResourceName()).isEqualTo(expectedName);
        assertThat(source.getResourceName()).isEqualTo(sourceName);
        assertPublishedPackageName(expectedName);
    }

    @Test
    void publishEnterpriseReusesExistingSnapshotWithoutRevalidatingChangedSourcePackage() throws Exception {
        prepareEnterpriseCopy();
        SsResource existing = enterpriseCopy(7102L, 3);
        existing.setResourceName("Personal skill（企业）");
        LocaleContextHolder.setLocale(Locale.US);
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill-7001"))).thenReturn(List.of(existing));
        var result = service.publishSkillToEnterprise(7001L);
        assertThat(result.alreadyExists()).isTrue();
        assertThat(result.resource()).isSameAs(existing);
        assertThat(existing.getResourceStatus()).isEqualTo(3);
        assertThat(existing.getResourceName()).isEqualTo("Personal skill（企业）");
        verify(ssResourceService, never()).saveResource(any());
        verify(resourceArtifactStorageService, never()).readWithinResourceRoot("skill/user002-hub/personal-skill.zip");
        verify(resourceArtifactStorageService, never()).uploadToSubdirectory(any(), any(), any(), any());
    }

    @Test
    void pendingPublicationReusesSnapshotWithoutAnotherRequest() throws Exception {
        prepareEnterpriseCopy();
        SsResource pending = enterpriseCopy(7102L, 4);
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill-7001"))).thenReturn(List.of(pending));
        var result = service.publishSkillToEnterprise(7001L);
        assertThat(result.alreadyExists()).isTrue();
        assertThat(result.resource()).isSameAs(pending);
        verifyNoPublicationCreated();
    }

    private void verifyNoPublicationCreated() {
        verify(publications, never()).submit(any(), any());
        verify(ssResourceService, never()).saveResource(any());
    }

    @Test
    void rejectedPublicationResubmitsCurrentSourceAsNewSnapshot() throws Exception {
        prepareEnterpriseCopy();
        SsResource rejected = enterpriseCopy(7102L, 5);
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill-7001"))).thenReturn(List.of(rejected));
        var result = service.publishSkillToEnterprise(7001L);
        assertThat(result.resource().getResourceCode()).isEqualTo("enterprise-skill-7001-2");
        assertThat(result.resource().getResourceStatus()).isEqualTo(4);
        assertThat(rejected.getResourceStatus()).isEqualTo(5);
        verify(publications).submit(any(), eq(result.resource()));
    }

    @Test
    void rejectedPublicationCannotResubmitAnUnreadableCurrentPackage() throws Exception {
        prepareEnterpriseCopy();
        SsResource rejected = enterpriseCopy(7102L, 5);
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill-7001"))).thenReturn(List.of(rejected));
        when(resourceArtifactStorageService.readWithinResourceRoot("skill/user002-hub/personal-skill.zip"))
            .thenThrow(new IllegalStateException("Package unavailable"));
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessageContaining("技能包不存在或无法读取");
        verifyNoPublicationCreated();
        assertThat(rejected.getResourceStatus()).isEqualTo(5);
    }

    @Test
    void publishEnterpriseDoesNotReviveDeregisteredCopy() throws Exception {
        prepareEnterpriseCopy();
        SsResource deleted = enterpriseCopy(7102L, -1);
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill-7001"))).thenReturn(List.of(deleted));
        var result = service.publishSkillToEnterprise(7001L);
        assertThat(result.resource().getResourceCode()).isEqualTo("enterprise-skill-7001-2");
        assertThat(deleted.getResourceStatus()).isEqualTo(-1);
        verify(ssResourceService, never()).updateResourceEntity(deleted);
    }

    @Test
    void publishEnterpriseRejectsUnauthorizedAndMissingResourceBeforeStorageAccess() {
        assertThatThrownBy(() -> service.publishSkillToEnterprise(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessage("byclaw.skill.enterprise.no.permission");
        verify(ssResourceService, never()).saveResource(any());
        verify(resourceArtifactStorageService, never()).readWithinResourceRoot(any());
    }

    @Test
    void publishEnterpriseRejectsMissingPackageStream() throws Exception {
        prepareEnterpriseCopy();
        when(resourceArtifactStorageService.readWithinResourceRoot(any())).thenReturn(null);
        assertUnreadablePublicationPackage();
    }

    @Test
    void publishEnterpriseRejectsStorageReadFailure() throws Exception {
        prepareEnterpriseCopy();
        when(resourceArtifactStorageService.readWithinResourceRoot(any()))
            .thenThrow(new IllegalStateException("Storage unavailable"));
        assertUnreadablePublicationPackage();
    }

    @Test
    void publishEnterpriseRejectsMissingExtensionRecord() throws Exception {
        prepareEnterpriseCopy();
        when(ssResExtSkillService.findById(7001L)).thenReturn(null);
        assertUnreadablePublicationPackage();
    }

    @Test
    void publishEnterpriseRejectsBlankPackageUrl() throws Exception {
        prepareEnterpriseCopy();
        when(ssResExtSkillService.findById(7001L)).thenReturn(new SsResExtSkill());
        assertUnreadablePublicationPackage();
    }

    @Test
    void publishEnterpriseRejectsCorruptPackage() throws Exception {
        prepareEnterpriseCopy();
        when(resourceArtifactStorageService.readWithinResourceRoot(any()))
            .thenReturn(new java.io.ByteArrayInputStream(new byte[] {1, 2, 3}));
        assertUnreadablePublicationPackage();
    }

    private void assertUnreadablePublicationPackage() {
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("技能包不存在或无法读取");
        verifyNoPublicationCreated();
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
        verify(resourceArtifactStorageService, never()).uploadToSubdirectory(any(), any(), any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "personal-skill/"})
    void publicationAllowsEnterpriseManifestDependenciesAtEitherSkillRoot(String root) throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest(root, """
            {"resources":[{"resourceId":"2001","resourceType":"TOOL"},
                          {"resourceId":3001,"resourceType":"KNOWLEDGE_BASE"},
                          {"resourceId":"2001","resourceType":"TOOL"}]}
            """);
        var tool = publicationResource(2001L, "TOOL", "enterprise", "企业工具");
        var knowledge = publicationResource(3001L, "KG_DOC", "enterprise", "企业知识");
        when(ssResourceService.findByIdList(java.util.Set.of(2001L, 3001L)))
            .thenReturn(List.of(tool, knowledge));

        var result = service.publishSkillToEnterprise(7001L);

        assertThat(result.resource().getResourceStatus()).isEqualTo(4);
        verify(publications).submit(any(), eq(result.resource()));
        verify(ssResourceService).findByIdList(java.util.Set.of(2001L, 3001L));
    }

    @Test
    void publicationAllowsEmptyManifestResources() throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest("", "{\"resources\":[]}");
        var result = service.publishSkillToEnterprise(7001L);
        verify(publications).submit(any(), eq(result.resource()));
        verify(ssResourceService, never()).findByIdList(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM", "KG_CLOUD"})
    void publicationAllowsAllSupportedEnterpriseDependencyTypes(String type) throws Exception {
        prepareEnterpriseCopy();
        String declaredType = type.startsWith("KG_") ? "KNOWLEDGE_BASE" : "TOOL";
        stubPublicationManifest("", "{\"resources\":[{\"resourceId\":2001,\"resourceType\":\"" + declaredType + "\"}]}");
        when(ssResourceService.findByIdList(java.util.Set.of(2001L)))
            .thenReturn(List.of(publicationResource(2001L, type, "enterprise", "企业资源")));
        var result = service.publishSkillToEnterprise(7001L);
        verify(publications).submit(any(), eq(result.resource()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"personal", "personal_default"})
    void publicationListsEveryPersonalDependencyAndDoesNotWrite(String owner) throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest("personal-skill/", """
            {"resources":[{"resourceId":"2001","resourceType":"TOOL"},
                          {"resourceId":"3001","resourceType":"KNOWLEDGE_BASE"}]}
            """);
        when(ssResourceService.findByIdList(java.util.Set.of(2001L, 3001L)))
            .thenReturn(List.of(publicationResource(2001L, "MCP", owner, "订单查询"),
                publicationResource(3001L, "KG_DOC", owner, "产品资料")));

        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessageContaining("个人工具「订单查询」（code：resource-2001，ID：2001，类型：MCP，归属：")
            .hasMessageContaining("个人知识库「产品资料」（code：resource-3001，ID：3001，类型：KG_DOC，归属：");
        verifyPublicationRejectedBeforeWrites();
    }

    @Test
    void publicationRejectsOnePersonalResourceAmongEnterpriseDependencies() throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest("", """
            {"resources":[{"resourceId":"2001","resourceType":"TOOL"},
                          {"resourceId":"3001","resourceType":"KNOWLEDGE_BASE"}]}
            """);
        when(ssResourceService.findByIdList(java.util.Set.of(2001L, 3001L)))
            .thenReturn(List.of(publicationResource(2001L, "TOOL", "enterprise", "企业工具"),
                publicationResource(3001L, "KG_DB", "personal", "个人数据")));
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessageContaining("个人知识库「个人数据」（code：resource-3001，ID：3001，类型：KG_DB，归属：personal）")
            .hasMessageNotContaining("企业工具");
        verifyPublicationRejectedBeforeWrites();
    }

    @ParameterizedTest
    @ValueSource(strings = {"deleted", "other-enterprise", "type-mismatch"})
    void publicationStillBlocksKnownPersonalResources(String scenario) throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest("", "{\"resources\":[{\"resourceId\":2001,\"resourceType\":\"TOOL\"}]}");
        var resource = publicationResource(2001L, "MCP", "personal", "个人查询工具");
        if ("deleted".equals(scenario)) resource.setResourceStatus(-1);
        if ("other-enterprise".equals(scenario)) resource.setComAcctId(2L);
        if ("type-mismatch".equals(scenario)) resource.setResourceBizType("KG_DOC");
        when(ssResourceService.findByIdList(java.util.Set.of(2001L))).thenReturn(List.of(resource));
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessageContaining("个人查询工具").hasMessageContaining("code：resource-2001")
            .hasMessageContaining("ID：2001").hasMessageContaining("类型：" + resource.getResourceBizType())
            .hasMessageContaining("归属：personal");
        verifyPublicationRejectedBeforeWrites();
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "deleted", "other-enterprise", "type-mismatch", "unknown-owner"})
    void publicationAllowsDependenciesUnlessTheyAreKnownPersonalResources(String scenario) throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest("", "{\"resources\":[{\"resourceId\":2001,\"resourceType\":\"TOOL\"}]}");
        var resource = publicationResource(2001L, "TOOL", "enterprise", "依赖资源");
        if ("deleted".equals(scenario)) resource.setResourceStatus(-1);
        if ("other-enterprise".equals(scenario)) resource.setComAcctId(2L);
        if ("type-mismatch".equals(scenario)) resource.setResourceBizType("KG_DOC");
        if ("unknown-owner".equals(scenario)) resource.setOwnerType(null);
        when(ssResourceService.findByIdList(java.util.Set.of(2001L)))
            .thenReturn("missing".equals(scenario) ? List.of() : List.of(resource));

        var result = service.publishSkillToEnterprise(7001L);
        verify(publications).submit(any(), eq(result.resource()));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "", "{", "null", "[]", "{}", "{\"resources\":null}", "{\"resources\":{}}",
        "{\"resources\":[null]}", "{\"resources\":[{}]}",
        "{\"resources\":[{\"resourceId\":\"abc\",\"resourceType\":\"TOOL\"}]}",
        "{\"resources\":[{\"resourceId\":-1,\"resourceType\":\"TOOL\"}]}",
        "{\"resources\":[{\"resourceId\":0,\"resourceType\":\"TOOL\"}]}",
        "{\"resources\":[{\"resourceId\":1.5,\"resourceType\":\"TOOL\"}]}",
        "{\"resources\":[{\"resourceId\":\"9223372036854775808\",\"resourceType\":\"TOOL\"}]}",
        "{\"resources\":[{\"resourceId\":2001,\"resourceType\":\"SKILL\"}]}",
        "{\"resources\":[],\"resources\":[]}", "{\"resources\":[]} {}",
        "{\"resources\":[{\"resourceId\":2001,\"resourceType\":\"TOOL\"},"
            + "{\"resourceId\":2001,\"resourceType\":\"KNOWLEDGE_BASE\"}]}"
    })
    void publicationRejectsMalformedManifestInsteadOfTreatingItAsNoDependencies(String manifest) throws Exception {
        prepareEnterpriseCopy();
        stubPublicationManifest("", manifest);
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessageContaining("references/resourceMate.json 格式错误");
        verifyPublicationRejectedBeforeWrites();
        verify(ssResourceService, never()).findByIdList(any());
    }

    private void verifyPublicationRejectedBeforeWrites() {
        verifyNoPublicationCreated();
        verify(ssResourceService, never()).updateResourceEntity(any());
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
        verify(ssResourceRelDetailService, never()).save(any());
        verify(authApplicationService, never()).ensureCreatorDefaultPrivileges(any());
        org.mockito.Mockito.verifyNoInteractions(ssResourceArtifactService);
    }

    private SsResource publicationResource(Long id, String type, String owner, String name) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setResourceBizType(type);
        resource.setOwnerType(owner);
        resource.setResourceName(name);
        resource.setResourceCode("resource-" + id);
        resource.setComAcctId(1L);
        resource.setResourceStatus(2);
        return resource;
    }

    private void stubPublicationManifest(String root, String manifest) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry(root + "SKILL.md"));
            zip.write("# Personal skill".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry(root + "references/resourceMate.json"));
            zip.write(manifest.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        when(resourceArtifactStorageService.readWithinResourceRoot("skill/user002-hub/personal-skill.zip"))
            .thenAnswer(invocation -> new java.io.ByteArrayInputStream(out.toByteArray()));
    }

    @Test
    void publishEnterpriseRejectsUnrelatedCodeCollision() throws Exception {
        prepareEnterpriseCopy();
        SsResource collision = enterpriseCopy(7102L, 2);
        SsResExtSkill unrelated = new SsResExtSkill();
        unrelated.setTargetContent("{}");
        when(ssResExtSkillService.findById(7102L)).thenReturn(unrelated);
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill-7001")))
            .thenReturn(List.of(collision));
        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .hasMessage("byclaw.skill.enterprise.code.conflict");
        verify(ssResourceService, never()).saveResource(any());
        verify(ssResourceService, never()).updateResourceEntity(any());
    }

    @Test
    void enterpriseCopyUpdatesKeepIsolatedStorageAndSourceProvenance() throws Exception {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        prepareEnterpriseCopy();
        SsResource target = service.publishSkillToEnterprise(7001L).resource();
        // 本用例覆盖审核通过后的企业副本更新，不允许审核中快照被导入覆盖。
        target.setResourceStatus(2);
        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        SsResExtSkill ext = extCaptor.getValue();
        when(ssResExtSkillService.findById(7101L)).thenReturn(ext);
        when(ssResourceService.getResourceListByCode(List.of(target.getResourceCode()))).thenReturn(List.of(target));
        when(authApplicationService.hasResourceManagePermission(target)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(target)).thenReturn(target);
        MockMultipartFile update = new MockMultipartFile("file", "updated.zip", "application/zip",
            skillZipBytes(target.getResourceCode()));

        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        service.importSkillZip(update, 10L, "enterprise", "SKILL_MANAGE_IMPORT");

        assertThat(ext.getSkillUrl()).isEqualTo("/byclaw/resource/skill/org-hub/7101/updated.zip");
        assertThat(com.alibaba.fastjson2.JSON.parseObject(ext.getTargetContent()).getString("sourceResourceId"))
            .isEqualTo("7001");
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class),
            eq("skill/org-hub/7101"), eq("updated.zip"), eq("application/zip"));
        verify(ssResourceService, never()).updateResourceEntity(org.mockito.ArgumentMatchers.argThat(
            resource -> resource != null && Long.valueOf(7001L).equals(resource.getResourceId())));
    }

    @Test
    void publicationDoesNotSubmitAuditWhenIndependentPackageUploadFails() throws Exception {
        prepareEnterpriseCopy();
        org.mockito.Mockito.doThrow(new IllegalStateException("Upload unavailable"))
            .when(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), any(), any(), any());

        assertThatThrownBy(() -> service.publishSkillToEnterprise(7001L))
            .isInstanceOf(IllegalStateException.class).hasMessage("Upload unavailable");
        verify(publications, never()).submit(any(), any());
        verify(ssResExtSkillService, never()).saveOrUpdate(any());
        org.mockito.Mockito.verifyNoInteractions(ssResourceArtifactService);
        assertThat(ssResExtSkillService.findById(7001L).getSkillUrl())
            .isEqualTo("/byclaw/resource/skill/user002-hub/personal-skill.zip");
    }

    /** 验证发布上传的真实 ZIP，而不只断言资源展示名。 */
    private byte[] assertPublishedPackageName(String expectedName) {
        ArgumentCaptor<byte[]> uploaded = ArgumentCaptor.forClass(byte[].class);
        verify(resourceArtifactStorageService).uploadToSubdirectory(uploaded.capture(), eq("skill/org-hub/7101"),
            any(String.class), eq("application/zip"));
        String document = new String(service.readCenterSkillDocument(uploaded.getValue()), StandardCharsets.UTF_8);
        assertThat(document).contains("name: " + com.alibaba.fastjson2.JSON.toJSONString(expectedName) + "\n");
        return uploaded.getValue();
    }

    @ParameterizedTest
    @CsvSource({"zh-CN, demo/skill.md", "en-US, SKILL.md"})
    void publicationChangesOnlyRootDocumentNameAndPreservesPackageContents(String language, String documentPath)
        throws Exception {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        SsResource source = prepareEnterpriseCopy();
        source.setResourceName("Skill: \"quoted\"");
        String originalDocument = "---\nname: old-name\ndescription: Keep description\nmetadata:\n  name: nested\n---\n# Keep body\n";
        String prefix = documentPath.contains("/") ? "demo/" : "";
        byte[] original;
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            ZipArchiveOutputStream zip = new ZipArchiveOutputStream(bytes)) {
            for (String path : List.of(documentPath, prefix + "scripts/run.sh", prefix + "nested/child/SKILL.md")) {
                ZipArchiveEntry entry = new ZipArchiveEntry(path);
                entry.setUnixMode(path.endsWith(".sh") ? 0100755 : 0100644);
                zip.putArchiveEntry(entry);
                zip.write((path.equals(documentPath) ? originalDocument : "keep:" + path).getBytes(StandardCharsets.UTF_8));
                zip.closeArchiveEntry();
            }
            zip.finish();
            original = bytes.toByteArray();
        }
        when(resourceArtifactStorageService.readWithinResourceRoot("skill/user002-hub/personal-skill.zip"))
            .thenAnswer(invocation -> new java.io.ByteArrayInputStream(original));

        SsResource target = service.publishSkillToEnterprise(7001L).resource();
        byte[] uploaded = assertPublishedPackageName(target.getResourceName());
        String document = new String(service.readCenterSkillDocument(uploaded), StandardCharsets.UTF_8);
        assertThat(document).doesNotContain("name: old-name")
            .contains("description: Keep description\nmetadata:\n  name: nested\n---\n# Keep body\n");
        assertThat(new String(service.readCenterSkillDocument(original), StandardCharsets.UTF_8))
            .isEqualTo(originalDocument);
        try (var channel = new org.apache.commons.compress.utils.SeekableInMemoryByteChannel(uploaded);
            var zip = new org.apache.commons.compress.archivers.zip.ZipFile(channel)) {
            assertThat(zip.getEntry(prefix + "scripts/run.sh").getUnixMode()).isEqualTo(0100755);
            for (String path : List.of(prefix + "scripts/run.sh", prefix + "nested/child/SKILL.md")) {
                try (var input = zip.getInputStream(zip.getEntry(path))) {
                    assertThat(new String(input.readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("keep:" + path);
                }
            }
        }
    }

    private String enterpriseName(String name) {
        return com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationNames.enterpriseName(name, null);
    }

    private SsResource enterpriseCopy(Long id, int status) {
        SsResource existing = new SsResource();
        existing.setResourceId(id);
        existing.setSystemCode("BYAI");
        existing.setResourceBizType("SKILL");
        existing.setOwnerType("enterprise");
        existing.setResourceStatus(status);
        SsResExtSkill ext = new SsResExtSkill();
        ext.setTargetContent("{\"sourceResourceId\":\"7001\"}");
        when(ssResExtSkillService.findById(id)).thenReturn(ext);
        return existing;
    }

    private SsResource prepareEnterpriseCopy() throws Exception {
        SsResource source = new SsResource();
        source.setResourceId(7001L);
        source.setResourceBizType("SKILL");
        source.setResourceCode("personal-skill");
        source.setResourceName("Personal skill");
        source.setResourceDesc("Current edited description");
        source.setOwnerType("personal");
        source.setResourceStatus(2);
        source.setCatalogId(10L);
        source.setAvatar("skill-logo");
        source.setCreateBy(10002L);
        when(ssResourceService.findByIdForUpdate(7001L)).thenReturn(source);
        when(authApplicationService.canPublishSkillToEnterprise(source)).thenReturn(true);
        when(ssResourceService.saveResource(any())).thenAnswer(invocation -> {
            SsResource target = invocation.getArgument(0);
            target.setResourceId(7101L);
            return target;
        });
        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(7001L);
        ext.setSkillType("hub");
        ext.setSkillUrl("/byclaw/resource/skill/user002-hub/personal-skill.zip");
        ext.setVersion("v0.3");
        when(ssResExtSkillService.findById(7001L)).thenReturn(ext);
        // 默认包没有依赖声明，继续覆盖原有复制、命名、幂等和审核行为。
        when(resourceArtifactStorageService.readWithinResourceRoot("skill/user002-hub/personal-skill.zip"))
            .thenAnswer(invocation -> new java.io.ByteArrayInputStream(skillZipBytes("personal-skill")));
        return source;
    }

    @Test
    void unlinkWorkspaceSkillSchedulesRefreshAfterRemovingRelation() {
        SsResource employee = new SsResource(); employee.setResourceId(1001L); employee.setResourceBizType("DIG_EMPLOYEE");
        when(ssResourceService.findById(anyLong())).thenReturn(employee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(employee)).thenReturn(true);
        SsResource skill = new SsResource();
        skill.setResourceId(7001L);
        skill.setResourceBizType("SKILL");
        skill.setOwnerType(OwnerType.PERSONAL);
        skill.setCreateBy(10001L);
        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of(skill));

        service.unlinkWorkspaceSkill("user001", 9001L,
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill", "demo-skill");

        InOrder order = inOrder(ssResourceRelDetailService,
            digitalEmployeeApplicationService, digitalEmployeeRuntimeRefreshService);
        order.verify(ssResourceRelDetailService).remove(any(LambdaQueryWrapper.class));
        order.verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
        order.verify(digitalEmployeeRuntimeRefreshService).scheduleDigitalEmployeeUpdateRefreshAfterCommit(9001L, null);
        verify(digitalEmployeeApplicationService, never()).synOpenClawWorkSpace(any());
    }

    @Test
    void unlinkWorkspaceSkillWithoutResourceStillSchedulesRefreshForDefaultEmployee() {
        SsResource employee = new SsResource(); employee.setResourceId(1001L); employee.setResourceBizType("DIG_EMPLOYEE");
        when(ssResourceService.findById(anyLong())).thenReturn(employee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(employee)).thenReturn(true);
        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of());

        service.unlinkWorkspaceSkill("user001", null,
            "/.openclaw/workspace/skills/demo-skill", null);

        verify(ssResourceRelDetailService, never()).remove(any(LambdaQueryWrapper.class));
        verify(digitalEmployeeApplicationService, never()).rebuildAndSaveDigitalEmployeeRelSkills(any());
        verify(digitalEmployeeApplicationService, never()).synOpenClawWorkSpace(any());
        verify(digitalEmployeeRuntimeRefreshService).scheduleDigitalEmployeeUpdateRefreshAfterCommit(9001L, null);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void registerChatUploadedSkills_createsResourceExtAndRelation() {
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");

        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of());
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7001L);
            return resource;
        });
        when(ssResExtSkillService.findById(7001L)).thenReturn(null);
        when(ssResourceRelDetailService.find(9001L, 7001L)).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(8001L);
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);

        service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile), List.of(uploadedSkill));

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        SsResource resource = resourceCaptor.getValue();
        assertThat(resource.getResourceBizType()).isEqualTo("SKILL");
        assertThat(resource.getResourceCode()).isEqualTo("demo-skill");
        assertThat(resource.getOwnerType()).isEqualTo("personal");
        assertThat(resource.getImplType()).isEqualTo("SKILL");
        assertThat(resource.getWorkerAgentType()).isEqualTo("NONE");

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        SsResExtSkill ext = extCaptor.getValue();
        assertThat(ext.getResourceId()).isEqualTo(7001L);
        assertThat(ext.getSourceType()).isEqualTo("CHAT_UPLOAD");
        assertThat(ext.getSkillType()).isEqualTo("hub");
        assertThat(ext.getSkillUrl()).isEqualTo("/byclaw/resource/skill/user001-hub/demo-skill.zip");
        assertThat(ext.getTargetContent()).contains("\"resourceId\":7001", "\"sourceType\":\"CHAT_UPLOAD\"",
            "\"skillUrl\":\"/byaiService/tool/downloadSkillZip?skillId=7001\"");

        ArgumentCaptor<SsResourceRelDetail> relCaptor = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(ssResourceRelDetailService).save(relCaptor.capture());
        assertThat(relCaptor.getValue().getResourceId()).isEqualTo(9001L);
        assertThat(relCaptor.getValue().getRelResourceId()).isEqualTo(7001L);

        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill/user001-hub"),
            eq("demo-skill.zip"), eq("application/zip"));
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
            eq("SKILL_7001.json"), eq("application/json"));
        verify(ssResourceArtifactService).upsertArtifact(eq(7001L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.STANDARD_JSON.name()), eq("minio"), eq("skill/SKILL_7001.json"),
            eq("chat-upload-skill-json"));
        verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
        verify(digitalEmployeeRuntimeRefreshService).scheduleSkillRuntimeRefreshAfterCommit(
            org.mockito.ArgumentMatchers.argThat(ids -> ids.size() == 1 && ids.contains(9001L)));
    }

    @Test
    void listSkillMarketplaceManageableDigitalEmployees_returnsOnlyManageableEmployees() {
        SsResource manageable = new SsResource();
        manageable.setResourceId(9001L);
        manageable.setResourceName("可管理数字员工");
        SsResource useOnly = new SsResource();
        useOnly.setResourceId(9002L);
        useOnly.setResourceName("仅可使用数字员工");
        when(ssResourceService.listActiveDigitalEmployees()).thenReturn(List.of(manageable, useOnly));
        when(authApplicationService.hasResourceManagePermission(manageable)).thenReturn(true);
        when(authApplicationService.hasResourceManagePermission(useOnly)).thenReturn(false);

        List<SkillMarketplaceDigitalEmployeeVo> result = service.listSkillMarketplaceManageableDigitalEmployees();

        assertThat(result).singleElement().satisfies(item -> {
            assertThat(item.getDigId()).isEqualTo(9001L);
            assertThat(item.getDigName()).isEqualTo("可管理数字员工");
        });
    }

    @Test
    void registerChatUploadedSkills_rejectsWhenNoManagePermission() {
        // 仅有使用权限（别人授权的个人助理）安装技能时，应直接拒绝，而不是“提示成功但不生效”。
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");

        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(false);

        assertThatThrownBy(() -> service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile),
            List.of(uploadedSkill))).isInstanceOf(IllegalArgumentException.class);

        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(digitalEmployeeRuntimeRefreshService, never()).scheduleSkillRuntimeRefreshAfterCommit(any());
    }

    @Test
    void rebuildAndScheduleSkillRuntimeRefresh_doesNotScheduleWhenRelSkillsRebuildFails() {
        doThrow(new IllegalStateException("rebuild failed"))
            .when(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);

        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service,
            "rebuildAndScheduleSkillRuntimeRefresh", new java.util.LinkedHashSet<>(List.of(9001L))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("rebuild failed");

        verify(digitalEmployeeRuntimeRefreshService, never()).scheduleSkillRuntimeRefreshAfterCommit(any());
    }

    @Test
    void registerChatUploadedSkills_overwritesAllHistoricalDuplicateSkillsWithoutChangingOwnerType() {
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");
        SsResource existingEnterpriseSkill = new SsResource();
        existingEnterpriseSkill.setResourceId(7002L);
        existingEnterpriseSkill.setSystemCode("BYAI");
        existingEnterpriseSkill.setResourceBizType("SKILL");
        existingEnterpriseSkill.setResourceCode("demo-skill");
        existingEnterpriseSkill.setResourceName("企业旧技能");
        existingEnterpriseSkill.setOwnerType("enterprise");
        SsResource historicalPersonalSkill = new SsResource();
        historicalPersonalSkill.setResourceId(7005L);
        historicalPersonalSkill.setSystemCode("BYAI");
        historicalPersonalSkill.setResourceBizType("SKILL");
        historicalPersonalSkill.setResourceCode("demo-skill");
        historicalPersonalSkill.setResourceName("历史个人技能");
        historicalPersonalSkill.setOwnerType("personal");
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        digitalEmployee.setResourceName("测试数字员工");
        digitalEmployee.setResourceBizType("DIG_EMPLOYEE");
        SsResource otherDigitalEmployee = new SsResource();
        otherDigitalEmployee.setResourceId(9002L);
        otherDigitalEmployee.setResourceBizType("DIG_EMPLOYEE");
        SsResourceRelDetail currentRelation = new SsResourceRelDetail();
        currentRelation.setResourceId(9001L);
        currentRelation.setRelResourceId(7002L);
        SsResourceRelDetail historicalRelation = new SsResourceRelDetail();
        historicalRelation.setResourceId(9002L);
        historicalRelation.setRelResourceId(7005L);
        SsResExtSkill existingExtSkill = new SsResExtSkill();
        existingExtSkill.setResourceId(7002L);
        existingExtSkill.setVersion("v0.1");
        SsResExtSkill historicalExtSkill = new SsResExtSkill();
        historicalExtSkill.setResourceId(7005L);
        historicalExtSkill.setVersion("v0.3");

        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);
        when(ssResourceService.getResourceListByCode(List.of("demo-skill")))
            .thenReturn(List.of(existingEnterpriseSkill, historicalPersonalSkill));
        when(authApplicationService.hasResourceManagePermission(existingEnterpriseSkill)).thenReturn(true);
        when(authApplicationService.hasResourceManagePermission(historicalPersonalSkill)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(any(SsResource.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7002L)).thenReturn(existingExtSkill);
        when(ssResExtSkillService.findById(7005L)).thenReturn(historicalExtSkill);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");
        when(ssResExtSkillService.nextVersion("v0.3")).thenReturn("v0.4");
        when(ssResourceRelDetailService.find(9001L, 7002L)).thenReturn(List.of());
        when(ssResourceRelDetailService.list(
            org.mockito.ArgumentMatchers.<com.baomidou.mybatisplus.core.conditions.Wrapper<SsResourceRelDetail>>any()))
                .thenReturn(List.of(currentRelation), List.of(historicalRelation));
        when(ssResourceService.findByIdList(List.of(9001L))).thenReturn(List.of(digitalEmployee));
        when(ssResourceService.findByIdList(List.of(9002L))).thenReturn(List.of(otherDigitalEmployee));
        when(sequenceService.nextVal()).thenReturn(8002L);

        service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile), List.of(uploadedSkill));

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService, times(2)).updateResourceEntity(resourceCaptor.capture());
        assertThat(resourceCaptor.getAllValues()).extracting(SsResource::getOwnerType)
            .containsExactly("enterprise", "personal");
        verify(ssResourceService, never()).saveResource(any(SsResource.class));

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService, times(2)).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getAllValues()).extracting(SsResExtSkill::getVersion).containsExactly("v0.2", "v0.4");
        verify(ssResourceRelDetailService, never()).find(9001L, 7005L);
        verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
        verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9002L);
        verify(digitalEmployeeRuntimeRefreshService).scheduleSkillRuntimeRefreshAfterCommit(
            org.mockito.ArgumentMatchers.argThat(ids -> ids.size() == 2 && ids.containsAll(List.of(9001L, 9002L))));
    }

    @Test
    void registerChatUploadedSkills_rejectsOverwriteWhenExistingSkillIsNotManageable() {
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");
        SsResource existingEnterpriseSkill = new SsResource();
        existingEnterpriseSkill.setResourceId(7003L);
        existingEnterpriseSkill.setSystemCode("BYAI");
        existingEnterpriseSkill.setResourceBizType("SKILL");
        existingEnterpriseSkill.setResourceCode("demo-skill");
        existingEnterpriseSkill.setResourceName("企业旧技能");
        existingEnterpriseSkill.setOwnerType("enterprise");
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);

        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);
        when(ssResourceService.getResourceListByCode(List.of("demo-skill")))
            .thenReturn(List.of(existingEnterpriseSkill));
        when(authApplicationService.hasResourceManagePermission(existingEnterpriseSkill)).thenReturn(false);

        assertThatThrownBy(() -> service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile),
            List.of(uploadedSkill))).isInstanceOf(IllegalArgumentException.class);

        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
    }

    @Test
    void registerChatUploadedSkills_rejectsOverwriteForInnerSkill() {
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");
        SsResource innerSkill = new SsResource();
        innerSkill.setResourceId(7004L);
        innerSkill.setSystemCode("BYAI");
        innerSkill.setResourceBizType("SKILL");
        innerSkill.setResourceCode("demo-skill");
        innerSkill.setResourceName("内置技能");
        innerSkill.setOwnerType("enterprise");
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        SsResExtSkill innerExtSkill = new SsResExtSkill();
        innerExtSkill.setResourceId(7004L);
        innerExtSkill.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);

        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);
        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of(innerSkill));
        when(authApplicationService.hasResourceManagePermission(innerSkill)).thenReturn(true);
        when(ssResExtSkillService.findById(7004L)).thenReturn(innerExtSkill);

        assertThatThrownBy(() -> service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile),
            List.of(uploadedSkill))).isInstanceOf(IllegalArgumentException.class);

        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
    }

    @Test
    void importSkillZips_enterpriseSkill_syncsPackageToOrgHubAndJsonToSkillRoot() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of());
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7101L);
            return resource;
        });
        when(ssResExtSkillService.findById(7101L)).thenReturn(null);
        when(ssResourceService.findById(9001L)).thenThrow(new RuntimeException("数字员工日志查询异常"));

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {uploadFile}, 10L,
            "enterprise");

        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getCreatedCount()).isEqualTo(1);

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo("enterprise");

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getValue().getSourceType()).isEqualTo("SKILL_MANAGE_IMPORT");
        assertThat(extCaptor.getValue().getSkillUrl()).isEqualTo("/byclaw/resource/skill/org-hub/enterprise-skill.zip");

        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill/org-hub"),
            eq("enterprise-skill.zip"), eq("application/zip"));
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
            eq("SKILL_7101.json"), eq("application/json"));
        verify(ssResourceArtifactService).upsertArtifact(eq(7101L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.STANDARD_JSON.name()), eq("minio"), eq("skill/SKILL_7101.json"),
            eq("chat-upload-skill-json"));
    }

    @Test
    void importSkillZips_duplicateSkillCodeOverwritesAllHistoricalDuplicateSkills() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));

        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7102L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("Old Skill");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");
        SsResource historicalResource = new SsResource();
        historicalResource.setResourceId(7103L);
        historicalResource.setSystemCode("BYAI");
        historicalResource.setResourceCode("enterprise-skill");
        historicalResource.setResourceName("Historical Skill");
        historicalResource.setResourceBizType("SKILL");
        historicalResource.setOwnerType("enterprise");

        SsResExtSkill existingExt = new SsResExtSkill();
        existingExt.setResourceId(7102L);
        existingExt.setVersion("v0.1");
        SsResExtSkill historicalExt = new SsResExtSkill();
        historicalExt.setResourceId(7103L);
        historicalExt.setVersion("v0.3");

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill")))
            .thenReturn(List.of(existingResource, historicalResource));
        when(authApplicationService.hasResourceManagePermission(existingResource)).thenReturn(true);
        when(authApplicationService.hasResourceManagePermission(historicalResource)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7102L)).thenReturn(existingExt);
        when(ssResExtSkillService.findById(7103L)).thenReturn(historicalExt);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");
        when(ssResExtSkillService.nextVersion("v0.3")).thenReturn("v0.4");

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {uploadFile}, 10L,
            "enterprise");

        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getCreatedCount()).isZero();
        assertThat(result.getUpdatedCount()).isEqualTo(1);
        assertThat(result.getUpdatedItems()).hasSize(1);
        assertThat(result.getUpdatedItems().get(0).getMessage()).contains("覆盖更新成功");
        verify(ssResourceService, times(2)).updateResourceEntity(any(SsResource.class));
        verify(ssResourceService, never()).saveResource(any(SsResource.class));

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService, times(2)).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getAllValues()).extracting(SsResExtSkill::getVersion).containsExactly("v0.2", "v0.4");
        assertThat(extCaptor.getAllValues()).extracting(SsResExtSkill::getSkillUrl)
            .containsOnly("/byclaw/resource/skill/org-hub/enterprise-skill.zip");
    }

    @Test
    void importSkillZips_adminVipCanOverwriteEnterpriseInnerSkill() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));
        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7103L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("内置技能");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");
        SsResExtSkill existingExt = new SsResExtSkill();
        existingExt.setResourceId(7103L);
        existingExt.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);
        existingExt.setVersion("v0.1");

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        loginInfo.setUserCode("adminvip");
        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of(existingResource));
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7103L)).thenReturn(existingExt);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {uploadFile}, 10L,
            "enterprise");

        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getUpdatedCount()).isEqualTo(1);
        verify(ssResourceService).updateResourceEntity(existingResource);
        verify(ssResExtSkillService).saveOrUpdate(any(SsResExtSkill.class));
    }

    @Test
    void importSkillZips_adminVipCanOverwritePersonalInnerSkill() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "personal-skill.zip", "application/zip",
            skillZipBytes("personal-skill"));
        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7104L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("personal-skill");
        existingResource.setResourceName("个人内置技能");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("personal");
        SsResExtSkill existingExt = new SsResExtSkill();
        existingExt.setResourceId(7104L);
        existingExt.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);
        existingExt.setVersion("v0.1");

        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(ssResourceService.getResourceListByCode(List.of("personal-skill"))).thenReturn(List.of(existingResource));
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7104L)).thenReturn(existingExt);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {uploadFile}, 10L,
            "personal");

        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getUpdatedCount()).isEqualTo(1);
        verify(ssResourceService).updateResourceEntity(existingResource);
        verify(ssResExtSkillService).saveOrUpdate(any(SsResExtSkill.class));
    }

    @Test
    void importSkillZip_rejectsOverwriteWhenCurrentUserCannotManageSkill() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));
        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7104L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("Existing Skill");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");
        SsResource manageableHistoricalResource = new SsResource();
        manageableHistoricalResource.setResourceId(7108L);
        manageableHistoricalResource.setSystemCode("BYAI");
        manageableHistoricalResource.setResourceCode("enterprise-skill");
        manageableHistoricalResource.setResourceName("Manageable Historical Skill");
        manageableHistoricalResource.setResourceBizType("SKILL");
        manageableHistoricalResource.setOwnerType("enterprise");

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill")))
            .thenReturn(List.of(manageableHistoricalResource, existingResource));
        when(authApplicationService.hasResourceManagePermission(manageableHistoricalResource)).thenReturn(true);
        when(authApplicationService.hasResourceManagePermission(existingResource)).thenReturn(false);

        assertThatThrownBy(() -> service.importSkillZip(uploadFile, 10L, "enterprise", "SKILL_MANAGE_IMPORT"))
            .isInstanceOf(IllegalArgumentException.class);

        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
        verify(digitalEmployeeRuntimeRefreshService, never()).scheduleSkillRuntimeRefreshAfterCommit(any());
    }

    @Test
    void importSkillZip_overwriteRefreshesRuntimeForBoundDigitalEmployees() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));
        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7105L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("Existing Skill");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");
        SsResExtSkill existingExt = new SsResExtSkill();
        existingExt.setResourceId(7105L);
        existingExt.setVersion("v0.1");
        existingExt.setSourceType("SKILL_MANAGE_IMPORT");

        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceId(9001L);
        relation.setRelResourceId(7105L);
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        digitalEmployee.setResourceBizType("DIG_EMPLOYEE");

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of(existingResource));
        when(authApplicationService.hasResourceManagePermission(existingResource)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7105L)).thenReturn(existingExt);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");
        when(ssResourceRelDetailService.list(
            org.mockito.ArgumentMatchers.<com.baomidou.mybatisplus.core.conditions.Wrapper<SsResourceRelDetail>>any()))
            .thenReturn(List.of(relation));
        when(ssResourceService.findByIdList(List.of(9001L))).thenReturn(List.of(digitalEmployee));

        service.importSkillZip(uploadFile, 10L, "enterprise", "SKILL_MANAGE_IMPORT");

        verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
        verify(digitalEmployeeRuntimeRefreshService).scheduleSkillRuntimeRefreshAfterCommit(
            org.mockito.ArgumentMatchers.argThat(ids -> ids.size() == 1 && ids.contains(9001L)));
    }

    @Test
    void importSkillZip_overwriteKeepsChatUploadWorkspaceMetadata() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7106L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("demo-skill");
        existingResource.setResourceName("Demo Skill");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("personal");
        existingResource.setCreateBy(10001L);
        SsResExtSkill existingExt = new SsResExtSkill();
        existingExt.setResourceId(7106L);
        existingExt.setVersion("v0.1");
        existingExt.setSourceType("CHAT_UPLOAD");
        existingExt.setTargetContent("{\"skillPath\":\"/.openclaw/workspace-baiying-agent-9001/skills/demo-skill\","
            + "\"skillDocObjectKey\":\"/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md\"}");

        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of(existingResource));
        when(authApplicationService.hasResourceManagePermission(existingResource)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7106L)).thenReturn(existingExt);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");
        when(ssResourceRelDetailService.list(
            org.mockito.ArgumentMatchers.<com.baomidou.mybatisplus.core.conditions.Wrapper<SsResourceRelDetail>>any()))
                .thenReturn(List.of());

        service.importSkillZip(uploadFile, 10L, "personal", "SKILL_MANAGE_IMPORT");

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getValue().getSourceType()).isEqualTo("CHAT_UPLOAD");
        assertThat(extCaptor.getValue().getTargetContent()).contains("\"skillPath\":\"/.openclaw/workspace-baiying-agent-9001/skills/demo-skill\"");
    }

    @Test
    void previewSkillZipImportConflicts_returnsExistingSkillWithoutPersisting() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));

        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7103L);
        existingResource.setSystemCode("BYAI");
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("Existing Skill");
        existingResource.setResourceDesc("old desc");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of(existingResource));
        when(authApplicationService.hasResourceManagePermission(existingResource)).thenReturn(true);

        var result = service.previewSkillZipImportConflicts(
            new org.springframework.web.multipart.MultipartFile[] {uploadFile}, "enterprise");

        assertThat(result.getUpdatedCount()).isEqualTo(1);
        assertThat(result.getUpdatedItems()).hasSize(1);
        assertThat(result.getUpdatedItems().get(0).getResourceId()).isEqualTo("7103");
        assertThat(result.getUpdatedItems().get(0).getMessage()).isEqualTo("确认覆盖");
        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
    }

    @Test
    void importSkillZip_personalImportOverwritesManageableEnterpriseSkillWithSameNaturalKey() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        MockMultipartFile uploadFile = new MockMultipartFile("file", "shared-skill.zip", "application/zip",
            skillZipBytes("shared-skill"));
        SsResource existingEnterpriseSkill = new SsResource();
        existingEnterpriseSkill.setResourceId(7107L);
        existingEnterpriseSkill.setSystemCode("BYAI");
        existingEnterpriseSkill.setResourceBizType("SKILL");
        existingEnterpriseSkill.setResourceCode("shared-skill");
        existingEnterpriseSkill.setResourceName("企业技能");
        existingEnterpriseSkill.setOwnerType("enterprise");

        when(ssResourceService.getResourceListByCode(List.of("shared-skill")))
            .thenReturn(List.of(existingEnterpriseSkill));
        when(authApplicationService.hasResourceManagePermission(existingEnterpriseSkill)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(any(SsResource.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7107L)).thenReturn(null);
        when(ssResourceRelDetailService.list(
            org.mockito.ArgumentMatchers.<com.baomidou.mybatisplus.core.conditions.Wrapper<SsResourceRelDetail>>any()))
                .thenReturn(List.of());

        var result = service.importSkillZip(uploadFile, 10L, "personal", "SKILL_MANAGE_IMPORT");

        assertThat(result.updated()).isTrue();
        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).updateResourceEntity(resourceCaptor.capture());
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo("enterprise");
        verify(ssResourceService, never()).saveResource(any(SsResource.class));
    }

    @Test
    void refreshUnpublishedSkillDoesNotPublishItsStandardJson() {
        SsResource resource = new SsResource();
        resource.setResourceId(7201L);
        resource.setResourceBizType("SKILL");
        resource.setResourceStatus(3);
        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(7201L);
        ext.setVersion("v0.1");
        when(ssResExtSkillService.findById(7201L)).thenReturn(ext);
        service.refreshSkillBasicInfo(resource);
        verify(ssResExtSkillService).saveOrUpdate(ext);
        verify(resourceArtifactStorageService, never()).uploadToSubdirectory(any(byte[].class), any(), any(), any());
    }

    @Test
    void reimportDeregisteredSkillCreatesNewResourceWithoutRestoringHistory() throws Exception {
        SsResource deleted = prepareImportOriginal();
        deleted.setResourceStatus(-1);
        // 即使历史记录属于企业且无管理权，注销后也不再是个人导入的覆盖对象。
        when(authApplicationService.hasResourceManagePermission(deleted)).thenReturn(false);
        prepareImportSnapshotPersistence();
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        var files = new org.springframework.web.multipart.MultipartFile[] {file};

        var preview = service.previewSkillZipImportConflicts(files, "personal");
        assertThat(preview.getFailed()).isZero();
        assertThat(preview.getUpdatedCount()).isZero();
        assertThat(preview.getItems()).isEmpty();

        var result = service.importSkillZips(files, 10L, "personal");
        assertThat(result.getFailed()).isZero();
        assertThat(result.getCreatedCount()).isEqualTo(1);
        assertThat(result.getUpdatedCount()).isZero();
        assertThat(result.getCreatedItems().get(0).getResourceId()).isEqualTo("8101");
        assertThat(result.getCreatedItems().get(0).isReviewRequired()).isFalse();
        ArgumentCaptor<SsResource> saved = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(saved.capture());
        assertThat(saved.getValue().getResourceCode()).isEqualTo("demo");
        assertThat(saved.getValue().getOwnerType()).isEqualTo("personal");
        assertThat(saved.getValue().getResourceStatus()).isEqualTo(2);
        assertThat(deleted.getResourceStatus()).isEqualTo(-1);
        verify(ssResourceService, never()).updateResourceEntity(deleted);
        verify(ssResExtSkillService, never()).saveOrUpdate(
            org.mockito.ArgumentMatchers.argThat(ext -> Long.valueOf(7101L).equals(ext.getResourceId())));
        verify(authApplicationService).ensureCreatorDefaultPrivileges(saved.getValue());
        verify(publications, never()).submit(any(), any());
    }

    @Test
    void enterpriseReimportAfterDeregistrationStillRequiresReview() throws Exception {
        SsResource deleted = prepareImportOriginal();
        deleted.setResourceStatus(-1);
        prepareImportSnapshotPersistence();
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        var files = new org.springframework.web.multipart.MultipartFile[] {file};

        assertThat(service.previewSkillZipImportConflicts(files, "enterprise").getFailed()).isZero();
        var result = service.importSkillZips(files, 10L, "enterprise");

        assertThat(result.getFailed()).isZero();
        assertThat(result.getCreatedCount()).isEqualTo(1);
        assertThat(result.getItems().get(0).isReviewRequired()).isTrue();
        ArgumentCaptor<SsResource> saved = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(saved.capture());
        assertThat(saved.getValue().getResourceStatus()).isEqualTo(4);
        verify(publications).submit(org.mockito.ArgumentMatchers.isNull(), eq(saved.getValue()));
        assertThat(deleted.getResourceStatus()).isEqualTo(-1);
        verify(ssResourceService, never()).updateResourceEntity(deleted);
    }

    @ParameterizedTest
    @ValueSource(ints = {2, 3})
    void reimportSkipsDeletedHistoryButStillUpdatesExistingSkill(int status) throws Exception {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        SsResource existing = prepareImportOriginal();
        existing.setResourceStatus(status);
        SsResource deleted = new SsResource();
        deleted.setResourceId(7100L);
        deleted.setSystemCode("BYAI");
        deleted.setResourceBizType("SKILL");
        deleted.setResourceCode("demo");
        deleted.setResourceStatus(-1);
        when(ssResourceService.getResourceListByCode(List.of("demo"))).thenReturn(List.of(deleted, existing));
        when(ssResourceService.updateResourceEntity(existing)).thenReturn(existing);
        var file = new MockMultipartFile("file", "demo.zip", "application/zip", skillZipBytes("demo"));
        var files = new org.springframework.web.multipart.MultipartFile[] {file};

        var preview = service.previewSkillZipImportConflicts(files, "enterprise");
        assertThat(preview.getFailed()).isZero();
        assertThat(preview.getUpdatedItems()).hasSize(1);
        assertThat(preview.getUpdatedItems().get(0).getResourceId()).isEqualTo("7101");
        var result = service.importSkillZips(files, 10L, "enterprise");

        assertThat(result.getFailed()).isZero();
        assertThat(result.getUpdatedCount()).isEqualTo(1);
        assertThat(result.getUpdatedItems().get(0).getResourceId()).isEqualTo("7101");
        verify(ssResourceService).updateResourceEntity(existing);
        verify(ssResourceService, never()).saveResource(any());
        verify(ssResourceService, never()).updateResourceEntity(deleted);
        assertThat(deleted.getResourceStatus()).isEqualTo(-1);
    }

    @Test
    void deregisteredSkillCannotBeOverwrittenThroughImport() {
        SsResource resource = new SsResource();
        resource.setResourceId(7201L);
        resource.setResourceStatus(-1);
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "assertSkillManagePermission", resource))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refreshSkillBasicInfo_incrementsVersionAndRefreshesTargetContent() {
        SsResource resource = new SsResource();
        resource.setResourceId(7201L);
        resource.setResourceCode("demo-skill");
        resource.setResourceName("Demo Skill New");
        resource.setResourceDesc("new desc");
        resource.setResourceBizType("SKILL");
        resource.setResourceStatus(2);
        resource.setResourceType("ATOM");
        resource.setOwnerType("personal");
        resource.setResourceVersionId("1.0");
        resource.setHostType("hosted");

        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(7201L);
        ext.setSkillType("hub");
        ext.setSourceType("SKILL_MANAGE_IMPORT");
        ext.setVersion("v0.1");
        ext.setSkillUrl("resource/skill/user001-hub/demo-skill.zip");
        ext.setSkillPackageFormat("zip");
        ext.setSkillOriginalFilename("demo-skill.zip");
        ext.setTargetContent("{\"skillPath\":\"/skills/demo-skill\"}");

        when(ssResExtSkillService.findById(7201L)).thenReturn(ext);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");

        String targetContent = service.refreshSkillBasicInfo(resource);

        assertThat(targetContent).contains("\"resourceName\":\"Demo Skill New\"", "\"version\":\"v0.2\"",
            "\"skillUrl\":\"/byaiService/tool/downloadSkillZip?skillId=7201\"");
        verify(ssResExtSkillService).saveOrUpdate(ext);
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
            eq("SKILL_7201.json"), eq("application/json"));
        verify(ssResourceArtifactService).upsertArtifact(eq(7201L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.STANDARD_JSON.name()), eq("minio"), eq("skill/SKILL_7201.json"),
            eq("chat-upload-skill-json"));
    }

    @Test
    void installThirdPartySkill_logsPermissionContextWhenManagePermissionIsDenied() {
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        digitalEmployee.setResourceCode("user001_main");
        digitalEmployee.setResourceName("测试用户的超级助手");
        digitalEmployee.setResourceBizType("DIG_EMPLOYEE");
        digitalEmployee.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        digitalEmployee.setCreateBy(20002L);
        digitalEmployee.setManUserId("20002");
        digitalEmployee.setManOrgId(30003L);
        digitalEmployee.setComAcctId(1L);
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(false);

        Logger serviceLogger = (Logger)LoggerFactory.getLogger(ByClawSkillResourceApplicationService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        serviceLogger.addAppender(appender);
        appender.start();

        try {
            assertThatThrownBy(() ->
                service.installThirdPartySkill(9001L, "https://market.example/download?skillIds=123"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("digemployee.skill.install.no.manage.permission");

            assertThat(appender.list).anySatisfy(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.INFO);
                assertThat(event.getFormattedMessage()).contains(
                    "第三方技能安装数字员工权限校验详情",
                    "operationSource=SKILL_MARKET_INSTALL",
                    "requestedDigitalEmployeeId=9001",
                    "currentUserId=10001",
                    "currentUserCode=user001",
                    "defaultDigitalEmployeeId=9001",
                    "creatorMatched=false",
                    "personalDefaultOwnerTypeMatched=true",
                    "defaultDigitalEmployeeMatched=true",
                    "defaultSuperAssistantCodeMatched=true",
                    "baseManagePermission=false",
                    "platformAdmin=false",
                    "organizationAdminRole=false",
                    "businessAdmin=false",
                    "superAdmin=false",
                    "managePermission=false",
                    "\"resourceName\":\"测试用户的超级助手\"",
                    "\"createBy\":20002");
            });
        }
        finally {
            serviceLogger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void installThirdPartySkill_createsWhaleAgentSkillBindsEmployeeAndRefreshesRuntime() {
        String downloadUrl = "https://market.example/market-skill.zip";
        String resourceCode = DigestUtils.sha256Hex(downloadUrl);
        ByClawSkillResourceApplicationService installService = spy(service);
        doReturn(skillZipBytes("market-skill")).when(installService)
            .downloadThirdPartySkillPackage(downloadUrl);
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        digitalEmployee.setResourceBizType("DIG_EMPLOYEE");
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);
        when(ssResourceService.findByImportIdentity("WHALE_AGENT", "SKILL", resourceCode)).thenReturn(null);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7301L);
            return resource;
        });
        when(ssResourceRelDetailService.find(9001L, 7301L)).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(8301L);

        var result = installService.installThirdPartySkill(9001L, downloadUrl);

        assertThat(result.updated()).isFalse();
        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        assertThat(resourceCaptor.getValue().getSystemCode()).isEqualTo("WHALE_AGENT");
        assertThat(resourceCaptor.getValue().getResourceCode()).isEqualTo(resourceCode);
        assertThat(resourceCaptor.getValue().getResourceName()).isEqualTo("market-skill");
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo("personal");
        verify(authApplicationService).ensureCreatorDefaultPrivileges(resourceCaptor.getValue());
        verify(ssResourceRelDetailService).save(any(SsResourceRelDetail.class));
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill/user001-hub"),
            eq("market-skill.zip"), eq("application/zip"));
        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getValue().getTargetContent()).contains("\"sourceDownloadUrl\":\"" + downloadUrl + "\"");
        verify(digitalEmployeeApplicationService).rebuildAndSaveDigitalEmployeeRelSkills(9001L);
        verify(digitalEmployeeRuntimeRefreshService).scheduleSkillRuntimeRefreshAfterCommit(
            org.mockito.ArgumentMatchers.argThat(ids -> ids.size() == 1 && ids.contains(9001L)));
    }

    @Test
    void installThirdPartySkill_sameDownloadUrlUpdatesExistingResourceWhenPackageNameChanges() {
        String downloadUrl = "https://market.example/stable-skill-package.zip";
        String resourceCode = DigestUtils.sha256Hex(downloadUrl);
        ByClawSkillResourceApplicationService installService = spy(service);
        doReturn(skillZipBytes("renamed-skill")).when(installService).downloadThirdPartySkillPackage(downloadUrl);

        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        digitalEmployee.setResourceBizType("DIG_EMPLOYEE");
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);

        SsResource existing = new SsResource();
        existing.setResourceId(7302L);
        existing.setResourceCode(resourceCode);
        existing.setResourceName("old-skill-name");
        existing.setOwnerType("personal");
        when(ssResourceService.findByImportIdentity("WHALE_AGENT", "SKILL", resourceCode)).thenReturn(existing);
        when(authApplicationService.hasResourceManagePermission(existing)).thenReturn(true);
        when(ssResourceService.updateResourceEntity(existing)).thenReturn(existing);
        when(ssResourceRelDetailService.find(9001L, 7302L)).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(8302L);

        var result = installService.installThirdPartySkill(9001L, downloadUrl);

        assertThat(result.updated()).isTrue();
        assertThat(result.resource().getResourceId()).isEqualTo(7302L);
        assertThat(result.resource().getResourceCode()).isEqualTo(resourceCode);
        assertThat(result.resource().getResourceName()).isEqualTo("renamed-skill");
        verify(ssResourceService).updateResourceEntity(existing);
        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(authApplicationService, never()).ensureCreatorDefaultPrivileges(existing);
    }

    @Test
    void installThirdPartySkillCannotResurrectDeregisteredResource() {
        String downloadUrl = "https://market.example/deregistered-skill.zip";
        String resourceCode = DigestUtils.sha256Hex(downloadUrl);
        ByClawSkillResourceApplicationService installService = spy(service);
        doReturn(skillZipBytes("deregistered-skill")).when(installService)
            .downloadThirdPartySkillPackage(downloadUrl);

        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        digitalEmployee.setResourceBizType("DIG_EMPLOYEE");
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceInstallTargetManagePermission(digitalEmployee)).thenReturn(true);

        SsResource existing = new SsResource();
        existing.setResourceId(7303L);
        existing.setResourceStatus(-1);
        existing.setResourceCode(resourceCode);
        when(ssResourceService.findByImportIdentity("WHALE_AGENT", "SKILL", resourceCode)).thenReturn(existing);

        assertThatThrownBy(() -> installService.installThirdPartySkill(9001L, downloadUrl))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("resource.lifecycle.status.invalid");
        verify(ssResourceService, never()).updateResourceEntity(existing);
        verify(ssResourceService, never()).saveResource(any(SsResource.class));
    }

    @Test
    void downloadThirdPartySkillPackage_logsDetailedHttpFailure() throws Exception {
        byte[] errorBody = "{\"error\":\"skill not found\",\"code\":\"SKILL_404\"}"
            .getBytes(StandardCharsets.UTF_8);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/download", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json;charset=UTF-8");
            exchange.sendResponseHeaders(502, errorBody.length);
            try (var output = exchange.getResponseBody()) {
                output.write(errorBody);
            }
        });
        server.start();
        String downloadUrl = "http://127.0.0.1:" + server.getAddress().getPort()
            + "/download?skillIds=821937217247941&token=raw-token";
        Logger serviceLogger = (Logger)LoggerFactory.getLogger(ByClawSkillResourceApplicationService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        serviceLogger.addAppender(appender);
        appender.start();

        try {
            assertThatThrownBy(() -> service.downloadThirdPartySkillPackage(downloadUrl))
                .isInstanceOf(IllegalArgumentException.class);

            assertThat(appender.list).anySatisfy(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.ERROR);
                assertThat(event.getFormattedMessage()).contains(
                    "第三方技能包下载失败",
                    "userCode=user001",
                    "downloadUrl=" + downloadUrl,
                    "stage=VALIDATE_HTTP_STATUS",
                    "httpStatus=502",
                    "contentType=application/json;charset=UTF-8",
                    "contentLength=" + errorBody.length,
                    "downloadedBytes=0",
                    "errorResponse={\"error\":\"skill not found\",\"code\":\"SKILL_404\"}",
                    "exceptionType=java.lang.IllegalArgumentException");
                assertThat(event.getThrowableProxy()).isNotNull();
            });
        }
        finally {
            serviceLogger.detachAppender(appender);
            appender.stop();
            server.stop(0);
        }
    }

    @Test
    void inspectSkillPackage_acceptsUtf8ChineseEntryNamesWithoutLanguageEncodingFlag() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "ppt-master-0.1.zip", "application/zip",
            utf8UnflaggedSkillZipBytes());

        ByClawSkillResourceApplicationService.SkillPackageMetadata metadata =
            service.inspectSkillPackage(uploadFile);

        assertThat(metadata.skillName()).isEqualTo("ppt-master");
        assertThat(metadata.skillCode()).isEqualTo("ppt-master");
        assertThat(metadata.skillDesc()).isEqualTo("AI 驱动的演示文稿生成技能");
    }

    @Test
    void inspectSkillPackage_acceptsGbkChineseEntryNamesWithoutLanguageEncodingFlag() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "ppt-master.zip", "application/zip",
            unflaggedSkillZipBytes("GBK"));

        assertThat(service.inspectSkillPackage(uploadFile).skillName()).isEqualTo("ppt-master");
    }

    @Test
    void inspectSkillPackage_rejectsCorruptArchiveWithoutEncodingRetry() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "broken.zip", "application/zip",
            new byte[] {1, 2, 3});

        // 非编码错误保留原始异常，不能误走字符集回退并掩盖损坏原因。
        assertThatThrownBy(() -> service.inspectSkillPackage(uploadFile))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("byclaw.skill.zip.read.failed")
            .satisfies(error -> assertThat(error.getCause().getSuppressed()).isEmpty());
    }

    private byte[] skillZipBytes(String skillName) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                zip.putNextEntry(new ZipEntry(skillName + "/SKILL.md"));
                zip.write(("## " + skillName + "\n用于测试的技能描述").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            return out.toByteArray();
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private byte[] utf8UnflaggedSkillZipBytes() {
        return unflaggedSkillZipBytes(StandardCharsets.UTF_8.name());
    }

    private byte[] unflaggedSkillZipBytes(String encoding) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipArchiveOutputStream zip = new ZipArchiveOutputStream(out)) {
                zip.setEncoding(encoding);
                zip.setUseLanguageEncodingFlag(false);
                zip.setCreateUnicodeExtraFields(ZipArchiveOutputStream.UnicodeExtraFieldPolicy.NEVER);

                ZipArchiveEntry skillDoc = new ZipArchiveEntry("ppt-master/SKILL.md");
                zip.putArchiveEntry(skillDoc);
                zip.write(("---\nname: ppt-master\ndescription: >\n  AI 驱动的演示文稿生成技能\n---\n")
                    .getBytes(StandardCharsets.UTF_8));
                zip.closeArchiveEntry();

                ZipArchiveEntry chineseEntry =
                    new ZipArchiveEntry("ppt-master/templates/brands/中汽研/design_spec.md");
                zip.putArchiveEntry(chineseEntry);
                zip.write("template".getBytes(StandardCharsets.UTF_8));
                zip.closeArchiveEntry();
            }
            return out.toByteArray();
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void prepareI18nUtil() {
        MessageSource messageSource = mock(MessageSource.class);
        var publicationMessages = new org.springframework.context.support.ResourceBundleMessageSource();
        publicationMessages.setBasename("i18n/messages");
        publicationMessages.setDefaultEncoding("UTF-8");
        when(messageSource.getMessage(any(), any(), any(Locale.class))).thenAnswer(invocation -> {
            String key = invocation.getArgument(0);
            if (key != null && key.startsWith("byclaw.skill.enterprise.name")) {
                return publicationMessages.getMessage(key, invocation.getArgument(1), invocation.getArgument(2));
            }
            return key != null && key.startsWith("byclaw.skill.publication.")
                ? publicationMessages.getMessage(key, invocation.getArgument(1), Locale.SIMPLIFIED_CHINESE) : key;
        });
        when(messageSource.getMessage(eq("resource.import.success"), any(), any(Locale.class))).thenReturn("导入成功");
        when(messageSource.getMessage(eq("byclaw.skill.import.cover.updated"), any(), any(Locale.class)))
            .thenReturn("Skill 已覆盖更新成功");
        when(messageSource.getMessage(eq("byclaw.skill.import.cover.confirm.item"), any(), any(Locale.class)))
            .thenReturn("确认覆盖");
        ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class, "messageSource", messageSource);
    }
}
