package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SkillPublicationServiceTest {
    private final PrivilegeGrantMapper mapper = mock(PrivilegeGrantMapper.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService skills =
        mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService.class);
    private final com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGovernanceService governance =
        mock(com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGovernanceService.class);
    private final SkillPublicationService service = new SkillPublicationService(mapper, resources, sequence, skills, governance);

    private final com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService skillResources =
        mock(com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService.class);

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(service, "skillResources", skillResources);
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        login.setEnterpriseId(1L);
        login.setUserCode("adminvip");
        CurrentUserHolder.setLoginInfo(login);
        MessageSource messages = mock(MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(Locale.class))).thenAnswer(i -> i.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void submissionCreatesAuditSnapshotInsteadOfPublishing() {
        CurrentUserHolder.getLoginInfo().setUserCode("ordinary-user");
        SsResource source = new SsResource();
        source.setResourceId(100L);
        SsResource target = new SsResource();
        target.setResourceId(101L);
        when(sequence.nextVal()).thenReturn(200L);
        service.submit(source, target);
        ArgumentCaptor<PrivilegeGrant> request = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(mapper).insert(request.capture());
        assertThat(request.getValue().getStatusCd()).isEqualTo("P");
        assertThat(request.getValue().getGrantType()).isEqualTo("SKILL_PUBLICATION");
        assertThat(request.getValue().getGrantObjId()).isEqualTo(101L);
        assertThat(request.getValue().getGrantToObjId()).isEqualTo(10L);
        assertThat(target.getResourceStatus()).isEqualTo(4);
    }

    @Test
    void platformSubmittingAdminvipSkillQueuesOnlyAdminvipReview() {
        platformLogin();
        SsResource source = new SsResource(); source.setCreateBy(7L);
        when(governance.isAdminVipCreator(7L)).thenReturn(true);
        SsResource target = pendingTarget();
        target.setCreateBy(10L); // 企业副本的创建人是代发布人，不能据此获得审核权。
        var ext = new com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill();
        ext.setTargetContent("{\"sourceCreatorId\":\"7\"}");
        when(skills.findById(101L)).thenReturn(ext);
        service.submit(source, target);
        ArgumentCaptor<PrivilegeGrant> request = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(mapper).insert(request.capture());
        assertThat(request.getValue().getStatusCd()).isEqualTo("P");
        assertThat(request.getValue().getUpdateStaff()).isNull();
        assertThat(target.getResourceStatus()).isEqualTo(4);
        assertThat(service.canReview(target)).isFalse();
        when(resources.findByIdForUpdate(101L)).thenReturn(target);
        assertThatThrownBy(() -> service.review(101L, 10L, true)).hasMessage("skill.publication.review.adminvip.only");
        assertThatThrownBy(() -> service.review(101L, 10L, false)).hasMessage("skill.publication.review.adminvip.only");
        verify(mapper, never()).updateById(any(PrivilegeGrant.class));
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        assertThat(service.canReview(target)).isTrue();
        when(mapper.selectOne(any())).thenReturn(request.getValue());
        service.review(101L, 10L, true);
        assertThat(target.getResourceStatus()).isEqualTo(2);
        assertThat(request.getValue().getStatusCd()).isEqualTo("X");
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void authorizedAdministratorsPublishPlatformSkillImmediatelyAndKeepReviewRecord(boolean superAdmin) {
        if (!superAdmin) platformLogin();
        SsResource source = new SsResource(); source.setCreateBy(7L);
        SsResource target = pendingTarget();
        service.submit(source, target);
        ArgumentCaptor<PrivilegeGrant> request = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(mapper).insert(request.capture());
        assertThat(request.getValue().getStatusCd()).isEqualTo("X");
        assertThat(request.getValue().getUpdateStaff()).isEqualTo(10L);
        assertThat(request.getValue().getUpdateDate()).isNotNull();
        assertThat(target.getResourceStatus()).isEqualTo(2);
    }

    @Test
    void adminvipCanPublishOwnSkillImmediatelyWithReviewRecord() {
        SsResource source = new SsResource(); source.setCreateBy(10L);
        when(governance.isAdminVipCreator(10L)).thenReturn(true);
        SsResource target = pendingTarget();
        service.submit(source, target);
        verify(mapper).insert(argThat((PrivilegeGrant request) -> "X".equals(request.getStatusCd())
            && Long.valueOf(10L).equals(request.getUpdateStaff()) && request.getUpdateDate() != null));
        assertThat(target.getResourceStatus()).isEqualTo(2);
    }

    private void platformLogin() {
        CurrentUserHolder.getLoginInfo().setUserCode("platform");
        var role = new com.iwhalecloud.byai.common.login.bean.UsersOrganization(); role.setUserType("PLAT_MAN");
        CurrentUserHolder.getLoginInfo().setUsersOrganizations(List.of(role));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void reviewChangesAvailabilityAndRetainsReviewer(boolean approve) {
        PrivilegeGrant request = new PrivilegeGrant();
        request.setPrivilegeGrantId(200L);
        request.setGrantObjId(101L);
        request.setStatusCd("P");
        SsResource target = pendingTarget();
        when(mapper.selectOne(any())).thenReturn(request);
        when(resources.findByIdForUpdate(101L)).thenReturn(target);
        service.review(101L, 10L, approve);
        assertThat(target.getResourceStatus()).isEqualTo(approve ? 2 : 5);
        assertThat(request.getStatusCd()).isEqualTo(approve ? "X" : "R");
        assertThat(request.getUpdateStaff()).isEqualTo(10L);
        assertThat(request.getUpdateDate()).isNotNull();
        verify(mapper).updateById(request);
        verify(skillResources).applySkillImportReview(target, approve);
        assertThatThrownBy(() -> service.review(101L, 10L, approve)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void failedImportApprovalDoesNotCompleteAuditRequest() {
        SsResource target = pendingTarget();
        PrivilegeGrant request = new PrivilegeGrant();
        request.setStatusCd("P");
        when(mapper.selectOne(any())).thenReturn(request);
        when(resources.findByIdForUpdate(101L)).thenReturn(target);
        doThrow(new IllegalArgumentException("stale import"))
            .when(skillResources).applySkillImportReview(target, true);
        assertThatThrownBy(() -> service.review(101L, 10L, true)).hasMessage("stale import");
        assertThat(request.getStatusCd()).isEqualTo("P");
        verify(resources, never()).updateResourceEntity(any());
        verify(mapper, never()).updateById(any(PrivilegeGrant.class));
    }

    @Test
    void ordinaryUserCannotReviewEvenWithResourceId() {
        CurrentUserHolder.getLoginInfo().setUserCode("ordinary-user");
        assertThatThrownBy(() -> service.review(101L, 10L, true)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(mapper, resources);
    }

    @ParameterizedTest
    @ValueSource(strings = {"PLAT_MAN", "plat_man", "PLAT_DEVOPS", "ORG_MAN", "BUSINESS_MAN", "ORD_USER"})
    void onlyPlatformManagerRoleCanReview(String roleName) {
        CurrentUserHolder.getLoginInfo().setUserCode("role-user");
        var role = new com.iwhalecloud.byai.common.login.bean.UsersOrganization();
        role.setUserType(roleName);
        CurrentUserHolder.getLoginInfo().setUsersOrganizations(List.of(role));
        assertThat(service.canReview()).isEqualTo("PLAT_MAN".equalsIgnoreCase(roleName));
    }

    @Test
    void foreignTenantCannotBeReviewed() {
        SsResource target = pendingTarget();
        target.setComAcctId(2L);
        when(resources.findByIdForUpdate(101L)).thenReturn(target);
        assertThatThrownBy(() -> service.review(101L, 10L, true)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(mapper);
    }

    @Test
    void missingPublicationRequestCannotBeReviewedAsUseApplication() {
        when(resources.findByIdForUpdate(101L)).thenReturn(pendingTarget());
        assertThatThrownBy(() -> service.review(101L, 10L, true)).isInstanceOf(IllegalArgumentException.class);
        verify(resources, never()).updateResourceEntity(any());
        verify(mapper, never()).updateById(any(PrivilegeGrant.class));
    }

    private SsResource pendingTarget() {
        SsResource target = new SsResource();
        target.setResourceId(101L);
        target.setResourceBizType("SKILL");
        target.setOwnerType("enterprise");
        target.setComAcctId(1L);
        target.setResourceStatus(4);
        return target;
    }
}
