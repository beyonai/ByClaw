package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import org.springframework.stereotype.Component;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/** Safe project metadata is a second provider, demonstrating that the query is resource-neutral. */
@Component
public class ProjectSessionResourceProvider implements SessionResourceProvider {
    @Override
    public String resourceType() {
        return "project";
    }

    @Override
    public SessionResourcePage query(Project project, SessionResourceQueryDto query, boolean includeCredentials) {
        if (query.getDatasourceType() != null || includeCredentials) {
            throw new BaseException(400, "datasource.project.filter.unsupported");
        }
        boolean matches = (query.getResourceId() == null || Objects.equals(query.getResourceId(), project.getProjectId()))
            && (query.getKeyword() == null || Objects.toString(project.getProjectName(), "").toLowerCase(Locale.ROOT)
                .contains(query.getKeyword().toLowerCase(Locale.ROOT)));
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("resourceType", resourceType());
        item.put("resourceId", project.getProjectId().toString());
        item.put("projectId", project.getProjectId().toString());
        item.put("name", project.getProjectName());
        item.put("description", project.getDescription());
        item.put("projectType", project.getProjectType());
        return new SessionResourcePage(matches && query.getPageNum() == 1 ? List.of(item) : List.of(),
            matches ? 1 : 0, query.getPageNum(), query.getPageSize());
    }
}
