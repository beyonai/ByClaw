package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantSandboxProperties;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Service commands reserve business facts and their deduplication receipt in one local transaction. */
@Service
public class TenantCommandService {
    private final TenantCommandStore store;
    private final JdbcTemplate jdbc;
    private final TenantAdminTenantMapper tenants;
    private final SequenceService ids;
    private final ObjectMapper json;
    private final TenantExecutionPolicyService policies;
    private final TenantSandboxProperties sandboxProperties;
    private final TransactionTemplate tx;
    @Autowired
    public TenantCommandService(TenantCommandStore store,JdbcTemplate jdbc,TenantAdminTenantMapper tenants,
        SequenceService ids,ObjectMapper json,TenantExecutionPolicyService policies,
        PlatformTransactionManager transactions,TenantSandboxProperties sandboxProperties) {
        this.store=store; this.jdbc=jdbc; this.tenants=tenants; this.ids=ids; this.json=json;
        this.policies=policies; this.tx=new TransactionTemplate(transactions); this.sandboxProperties=sandboxProperties;
    }
    public TenantCommandStore.Command provision(TenantCommandRequest request) {
        var existing=store.byRequest(request.sourceSystem(),request.requestId());
        if (existing!=null) return match(existing,request.hash());
        return accept(request.sourceSystem(),request.requestId(),request.hash(), () -> {
            Long valid=jdbc.queryForObject("""
                SELECT count(*) FROM byai.po_users WHERE user_id=? AND state='A'
                AND UPPER(COALESCE(is_locked,'N'))<>'Y'
                AND (user_eff_date IS NULL OR user_eff_date<=CURRENT_TIMESTAMP)
                AND (user_exp_date IS NULL OR user_exp_date>CURRENT_TIMESTAMP)
                """,Long.class,request.ownerUserId());
            if (valid==null || valid!=1) throw new TenantCommandException(400,"OWNER_USER_INVALID");
            long id=ids.nextVal(), enterprise=ids.nextVal();
            store.insert(id,request.sourceSystem(),request.requestId(),request.hash(),"PROVISION",enterprise,
                request.ownerUserId(),request.snapshot());
            tenants.insertEnterprise(enterprise,request.enterpriseName());
            // This namespaced local request ID cannot collide with the legacy administrator request key.
            config(enterprise,"PROVISION_REQUEST_ID","internal-"+id);
            config(enterprise,"PACKAGE_NAME_SNAPSHOT","external");
            JsonNode body=read(request.snapshot());
            // Resolve defaults only for a new reservation; explicit trusted profiles and frozen retries take precedence.
            String profile=request.profileKey()==null?sandboxProperties.getProfileKey():request.profileKey();
            var snapshot=json.createObjectNode().put("profileKey",profile)
                .put("nodeProfileKey", request.profileKey()==null?sandboxProperties.getNodeProfileKey():request.profileKey());
            config(enterprise,"PACKAGE_CONTENT_SNAPSHOT",snapshot.toString());
            config(enterprise,"COMMERCIAL_MANAGED","true");
            config(enterprise,"INTEGRATION_SOURCE_SYSTEM",request.sourceSystem());
            config(enterprise,"PROVISION_STATE","{\"status\":\"RESERVED\",\"generation\":\"1\",\"fencingToken\":\"1\"}");
            policies.prepare(enterprise,body.get("initialPolicy"));
            // Initial rights stay in the audited request; runtime admission reads HACU's shared Redis snapshot.
            tenants.insertOwner(ids.nextVal(),enterprise,request.ownerUserId());
            if (jdbc.update("UPDATE byai.tenant_operation_state SET active_command_id=? WHERE enterprise_id=? AND active_command_id IS NULL",id,enterprise) != 1) {
                throw new TenantCommandException(409,"TENANT_OPERATION_MISSING");
            }
            return store.find(id);
        });
    }
    public TenantCommandStore.Command policy(String source,long enterprise,JsonNode body) {
        TenantCommandRequest.fields(body,Set.of("requestId","expectedRevision","policy"));
        long expected=TenantCommandRequest.decimal(body.get("expectedRevision"));
        return mutation(source,enterprise,"POLICY",body,() -> {
            policies.update(enterprise,expected,body.get("policy"));
            // Confirm the already published shared snapshot without creating a local commercial rule copy.
            return null;
        });
    }
    public TenantCommandStore.Command mutation(String source,long enterprise,String type,JsonNode body,Supplier<String> action) {
        String request=TenantCommandRequest.text(body,"requestId",128);
        if (!request.matches("[a-zA-Z0-9_.:-]{8,128}")) throw new TenantCommandException(400,"INVALID_REQUEST");
        String snapshot=TenantCommandRequest.canonical(body);
        String hash=TenantCommandRequest.digest(type+"\n"+enterprise+"\n"+snapshot);
        var existing=store.byRequest(source,request);
        if (existing!=null) return match(existing,hash);
        return accept(source,request,hash,() -> {
            requireSourceTenant(source,enterprise);
            // Serialize member/policy writes with administrative deletion before reading lifecycle state.
            if (jdbc.update("UPDATE byai.tenant_operation_state SET operation_revision=operation_revision+1 WHERE enterprise_id=?", enterprise) != 1)
                throw new TenantCommandException(409,"TENANT_OPERATION_MISSING");
            var state=read(tenants.selectConfig(enterprise,"PROVISION_STATE"));
            if (Set.of("DELETING","DELETE_FAILED","DELETED").contains(state.path("status").asText()))
                throw new TenantCommandException(409,"TENANT_DELETION_IN_PROGRESS");
            long id=ids.nextVal();
            store.insert(id,source,request,hash,type,enterprise,0,snapshot);
            String error=action.get();
            jdbc.update("UPDATE byai.tenant_task SET status=?,stage=?,error_code=? WHERE id=?",
                error==null?"SUCCEEDED":"MANUAL_REQUIRED",type,error,id);
            return store.find(id);
        });
    }
    public void requireSourceTenant(String source,long enterprise) {
        String actual=tenants.selectConfig(enterprise,"INTEGRATION_SOURCE_SYSTEM");
        if (actual==null) throw new TenantCommandException(404,"TENANT_NOT_FOUND");
        if (!actual.equals(source)) throw new TenantCommandException(403,"TENANT_SOURCE_DENIED");
    }
    private TenantCommandStore.Command accept(String source,String request,String hash,Supplier<TenantCommandStore.Command> action) {
        try { return tx.execute(status -> action.get()); }
        catch (DuplicateKeyException conflict) {
            // Unique-constraint failure has rolled back fully before reading the winning committed command.
            var committed=store.byRequest(source,request);
            if (committed==null) throw conflict;
            return match(committed,hash);
        }
    }
    public static TenantCommandStore.Command match(TenantCommandStore.Command existing,String hash) {
        if (!existing.requestHash().equals(hash)) throw new TenantCommandException(409,"REQUEST_ID_CONFLICT");
        return existing;
    }
    private JsonNode read(String snapshot) {
        try { return json.readTree(snapshot); }
        catch (Exception invalid) { throw new TenantCommandException(400,"INVALID_REQUEST"); }
    }
    private void config(long enterprise,String code,String value) { tenants.insertConfig(ids.nextVal(),enterprise,code,value); }
}
