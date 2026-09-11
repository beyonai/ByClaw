package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import org.springframework.stereotype.Service;
import java.util.Objects;

/** Authorization is repeated server-side; a session identifier is never an access token. */
@Service
public class DataSourceAccessService {
    private final ProjectService projects;
    private final ProjectMemberService projectMembers;
    private final ByaiSessionMapper sessions;
    private final SessionMemberService sessionMembers;

    public DataSourceAccessService(ProjectService projects, ProjectMemberService projectMembers,
            ByaiSessionMapper sessions, SessionMemberService sessionMembers) {
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
