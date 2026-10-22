package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import java.util.List;
/** Platform rows enumerate transport identities only; tenant business progress stays inside each Node database. */
@Component
public class ForwardRecoveryDirectory {
    private final JdbcTemplate db;
    public ForwardRecoveryDirectory(JdbcTemplate db){this.db=db;}
    public List<Long> readyTenants(long after,int limit){
        return db.queryForList("SELECT c.enterprise_id FROM byai.tenant_config c WHERE c.params_code='PROVISION_STATE' AND c.params_value::jsonb->>'status'='READY' AND c.enterprise_id>? AND NOT EXISTS (SELECT 1 FROM byai.tenant_config d WHERE d.enterprise_id=c.enterprise_id AND d.params_code='TENANT_DELETE_REQUESTED' AND d.params_value='true') ORDER BY c.enterprise_id LIMIT ?",Long.class,after,limit);
    }
    public List<Long> legacyEnterprises(long after,int limit){return db.queryForList("SELECT DISTINCT enterprise_id FROM byai.byai_group_chat_forward_request WHERE backend='LEGACY' AND enterprise_id>? ORDER BY enterprise_id LIMIT ?",Long.class,after,limit);}
}
