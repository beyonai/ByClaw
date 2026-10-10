package com.iwhalecloud.byai.manager.domain.datasource;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import org.springframework.stereotype.Service;
import java.util.Objects;

/** Authorization is repeated server-side; a session identifier is never an access token. */
@Service
public class DataSourceAccessService {
    private final TenantNodeClient tenantNode;
    private final ProjectService projects;
    private final ProjectMemberService projectMembers;
    private final ByaiSessionMapper sessions;
    private final SessionMemberService sessionMembers;

    public DataSourceAccessService(ProjectService projects, ProjectMemberService projectMembers,
            ByaiSessionMapper sessions, SessionMemberService sessionMembers) {
        this(projects, projectMembers, sessions, sessionMembers, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public DataSourceAccessService(ProjectService projects, ProjectMemberService projectMembers,
            ByaiSessionMapper sessions, SessionMemberService sessionMembers,
            TenantNodeClient tenantNode) {
        this.tenantNode = tenantNode;
        this.projects = projects;
        this.projectMembers = projectMembers;
        this.sessions = sessions;
        this.sessionMembers = sessionMembers;
    }

    public Long currentUserId() {
        if (CurrentUserHolder.getLoginInfo() == null || CurrentUserHolder.getLoginInfo().getUserId() == null) {
            throw new BaseException(403, "datasource.authentication.required");
        }
        return CurrentUserHolder.getCurrentUserId();
    }

    public Project requireProject(Long projectId, boolean manage) {
        Long userId = currentUserId();
        Project project = projectId == null ? null : projects.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(404, "datasource.project.not.found");
        }
        boolean owner = Objects.equals(project.getCreateBy(), userId);
        if (!owner && (manage || !projectMembers.isMember(projectId, userId))) {
            throw new BaseException(403, "datasource.project.access.denied");
        }
        return project;
    }

    public Project requireSessionProject(Long sessionId) {
        Long userId = currentUserId();
        var tenant = TenantRequestContextHolder.get();
        if (tenant != null) {
            if (sessionId == null || sessionId <= 0) throw new BaseException(404, "datasource.session.not.found");
            if (tenantNode == null) throw new BaseException(503, "datasource.session.not.ready");
            var session = tenantNode.request(tenant, "GET", "/internal/v1/sessions/" + sessionId, null,
                new TypeReference<SessionView>() { });
            if (session == null || !sessionId.toString().equals(session.sessionId())
                || !Long.toString(tenant.enterpriseId()).equals(session.enterpriseId())) {
                throw new BaseException(404, "datasource.session.not.found");
            }
            // Tenant group tasks need not belong to a project; they have no project resources.
            if (session.projectId() == null || "-1".equals(session.projectId())) return null;
            return requireProject(Long.valueOf(session.projectId()), false);
        }
        ByaiSession session = sessionId == null ? null : sessions.selectById(sessionId);
        if (session == null) {
            throw new BaseException(404, "datasource.session.not.found");
        }
        if (!Objects.equals(session.getCreatorId(), userId)
                && sessionMembers.findSessionMember(sessionId, "USER", userId) == null) {
            throw new BaseException(403, "datasource.session.access.denied");
        }
        if (session.getProjectId() == null) {
            throw new BaseException(400, "datasource.session.project.required");
        }
        return requireProject(session.getProjectId(), false);
    }
}
