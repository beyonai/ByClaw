package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.manager.dto.datasource.SessionResourcePage;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;

/** New resource kinds implement a provider; all share the same session/project authorization boundary. */
public interface SessionResourceProvider {
    String resourceType();
    SessionResourcePage query(Project project, SessionResourceQueryDto query, boolean includeCredentials);
}
