package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceFavoriteQo;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceFavoriteMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class ResourceFavoriteServiceTest {
    private final ResourceFavoriteMapper mapper = mock(ResourceFavoriteMapper.class);
    private final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    private final AuthApplicationService auth = mock(AuthApplicationService.class);
    private final ResourceFavoriteService service = new ResourceFavoriteService(mapper, config, auth);

    @BeforeEach
    void login() {
        LoginInfo login = new LoginInfo();
        login.setUserId(11L);
        login.setEnterpriseId(22L);
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void logout() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void ordinaryListsDoNotReadConfigOrFavorites() {
        assertThat(service.resolveQueryTenant(null, null)).isNull();
        assertThat(service.resolveQueryTenant(false, false)).isNull();
        verifyNoInteractions(config, mapper, auth);
    }

    @Test
    void openSourceCannotActivateFavorites() {
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("openSource");
        assertThat(service.resolveQueryTenant(true, false)).isNull();
        assertThatThrownBy(() -> service.resolveQueryTenant(true, true)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(mapper, auth);
    }

    @Test
    void missingTablesKeepOfficialListsOnOriginalQueryAndRejectFavoriteOperations() {
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        for (int i = 0; i < 10; i++) {
            assertThat(service.resolveQueryTenant(true, false)).isNull();
        }
        assertThatThrownBy(() -> service.resolveQueryTenant(true, true))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        assertThatThrownBy(() -> service.setFavorite(request(true)))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
        verify(mapper, times(1)).isSchemaReady();
        verifyNoMoreInteractions(mapper);
        verifyNoInteractions(auth);
    }

    @Test
    void readySchemaIsCheckedOnlyOnceAcrossListsAndMutations() {
        commercial();
        resource("SKILL", "enterprise", 2);
        for (int i = 0; i < 10; i++) {
            assertThat(service.resolveQueryTenant(true, false)).isEqualTo(22L);
        }
        service.setFavorite(request(true));
        verify(mapper, times(1)).isSchemaReady();
    }

    @Test
    void unavailableAndNoncommercialMutationsAreBusinessErrorsRatherThanExpiredLogin() {
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("openSource");
        assertThatThrownBy(() -> service.setFavorite(request(true)))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        commercial();
        resource("SKILL", "enterprise", 3);
        assertThatThrownBy(() -> service.setFavorite(request(true)))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        resource("SKILL", "enterprise", 2);
        when(auth.queryCurrentUserUseBlacklistedResourceIds(any(), any())).thenReturn(Set.of(33L));
        assertThatThrownBy(() -> service.setFavorite(request(true)))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(e -> assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        verify(mapper, never()).ensureCount(any(), any());
    }

    @Test
    void tenantAndUserComeFromLogin() {
        commercial();
        assertThat(service.resolveQueryTenant(true, true)).isEqualTo(22L);
        CurrentUserHolder.setLoginInfo(null);
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        verify(mapper, times(1)).isSchemaReady();
        verifyNoMoreInteractions(mapper);
    }

    @ParameterizedTest
    @ValueSource(strings = {"DIG_EMPLOYEE", "SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void favoritesSupportedResourceTypesWithoutGrantingUse(String type) {
        commercial();
        resource(type, "enterprise", 2);
        when(mapper.lockCount(33L, 22L)).thenReturn(7L);
        when(mapper.insertFavorite(33L, 22L, 11L)).thenReturn(1);

        var result = service.setFavorite(request(true));

        assertThat(result.favorited()).isTrue();
        assertThat(result.favoriteCount()).isEqualTo(8);
        var order = inOrder(mapper);
        order.verify(mapper).selectResource(33L, 22L);
        order.verify(mapper).ensureCount(33L, 22L);
        order.verify(mapper).lockCount(33L, 22L);
        order.verify(mapper).insertFavorite(33L, 22L, 11L);
        order.verify(mapper).updateCount(33L, 22L, 1);
        verify(auth).queryCurrentUserUseBlacklistedResourceIds(List.of(33L), List.of(type));
        verifyNoMoreInteractions(auth);
    }

    @Test
    void repeatedFavoriteDoesNotIncrementCount() {
        commercial();
        resource("SKILL", "enterprise", 2);
        when(mapper.lockCount(33L, 22L)).thenReturn(7L);
        when(mapper.insertFavorite(33L, 22L, 11L)).thenReturn(0);
        assertThat(service.setFavorite(request(true)).favoriteCount()).isEqualTo(7L);
        verify(mapper, never()).updateCount(any(), any(), anyInt());
    }

    @Test
    void cancellationWorksForOffShelfResourceAndIsIdempotent() {
        commercial();
        resource("SKILL", "enterprise", 3);
        when(mapper.lockCount(33L, 22L)).thenReturn(7L, 6L);
        when(mapper.deleteFavorite(33L, 22L, 11L)).thenReturn(1, 0);
        assertThat(service.setFavorite(request(false)).favoriteCount()).isEqualTo(6L);
        assertThat(service.setFavorite(request(false)).favoriteCount()).isEqualTo(6L);
        verify(mapper, times(1)).updateCount(33L, 22L, -1);
        verifyNoInteractions(auth);
    }

    @Test
    void rejectsSkillGroupsPersonalAndOtherTenantResources() {
        commercial();
        resource("SKILL_GROUP", "enterprise", 2);
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        resource("SKILL", "personal", 2);
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        when(mapper.selectResource(33L, 22L)).thenReturn(null);
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        verify(mapper, never()).ensureCount(any(), any());
    }

    @Test
    void rejectsUnavailableOrBlacklistedResourcesBeforeWriting() {
        commercial();
        resource("SKILL", "enterprise", 3);
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        resource("SKILL", "enterprise", 2);
        when(auth.queryCurrentUserUseBlacklistedResourceIds(any(), any())).thenReturn(Set.of(33L));
        assertThatThrownBy(() -> service.setFavorite(request(true))).isInstanceOf(ResponseStatusException.class);
        verify(mapper, never()).ensureCount(any(), any());
    }

    private void commercial() {
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        when(mapper.isSchemaReady()).thenReturn(true);
    }

    private void resource(String type, String owner, int status) {
        SsResource resource = new SsResource();
        resource.setResourceId(33L);
        resource.setResourceBizType(type);
        resource.setOwnerType(owner);
        resource.setResourceStatus(status);
        when(mapper.selectResource(33L, 22L)).thenReturn(resource);
    }

    private ResourceFavoriteQo request(boolean favorited) {
        ResourceFavoriteQo request = new ResourceFavoriteQo();
        request.setResourceId(33L);
        request.setFavorited(favorited);
        return request;
    }
}
