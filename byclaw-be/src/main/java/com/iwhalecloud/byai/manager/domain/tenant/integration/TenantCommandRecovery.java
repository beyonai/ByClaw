package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeSchemaService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Inspections never create resources; acceptance fences and resumes the original durable intent. */
@Component
@ConditionalOnProperty(name="byclaw.integration.enabled",havingValue="true")
public class TenantCommandRecovery {
    private final TenantCommandStore store;
    private final JdbcTemplate jdbc;
    private final TenantSandboxService sandboxes;
    private final TenantAdminTenantMapper tenants;
    private final TenantNodeSchemaService schemas;
    private final ObjectMapper json;
    private final TransactionTemplate tx;

    public TenantCommandRecovery(TenantCommandStore store, JdbcTemplate jdbc, TenantSandboxService sandboxes,
        TenantAdminTenantMapper tenants, TenantNodeSchemaService schemas, ObjectMapper json, PlatformTransactionManager transactions) {
        this.store=store; this.jdbc=jdbc; this.sandboxes=sandboxes; this.tenants=tenants;
        this.schemas=schemas; this.json=json; this.tx=new TransactionTemplate(transactions);
    }

    public Map<String,Object> inspect(long id) { return inspectState(id).view(); }

    public Map<String,Object> receipt(long id, String requestId) {
        uuid(requestId);
        var command = required(id);
        var rows = jdbc.queryForList("SELECT command_id,receipt FROM byai.internal_command_recovery WHERE source_system=? AND request_id=?",
            command.sourceSystem(),requestId);
        if (rows.size()!=1 || ((Number)rows.getFirst().get("command_id")).longValue()!=id) {
            throw new TenantCommandException(404,"RECOVERY_NOT_FOUND");
        }
        return decode(rows.getFirst().get("receipt").toString());
    }

    public Map<String,Object> recover(long id, JsonNode body) {
        TenantCommandRequest.fields(body,Set.of("requestId","expectedRevision","actor","reason","confirmNoInFlight"));
        String request = TenantCommandRequest.text(body,"requestId",36); uuid(request);
        String revision = TenantCommandRequest.text(body,"expectedRevision",19);
        if (!revision.matches("0|[1-9][0-9]{0,18}")) throw new TenantCommandException(400,"INVALID_REQUEST");
        long expected;
        try { expected=Long.parseLong(revision); } catch(NumberFormatException error) { throw new TenantCommandException(400,"INVALID_REQUEST"); }
        TenantCommandRequest.fields(body.get("actor"),Set.of("type","id"));
        if (!"PLATFORM_ADMIN".equals(TenantCommandRequest.text(body.get("actor"),"type",32))) throw new TenantCommandException(403,"RECOVERY_ADMIN_REQUIRED");
        String actor = TenantCommandRequest.text(body.get("actor"),"id",128);
        String reason = TenantCommandRequest.text(body,"reason",500);
        if (!body.path("confirmNoInFlight").isBoolean()) throw new TenantCommandException(400,"INVALID_REQUEST");
        boolean confirmed = body.path("confirmNoInFlight").asBoolean();
        String hash = TenantCommandRequest.digest(id+":"+TenantCommandRequest.canonical(body));
        var command=required(id);
        Map<String,Object> previous=existing(command.sourceSystem(),request,hash);
        if (previous!=null) return previous;
        // Provider inspection happens before the transaction. The revision predicates reject all intervening local work.
        try {
            Inspection inspection=inspectState(id);
            if (inspection.command().revision()!=expected) throw new TenantCommandException(409,"RECOVERY_REVISION_CONFLICT");
            if (!inspection.resumable()) throw new TenantCommandException(409,inspection.reason());
            if ("RETRY_AFTER_CONFIRMATION".equals(inspection.decision()) && !confirmed) {
                throw new TenantCommandException(409,"RECOVERY_CONFIRMATION_REQUIRED");
            }
            return tx.execute(status -> {
                if (jdbc.update("""
                    UPDATE byai.internal_command SET status='PENDING',error_code=NULL,revision=revision+1,
                    fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,next_attempt_at=CURRENT_TIMESTAMP,
                    updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND status='MANUAL_REQUIRED'
                    """,id,expected)!=1) throw new TenantCommandException(409,"RECOVERY_REVISION_CONFLICT");
                if (jdbc.update("""
                    UPDATE byai.tenant_runtime_operation SET fencing_token=fencing_token+1,revision=revision+1
                    WHERE enterprise_id=? AND active_command_id=? AND state='ACTIVE' AND revision=?
                    """,Long.parseLong(command.enterpriseId()),id,inspection.slotRevision())!=1) {
                    throw new TenantCommandException(409,"RECOVERY_OPERATION_SLOT_CHANGED");
                }
                if (inspection.resource()!=null && inspection.resource().adopted()!=null) {
                    var record=inspection.resource().observedRecord();
                    if (record==null || jdbc.update("UPDATE byai.ss_sandbox_record SET lock_version=lock_version "
                        + "WHERE id=? AND enterprise_id=? AND owner_scope='TENANT' AND sandbox_id=? "
                        + "AND status='RUNNING' AND lock_version=? AND endpoint=?",record.getId(),record.getEnterpriseId(),
                        record.getSandboxId(),record.getLockVersion(),record.getEndpoint())!=1) {
                        throw new TenantCommandException(409,"RECOVERY_RESOURCE_CHANGED");
                    }
                }
                Step step=inspection.step();
                if (step!=null) {
                    String state=inspection.adopted()!=null ? "SUCCEEDED" : "RETRY_READY";
                    String result=inspection.adopted()!=null ? encode(inspection.adopted()) : null;
                    // A successful step stays immutable but still participates in the same revision fence.
                    if ("SUCCEEDED".equals(step.status()) && jdbc.update("UPDATE byai.internal_command_step SET revision=revision "
                        + "WHERE command_id=? AND step_key=? AND revision=? AND status='SUCCEEDED' AND provider_request_key=?",
                        id,inspection.command().stage(),step.revision(),step.providerKey())!=1) {
                        throw new TenantCommandException(409,"RECOVERY_STEP_CHANGED");
                    }
                    if (!"SUCCEEDED".equals(step.status()) && jdbc.update("""
                        UPDATE byai.internal_command_step SET status=?,result=?,error_code=NULL,revision=revision+1
                        WHERE command_id=? AND step_key=? AND revision=? AND status=? AND provider_request_key=?
                        """,state,result,id,inspection.command().stage(),step.revision(),step.status(),step.providerKey())!=1) {
                        throw new TenantCommandException(409,"RECOVERY_STEP_CHANGED");
                    }
                }
                if (inspection.resource()!=null && "ABSENT".equals(inspection.resource().reasonCode())) {
                    sandboxes.retireUnboundRecoveryRecord(inspection.resource());
                }
                Map<String,Object> result=new LinkedHashMap<>();
                result.put("requestId",request);result.put("commandId",Long.toString(id));result.put("enterpriseId",command.enterpriseId());
                result.put("status","ACCEPTED");result.put("commandRevision",Long.toString(expected+1));result.put("decision",inspection.decision());
                jdbc.update("""
                    INSERT INTO byai.internal_command_recovery(source_system,request_id,command_id,enterprise_id,request_hash,
                    expected_revision,actor_type,actor_id,reason,confirm_no_in_flight,decision,step_key,receipt)
                    VALUES (?,?,?,?,?,?,'PLATFORM_ADMIN',?,?,?,?,?,?)
                    """,command.sourceSystem(),request,id,Long.parseLong(command.enterpriseId()),hash,expected,actor,reason,
                    confirmed,inspection.decision(),inspection.command().stage(),encode(result));
                return result;
            });
        } catch (DuplicateKeyException conflict) {
            Map<String,Object> found=existing(command.sourceSystem(),request,hash);
            if (found!=null) return found;
            throw conflict;
        } catch (TenantCommandException conflict) {
            // A simultaneous retry may have committed the same receipt while this transaction waited on its CAS.
            Map<String,Object> found=existing(command.sourceSystem(),request,hash);
            if (found!=null) return found;
            throw conflict;
        }
    }

    private Inspection inspectState(long id) {
        var command=required(id);
        if (!"PROVISION".equals(command.type())) return decision(command,"MANUAL_REQUIRED","COMMAND_TYPE_UNSUPPORTED",null,-1,null,null);
        if ("SUCCEEDED".equals(command.status())) return decision(command,"NOT_REQUIRED","COMMAND_ALREADY_SUCCEEDED",null,-1,null,null);
        if (!"MANUAL_REQUIRED".equals(command.status())) return decision(command,"WAIT","COMMAND_NOT_PAUSED",null,-1,null,null);
        var slots=jdbc.query("SELECT revision FROM byai.tenant_runtime_operation WHERE enterprise_id=? AND active_command_id=? AND state='ACTIVE'",
            (rs,n)->rs.getLong(1),Long.parseLong(command.enterpriseId()),id);
        if (slots.size()!=1) return decision(command,"MANUAL_REQUIRED","RECOVERY_OPERATION_SLOT_CHANGED",null,-1,null,null);
        long slot=slots.getFirst();
        var rows=jdbc.query("SELECT status,provider_request_key,revision FROM byai.internal_command_step WHERE command_id=? AND step_key=?",
            (rs,n)->new Step(rs.getString(1),rs.getString(2),rs.getLong(3)),id,command.stage());
        Step step=rows.isEmpty()?null:rows.getFirst();
        if (step!=null && !("command-"+id+":"+command.stage()).equals(step.providerKey())) {
            return decision(command,"MANUAL_REQUIRED","RECOVERY_STEP_IDENTITY_MISMATCH",step,slot,null,null);
        }
        if (Set.of("DB_CREATE","NODE_CREATE").contains(command.stage())) {
            if (step==null) return decision(command,"MANUAL_REQUIRED","RECOVERY_STEP_MISSING",null,slot,null,null);
            long tenant=Long.parseLong(command.enterpriseId());
            // Never invent credentials for adoption: the worker must decrypt the original persisted envelope.
            String credential=tenants.selectConfig(tenant,"DB_PASSWORD");
            if (credential==null || credential.isBlank()) return decision(command,"MANUAL_REQUIRED","RESOURCE_CREDENTIALS_UNAVAILABLE",step,slot,null,null);
            var resource=sandboxes.inspectRecovery(tenant,command.stage(),step.providerKey());
            if ("MATCHED".equals(resource.reasonCode())) return decision(command,"ADOPT_EXISTING","RESOURCE_IDENTITY_VERIFIED",step,slot,resource,resource.adopted());
            if (!"ABSENT".equals(resource.reasonCode())) return decision(command,"MANUAL_REQUIRED",resource.reasonCode(),step,slot,resource,null);
            if ("SUCCEEDED".equals(step.status())) return decision(command,"MANUAL_REQUIRED","ACKNOWLEDGED_RESOURCE_MISSING",step,slot,resource,null);
            boolean safe="PROVIDER_NOT_CALLED_FILE_PREPARATION".equals(command.errorCode()) && "DB_CREATE".equals(command.stage());
            return decision(command,safe?"RETRY_SAFE":"RETRY_AFTER_CONFIRMATION",safe?"PROVIDER_NOT_CALLED":"PROVIDER_ABSENT_CONFIRM_IN_FLIGHT",step,slot,resource,null);
        }
        if (Set.of("DB_PROBE","CONFIG_PUBLISH","READY_PUBLISH","RESERVED").contains(command.stage())) {
            return decision(command,"RETRY_SAFE","REPLAYABLE_LOCAL_OR_READ_ONLY_STEP",step,slot,null,null);
        }
        if ("SCHEMA_INIT".equals(command.stage())) {
            try {
                long tenant=Long.parseLong(command.enterpriseId());
                String originalRequest=tenants.selectConfig(tenant,"PROVISION_REQUEST_ID");
                String databaseRecord=tenants.selectConfig(tenant,"DB_SANDBOX_RECORD_ID");
                if (step!=null && originalRequest!=null && databaseRecord!=null
                    && schemas.verifiedRecoveryAudit(tenant,originalRequest,Long.parseLong(databaseRecord))) {
                    return decision(command,"ADOPT_EXISTING","SCHEMA_VERIFIED_AUDIT",step,slot,null,Boolean.TRUE);
                }
            } catch (RuntimeException unavailable) { /* An unreadable audit cannot authorize a new schema attempt. */ }
            return decision(command,"MANUAL_REQUIRED","SCHEMA_AUDIT_RECONCILIATION_REQUIRED",step,slot,null,null);
        }
        return decision(command,"MANUAL_REQUIRED","RECOVERY_STEP_UNSUPPORTED",step,slot,null,null);
    }

    private Inspection decision(TenantCommandStore.Command command,String decision,String reason,Step step,long slot,
        TenantSandboxService.RecoveryResource resource,Object adopted) { return new Inspection(command,decision,reason,step,slot,resource,adopted); }
    private TenantCommandStore.Command required(long id) {
        var command=store.find(id);if(command==null) throw new TenantCommandException(404,"COMMAND_NOT_FOUND");return command;
    }
    private Map<String,Object> existing(String source,String request,String hash) {
        var rows=jdbc.queryForList("SELECT request_hash,receipt FROM byai.internal_command_recovery WHERE source_system=? AND request_id=?",source,request);
        if(rows.isEmpty()) return null;
        if(!hash.equals(rows.getFirst().get("request_hash"))) throw new TenantCommandException(409,"RECOVERY_REQUEST_CONFLICT");
        return decode(rows.getFirst().get("receipt").toString());
    }
    private static void uuid(String value) {
        try { if(!UUID.fromString(value).toString().equals(value)) throw new IllegalArgumentException(); }
        catch(RuntimeException invalid) { throw new TenantCommandException(400,"INVALID_REQUEST"); }
    }
    private String encode(Object value) { try{return json.writeValueAsString(value);}catch(Exception error){throw new IllegalStateException("Recovery receipt serialization failed",error);} }
    private Map<String,Object> decode(String value) { try{return json.readValue(value,new com.fasterxml.jackson.core.type.TypeReference<Map<String,Object>>(){});}catch(Exception error){throw new IllegalStateException("Invalid recovery receipt",error);} }
    private record Step(String status,String providerKey,long revision) { }
    private record Inspection(TenantCommandStore.Command command,String decision,String reason,Step step,long slotRevision,
        TenantSandboxService.RecoveryResource resource,Object adopted) {
        boolean resumable() {return Set.of("RETRY_SAFE","RETRY_AFTER_CONFIRMATION","ADOPT_EXISTING").contains(decision);}
        Map<String,Object> view() {
            var value=new LinkedHashMap<>(command.view());value.put("decision",decision);value.put("reasonCode",reason);
            value.put("capabilities",resumable()?java.util.List.of("RESUME"):java.util.List.of());value.put("checkedAt",Instant.now().toString());return value;
        }
    }
}
