package com.iwhalecloud.byai.manager.application.service.datasource;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.domain.datasource.DataSourceAccessService;
import com.iwhalecloud.byai.manager.domain.datasource.OpenGaussDataSourceProvider;
import com.iwhalecloud.byai.manager.dto.datasource.*;
import com.iwhalecloud.byai.manager.entity.datasource.Datasource;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.datasource.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProjectDataSourceServiceTest {
    private final DataSourceMapper sources = mock(DataSourceMapper.class);
    private final ProjectDataSourceMapper bindings = mock(ProjectDataSourceMapper.class);
    private final DataSourceAccessService access = mock(DataSourceAccessService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final ObjectMapper json = new ObjectMapper();
    private ProjectDataSourceService service;

    @BeforeEach
    void setup() {
        service = new ProjectDataSourceService(sources, bindings, access, sequence, json,
            List.of(new OpenGaussDataSourceProvider()));
        Project project = new Project();
        project.setProjectId(10L);
        project.setCreateBy(7L);
        when(access.currentUserId()).thenReturn(7L);
        when(access.requireProject(anyLong(), anyBoolean())).thenReturn(project);
        when(sequence.nextVal()).thenReturn(99L);
    }

    @Test
    void createEncryptsPasswordAndNeverSerializesItToManagementResponses() throws Exception {
        DataSourceSaveDto request = request();
        request.setPassword("test-only-secret");
        DataSourceView result = service.create(request);
        ArgumentCaptor<Datasource> saved = ArgumentCaptor.forClass(Datasource.class);
        verify(sources).insert(saved.capture());
        assertThat(saved.getValue().getPasswordCipher()).isNotEqualTo(request.getPassword());
        assertThat(Sm4Util.decrypt(saved.getValue().getPasswordCipher())).isEqualTo(request.getPassword());
        assertThat(json.writeValueAsString(result)).doesNotContain("test-only-secret", "passwordCipher");
        assertThat(json.writeValueAsString(request)).doesNotContain("test-only-secret");
        assertThat(com.alibaba.fastjson.JSON.toJSONString(request)).doesNotContain("test-only-secret");
        assertThat(result.hasPassword()).isTrue();
        verify(bindings).bind(10L, 99L, 7L);
    }

    @Test
    void omittedAndEmptyUpdatePasswordPreserveCipherButReplacementChangesIt() {
        Datasource source = existing();
        String original = source.getPasswordCipher();
        DataSourceSaveDto request = request();
        request.setDatasourceId(99L);
        service.update(request);
        assertThat(source.getPasswordCipher()).isEqualTo(original);
        request.setPassword("");
        service.update(request);
        assertThat(source.getPasswordCipher()).isEqualTo(original);
        request.setPassword("replacement-test-secret");
        service.update(request);
        assertThat(Sm4Util.decrypt(source.getPasswordCipher())).isEqualTo("replacement-test-secret");
    }

    @Test
    void reuseAndUnlinkDoNotDuplicateOrDeleteSharedSource() {
        Datasource source = existing();
        service.bind(20L, 99L);
        service.unbind(10L, 99L);
        verify(bindings).bind(20L, 99L, 7L);
        verify(bindings).unbind(10L, 99L);
        verify(bindings, never()).deleteForSource(anyLong());
        verify(sources, never()).insert(any(Datasource.class));
        verify(sources, never()).updateById(any(Datasource.class));
        verify(sources, never()).deleteById(anyLong());
        assertThat(source.getPasswordCipher()).isNotEmpty();
    }

    @Test
    void bindingChecksExistenceAfterLockAndSkipsExistingRelation() {
        existing();
        service.bind(10L, 99L);
        var order = inOrder(sources, bindings);
        order.verify(sources).lockById(99L);
        order.verify(bindings).countBinding(10L, 99L);
        verify(bindings, never()).bind(anyLong(), anyLong(), anyLong());
        service.bind(20L, 99L);
        order.verify(sources).lockById(99L);
        order.verify(bindings).countBinding(20L, 99L);
        order.verify(bindings).bind(20L, 99L, 7L);
    }

    @Test
    void deletionPhysicallyRemovesSourceAfterAllBindings() {
        existing();
        service.delete(10L, 99L);
        var order = inOrder(bindings, sources);
        order.verify(bindings).deleteForSource(99L);
        order.verify(sources).deleteById(99L);
        verify(sources, never()).updateById(any(Datasource.class));
    }

    @Test
    void bindingDeletionFailureDoesNotDeleteSource() {
        existing();
        doThrow(new IllegalStateException("binding deletion failed")).when(bindings).deleteForSource(99L);
        assertThatThrownBy(() -> service.delete(10L, 99L)).isInstanceOf(IllegalStateException.class);
        verify(sources, never()).deleteById(anyLong());
    }

    @Test
    void anotherSourceOwnerCannotUpdateDeleteOrReuseEvenWithProjectAccess() {
        existing().setCreateBy(8L);
        DataSourceSaveDto request = request();
        request.setDatasourceId(99L);
        assertThatThrownBy(() -> service.update(request)).isInstanceOf(BaseException.class);
        assertThatThrownBy(() -> service.delete(10L, 99L)).isInstanceOf(BaseException.class);
        assertThatThrownBy(() -> service.bind(20L, 99L)).isInstanceOf(BaseException.class);
        verify(sources, never()).updateById(any(Datasource.class));
        verify(bindings, never()).bind(anyLong(), anyLong(), anyLong());
        verify(bindings, never()).deleteForSource(anyLong());
    }

    @Test
    void missingBindingCannotBeUsedToMutateOwnedSource() {
        existing();
        when(bindings.countBinding(10L, 99L)).thenReturn(0);
        assertThatThrownBy(() -> service.delete(10L, 99L)).isInstanceOf(BaseException.class);
        verify(bindings, never()).deleteForSource(anyLong());
    }

    @Test
    void queryReturnsPageMetadataAndOnlyExplicitCredentialQueryDecrypts() throws Exception {
        Datasource source = existing();
        SessionResourceQueryDto query = new SessionResourceQueryDto();
        query.setPageNum(3);
        query.setPageSize(2);
        query.setResourceId(99L);
        query.setKeyword("report");
        query.setDatasourceType("opengauss");
        when(sources.countQuery(10L, query)).thenReturn(5L);
        when(sources.query(10L, query, 4L)).thenReturn(List.of(source));
        SessionResourcePage safe = service.query(10L, query, false);
        assertThat(safe.total()).isEqualTo(5);
        assertThat(safe.pageNum()).isEqualTo(3);
        assertThat(safe.pageSize()).isEqualTo(2);
        assertThat(safe.items().getFirst())
            .containsEntry("datasourceId", "99").containsEntry("datasourceName", "report")
            .containsEntry("datasourceType", "opengauss").containsKey("connectionConfig")
            .doesNotContainKeys("credentials", "dataSourceId", "name", "type", "config");
        assertThat(json.writeValueAsString(safe)).doesNotContain("test-only-secret", source.getPasswordCipher());
        assertThat(service.query(10L, query, true).items().getFirst())
            .containsEntry("credentials", Map.of("password", "test-only-secret"));
    }

    @Test
    void unknownTypeAndMissingCreatePasswordFailBeforePersistence() {
        DataSourceSaveDto request = request();
        assertThatThrownBy(() -> service.create(request)).isInstanceOf(BaseException.class);
        request.setPassword("test-only-secret");
        request.setDatasourceType("mysql");
        assertThatThrownBy(() -> service.create(request)).isInstanceOf(BaseException.class);
        SessionResourceQueryDto query = new SessionResourceQueryDto();
        query.setDatasourceType("mysql");
        assertThatThrownBy(() -> service.query(10L, query, false)).isInstanceOf(BaseException.class);
        verifyNoInteractions(sources, bindings);
    }

    private Datasource existing() {
        Datasource source = new Datasource();
        source.setDatasourceId(99L);
        source.setCreateBy(7L);
        source.setDatasourceType("opengauss");
        source.setDatasourceName("report");
        source.setConnectionConfig("{\"host\":\"localhost\",\"database\":\"report\",\"username\":\"reader\"}");
        source.setPasswordCipher(Sm4Util.encrypt("test-only-secret"));
        when(sources.lockById(99L)).thenReturn(source);
        when(bindings.countBinding(10L, 99L)).thenReturn(1);
        return source;
    }

    private DataSourceSaveDto request() {
        DataSourceSaveDto request = new DataSourceSaveDto();
        request.setProjectId(10L);
        request.setDatasourceName("report");
        request.setDatasourceType("opengauss");
        request.setConnectionConfig(Map.of("host", "localhost", "database", "report", "username", "reader"));
        return request;
    }
}
