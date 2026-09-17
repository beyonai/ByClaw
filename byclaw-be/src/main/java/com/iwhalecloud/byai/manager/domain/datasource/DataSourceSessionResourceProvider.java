package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.manager.application.service.datasource.ProjectDataSourceService;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import org.springframework.stereotype.Component;

@Component
public class DataSourceSessionResourceProvider implements SessionResourceProvider {
    private final ProjectDataSourceService sources;

    public DataSourceSessionResourceProvider(ProjectDataSourceService sources) {
        this.sources = sources;
    }

    @Override
    public String resourceType() {
        return "data_source";
    }

    @Override
    public SessionResourcePage query(Project project, SessionResourceQueryDto query, boolean includeCredentials) {
        return sources.query(project.getProjectId(), query, includeCredentials);
    }
}
