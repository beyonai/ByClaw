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

    @BeforeEach
    void setup() {
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

    @ParameterizedTest @ValueSource(strings = {"ordinary-user", "platform", "adminvip"})
    void everyNewPublicationUsesOrganizationReviewWithoutCreatingUseGrants(String userCode) {
        CurrentUserHolder.getLoginInfo().setUserCode(userCode);
        var publications = mock(ResourcePublicationService.class);
        ReflectionTestUtils.setField(service, "publications", publications);
        SsResource source = new SsResource(); source.setResourceId(100L);
        SsResource target = pendingTarget();
        var scope = new com.iwhalecloud.byai.manager.dto.resource.ResourcePublishScope("ORGS", List.of(123L));
        service.submit(source, target, scope);
        verify(publications).submitLocal(101L, scope);
        verifyNoInteractions(mapper);
        assertThat(target.getResourceStatus()).isEqualTo(2);
        assertThat(target.getPublishScopeMode()).isEqualTo("NONE");
        assertThat(target.getPublishScopeController()).isEqualTo("BYAI");
        when(resources.findByIdForUpdate(101L)).thenReturn(target);
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        assertThatThrownBy(() -> service.review(101L, 10L, true)).hasMessageContaining("按组织处理");
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
        assertThatThrownBy(() -> service.review(101L, 10L, approve)).isInstanceOf(IllegalArgumentException.class);
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
