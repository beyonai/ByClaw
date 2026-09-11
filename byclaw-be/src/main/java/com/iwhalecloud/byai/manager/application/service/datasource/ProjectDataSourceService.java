package com.iwhalecloud.byai.manager.application.service.datasource;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.domain.datasource.DataSourceAccessService;
import com.iwhalecloud.byai.manager.domain.datasource.DataSourceTypeProvider;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceSaveDto;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceView;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.entity.datasource.Datasource;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.datasource.DataSourceMapper;
import com.iwhalecloud.byai.manager.mapper.datasource.ProjectDataSourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ProjectDataSourceService {
    private final DataSourceMapper sources;
    private final ProjectDataSourceMapper bindings;
    private final DataSourceAccessService access;
    private final SequenceService sequence;
    private final ObjectMapper json;
    private final Map<String, DataSourceTypeProvider> providers;

    public ProjectDataSourceService(DataSourceMapper sources, ProjectDataSourceMapper bindings,
            DataSourceAccessService access, SequenceService sequence, ObjectMapper json,
            List<DataSourceTypeProvider> providers) {
        this.sources = sources;
        this.bindings = bindings;
        this.access = access;
        this.sequence = sequence;
        this.json = json;
        this.providers = providers.stream().collect(Collectors.toUnmodifiableMap(DataSourceTypeProvider::type, Function.identity()));
    }

    public List<DataSourceView> list(Long projectId) {
        Project project = access.requireProject(projectId, false);
        return sources.listByProject(projectId).stream().map(source -> view(source, project)).toList();
    }

    public List<DataSourceView> available(Long projectId) {
        Project project = access.requireProject(projectId, true);
        return sources.listAvailable(projectId, access.currentUserId()).stream().map(source -> view(source, project)).toList();
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public DataSourceView create(DataSourceSaveDto request) {
        Project project = access.requireProject(request.getProjectId(), true);
        if (request.getDatasourceId() != null) {
            throw new BaseException(400, "datasource.create.id.forbidden");
        }
        if (request.getPassword() == null || request.getPassword().isEmpty()) {
            throw new BaseException(400, "datasource.password.required");
        }
        Datasource source = new Datasource();
        source.setDatasourceId(sequence.nextVal());
        source.setCreateBy(access.currentUserId());
        source.setCreateTime(new Date());
        apply(request, source);
        sources.insert(source);
        bindings.bind(project.getProjectId(), source.getDatasourceId(), access.currentUserId());
        return view(source, project);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public DataSourceView update(DataSourceSaveDto request) {
        Project project = access.requireProject(request.getProjectId(), false);
        Datasource source = requireOwnedBinding(request.getProjectId(), request.getDatasourceId());
        if (!source.getDatasourceType().equals(normalizeType(request.getDatasourceType()))) {
            throw new BaseException(400, "datasource.type.immutable");
        }
        apply(request, source);
        sources.updateById(source);
        return view(source, project);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void bind(Long projectId, Long sourceId) {
        access.requireProject(projectId, true);
        Datasource source = requireOwnedSource(sourceId);
        // 同一事务已锁定数据源行，串行化判断与插入，避免并发重复关联。
        if (bindings.countBinding(projectId, source.getDatasourceId()) == 0) {
            bindings.bind(projectId, source.getDatasourceId(), access.currentUserId());
        }
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void unbind(Long projectId, Long sourceId) {
        access.requireProject(projectId, true);
        requireSource(sourceId); // same lock order as delete/bind
        bindings.unbind(projectId, sourceId);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void delete(Long projectId, Long sourceId) {
        access.requireProject(projectId, false);
        requireOwnedBinding(projectId, sourceId);
        bindings.deleteForSource(sourceId);
        sources.deleteById(sourceId);
    }

    /** Called only by the authorized session query provider; browser queries always pass false. */
    public SessionResourcePage query(Long projectId, SessionResourceQueryDto query, boolean includeCredentials) {
        Project project = access.requireProject(projectId, false);
        if (query.getDatasourceType() != null && !providers.containsKey(query.getDatasourceType())) {
            throw new BaseException(400, "datasource.type.unsupported");
        }
        long total = sources.countQuery(projectId, query);
        List<Map<String, Object>> items = sources.query(projectId, query, query.offset()).stream().map(source -> {
            DataSourceView dto = view(source, project);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("resourceType", "data_source");
            item.put("resourceId", dto.datasourceId());
            item.put("datasourceId", dto.datasourceId());
            item.put("datasourceName", dto.datasourceName());
            item.put("description", dto.description());
            item.put("datasourceType", dto.datasourceType());
            item.put("connectionConfig", dto.connectionConfig());
            item.put("hasPassword", dto.hasPassword());
            item.put("canEdit", dto.canEdit());
            item.put("canManageBinding", dto.canManageBinding());
            if (includeCredentials) {
                item.put("credentials", Map.of("password", Sm4Util.decrypt(source.getPasswordCipher())));
            }
            return item;
        }).toList();
        return new SessionResourcePage(items, total, query.getPageNum(), query.getPageSize());
    }

    private Datasource requireSource(Long sourceId) {
        Datasource source = sourceId == null ? null : sources.lockById(sourceId);
        if (source == null) throw new BaseException(404, "datasource.not.found");
        return source;
    }

    private Datasource requireOwnedSource(Long sourceId) {
        Datasource source = requireSource(sourceId);
        if (!Objects.equals(source.getCreateBy(), access.currentUserId())) {
            throw new BaseException(403, "datasource.owner.required");
        }
        return source;
    }

    private Datasource requireOwnedBinding(Long projectId, Long sourceId) {
        Datasource source = requireOwnedSource(sourceId);
        if (bindings.countBinding(projectId, sourceId) == 0) {
            throw new BaseException(404, "datasource.binding.not.found");
        }
        return source;
    }

    private void apply(DataSourceSaveDto request, Datasource source) {
        String type = normalizeType(request.getDatasourceType());
        DataSourceTypeProvider provider = providers.get(type);
        if (provider == null) throw new BaseException(400, "datasource.type.unsupported");
        Map<String, Object> config = provider.validate(request.getConnectionConfig());
        if (request.getDatasourceName() == null || request.getDatasourceName().isBlank() || request.getDatasourceName().length() > 128
                || (request.getDescription() != null && request.getDescription().length() > 2000)
                || (request.getPassword() != null && request.getPassword().length() > 4096)) {
            throw new BaseException(400, "datasource.fields.invalid");
        }
        source.setDatasourceName(request.getDatasourceName().trim());
        source.setDescription(request.getDescription() == null ? "" : request.getDescription());
        source.setDatasourceType(type);
        try {
            source.setConnectionConfig(json.writeValueAsString(config));
        } catch (JsonProcessingException e) {
            throw new BaseException(400, "datasource.config.invalid");
        }
        if (request.getPassword() != null && !request.getPassword().isEmpty()) {
            source.setPasswordCipher(Sm4Util.encrypt(request.getPassword()));
        }
        source.setUpdateBy(access.currentUserId());
        source.setUpdateTime(new Date());
    }

    private String normalizeType(String type) {
        return type == null ? "" : type.trim().toLowerCase(Locale.ROOT);
    }

    private DataSourceView view(Datasource source, Project project) {
        try {
            Map<String, Object> config = json.readValue(source.getConnectionConfig(), new TypeReference<Map<String, Object>>() {});
            // Revalidate persisted JSON to prevent unknown/secret fields from leaking through historical data.
            DataSourceTypeProvider provider = providers.get(source.getDatasourceType());
            if (provider == null) throw new BaseException(400, "datasource.type.unsupported");
            return new DataSourceView(source.getDatasourceId().toString(), source.getDatasourceName(), source.getDescription(),
                source.getDatasourceType(), provider.validate(config), source.getPasswordCipher() != null && !source.getPasswordCipher().isEmpty(),
                Objects.equals(source.getCreateBy(), access.currentUserId()),
                Objects.equals(project.getCreateBy(), access.currentUserId()));
        } catch (JsonProcessingException e) {
            throw new BaseException(500, "datasource.stored.config.invalid");
        }
    }
}
