package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import java.util.Objects;
import org.springframework.stereotype.Component;

/** A Files row may carry a stricter resource/project scope in addition to its owning upload session. */
@Component
public class ForwardUploadScope {
    private final ProjectService projects;
    private final SsResourceService resources;
    private final AuthApplicationService auth;
    private final ProjectMemberService members;
    private final TenantProjectCloudAccessService tenantCloud;
    public ForwardUploadScope(ProjectService projects,SsResourceService resources,AuthApplicationService auth,
            ProjectMemberService members,TenantProjectCloudAccessService tenantCloud) {
        this.projects=projects;this.resources=resources;this.auth=auth;this.members=members;this.tenantCloud=tenantCloud;
    }
    public void require(ForwardActor actor,Files file) {
        if(file.getDatasetId()!=null) {
            var resource=resources.findById(file.getDatasetId());
            if(resource==null || !Objects.equals(resource.getComAcctId(),actor.enterpriseId())
                || !auth.hasResourceForwardReadPermission(resource,actor.userId(),actor.enterpriseId())) throw denied();
        }
        if(file.getProjectId()!=null) {
            var project=projects.findById(file.getProjectId());
            if(project==null || !Objects.equals(project.getEnterpriseId(),actor.enterpriseId()) || "1".equals(project.getDeleteFlag())) throw denied();
            Boolean tenant=tenantCloud.canRead(project,actor.userId(),actor.enterpriseId());
            boolean allowed=tenant!=null?tenant:Objects.equals(project.getCreateBy(),actor.userId()) || members.isMember(project.getProjectId(),actor.userId());
            if(!allowed) throw denied();
        }
    }
    private static IllegalArgumentException denied() {return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");}
}
