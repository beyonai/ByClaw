package com.iwhalecloud.byai.manager.application.service.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.domain.datasource.DataSourceAccessService;
import com.iwhalecloud.byai.manager.domain.datasource.SessionResourceProvider;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class SessionResourceQueryService {
    private final DataSourceAccessService access;
    private final Map<String, SessionResourceProvider> providers;

    public SessionResourceQueryService(DataSourceAccessService access, List<SessionResourceProvider> providers) {
        this.access = access;
        this.providers = providers.stream().collect(Collectors.toUnmodifiableMap(SessionResourceProvider::resourceType, Function.identity()));
    }

    public SessionResourcePage query(SessionResourceQueryDto query, boolean external) {
        if (query == null || query.getSessionId() == null || query.getPageNum() < 1 || query.getPageNum() > 1000000
                || query.getPageSize() < 1 || query.getPageSize() > 100) {
            throw new BaseException(400, "datasource.query.invalid");
        }
        if (!external && query.isIncludeCredentials()) {
            throw new BaseException(403, "datasource.browser.credentials.forbidden");
        }
        SessionResourceProvider provider = query.getResourceType() == null ? null
            : providers.get(query.getResourceType().trim().toLowerCase(Locale.ROOT));
        if (provider == null) throw new BaseException(400, "datasource.resource.type.unsupported");
        Project project = access.requireSessionProject(query.getSessionId());
        return provider.query(project, query, external && query.isIncludeCredentials());
    }
}
