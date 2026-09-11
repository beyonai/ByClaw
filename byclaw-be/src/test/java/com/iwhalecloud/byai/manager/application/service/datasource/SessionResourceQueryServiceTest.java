package com.iwhalecloud.byai.manager.application.service.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.domain.datasource.*;
import com.iwhalecloud.byai.manager.dto.datasource.*;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SessionResourceQueryServiceTest {
    private final DataSourceAccessService access = mock(DataSourceAccessService.class);
    private final SessionResourceProvider provider = mock(SessionResourceProvider.class);
    private final Project project = new Project();
    private SessionResourceQueryService service;

    @BeforeEach
    void setup() {
        when(provider.resourceType()).thenReturn("data_source");
        service = new SessionResourceQueryService(access, List.of(provider, new ProjectSessionResourceProvider()));
        project.setProjectId(10L);
        project.setProjectName("Report Project");
        when(access.requireSessionProject(50L)).thenReturn(project);
    }

    @Test
    void browserCredentialsAreRejectedBeforeAnyResourceLookup() {
        SessionResourceQueryDto query = query();
        query.setIncludeCredentials(true);
        assertThatThrownBy(() -> service.query(query, false)).isInstanceOf(BaseException.class);
        verifyNoInteractions(access);
        verify(provider, never()).query(any(), any(), anyBoolean());
    }

    @Test
    void externalCredentialsRequireExplicitOptInAndAuthorizedSession() {
        SessionResourceQueryDto query = query();
        service.query(query, true);
        verify(provider).query(project, query, false);
        query.setIncludeCredentials(true);
        service.query(query, true);
        verify(provider).query(project, query, true);
        when(access.requireSessionProject(50L)).thenThrow(new BaseException(403, "denied"));
        clearInvocations(provider);
        assertThatThrownBy(() -> service.query(query, true)).isInstanceOf(BaseException.class);
        verify(provider, never()).query(any(), any(), anyBoolean());
    }

    @Test
    void uppercaseConversationResourceTypeResolvesSameProvider() {
        SessionResourceQueryDto query = query();
        query.setResourceType("DATA_SOURCE");
        service.query(query, false);
        verify(provider).query(project, query, false);
    }

    @Test
    void invalidPaginationAndUnknownResourceTypeFailBeforeAuthorization() {
        for (int size : new int[]{0, 101}) {
            SessionResourceQueryDto query = query();
            query.setPageSize(size);
            assertThatThrownBy(() -> service.query(query, false)).isInstanceOf(BaseException.class);
        }
        for (int page : new int[]{0, 1000001}) {
            SessionResourceQueryDto query = query();
            query.setPageNum(page);
            assertThatThrownBy(() -> service.query(query, false)).isInstanceOf(BaseException.class);
        }
        SessionResourceQueryDto query = query();
        query.setResourceType("unknown");
        assertThatThrownBy(() -> service.query(query, false)).isInstanceOf(BaseException.class);
        verifyNoInteractions(access);
    }

    @Test
    void projectProviderAppliesIdKeywordAndPageWithoutLeakingOtherFields() {
        SessionResourceQueryDto query = query();
        query.setResourceType("project");
        query.setKeyword("REPORT");
        SessionResourcePage first = service.query(query, false);
        assertThat(first.total()).isEqualTo(1);
        assertThat(first.items().getFirst()).containsEntry("resourceId", "10")
            .doesNotContainKeys("credentials", "createBy");
        query.setPageNum(2);
        SessionResourcePage second = service.query(query, false);
        assertThat(second.total()).isEqualTo(1);
        assertThat(second.items()).isEmpty();
        query.setResourceId(11L);
        assertThat(service.query(query, false).total()).isZero();
        query.setResourceId(null);
        query.setKeyword("missing");
        assertThat(service.query(query, false).total()).isZero();
    }

    @Test
    void projectProviderRejectsDatasourceOnlyOptions() {
        SessionResourceQueryDto query = query();
        query.setResourceType("project");
        query.setDatasourceType("opengauss");
        assertThatThrownBy(() -> service.query(query, true)).isInstanceOf(BaseException.class);
        query.setDatasourceType(null);
        query.setIncludeCredentials(true);
        assertThatThrownBy(() -> service.query(query, true)).isInstanceOf(BaseException.class);
    }

    private SessionResourceQueryDto query() {
        SessionResourceQueryDto query = new SessionResourceQueryDto();
        query.setSessionId(50L);
        query.setResourceType("data_source");
        return query;
    }
}
