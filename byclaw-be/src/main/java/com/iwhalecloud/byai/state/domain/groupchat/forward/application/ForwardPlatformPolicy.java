package com.iwhalecloud.byai.state.domain.groupchat.forward.application;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.springframework.stereotype.Component;
import java.util.Date;
/** Explicit persisted actors are checked without creating or impersonating an HTTP login. */
@Component
public class ForwardPlatformPolicy {
    private final UserService users;
    private final EnterpriseInfoService enterprises;
    private final TenantMembershipMapper memberships;
    private final ObjectMapper json;
    public ForwardPlatformPolicy(UserService users, EnterpriseInfoService enterprises, TenantMembershipMapper memberships, ObjectMapper json) {
        this.users=users;
        this.enterprises=enterprises;
        this.memberships=memberships;
        this.json=json;
    }
    public TenantRequestContext requireNewWork(ForwardActor actor, ForwardBackend backend) {
        var user=users.findById(actor.userId());
        if(user==null || !"A".equals(user.getState()) || "Y".equalsIgnoreCase(user.getIsLocked()) || user.getUserExpDate()!=null && user.getUserExpDate().before(new Date()) || enterprises.findById(actor.enterpriseId())==null) throw denied();
        if(backend==ForwardBackend.LEGACY && actor.enterpriseId()==1) return new TenantRequestContext(actor.userId(),actor.enterpriseId(),"MEMBER");
        var membership=memberships.selectActiveMembership(actor.userId(),actor.enterpriseId());
        if(membership==null) throw denied();
        if(backend==ForwardBackend.TENANT) {
            try {
                if(!"READY".equals(json.readTree(membership.getProvisionStateJson()).path("status").asText())) throw new IllegalArgumentException("FORWARD_TENANT_NOT_READY");
            }
            catch(IllegalArgumentException error) {
                throw error;
            }
            catch(Exception error) {
                throw new IllegalArgumentException("FORWARD_TENANT_NOT_READY");
            }
        }
        return new TenantRequestContext(actor.userId(),actor.enterpriseId(),membership.getRole());
    }
    private static IllegalArgumentException denied() {
        return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
    }
}
