package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeSchemaService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
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
    private final TenantDbProvisioningService provisioning;
    private final TenantCommandStore store;
    private final JdbcTemplate jdbc;
    private final TenantSandboxService sandboxes;
    private final TenantAdminTenantMapper tenants;
    private final TenantNodeSchemaService schemas;
    private final ObjectMapper json;
    private final TransactionTemplate tx;

    public TenantCommandRecovery(TenantCommandStore store, JdbcTemplate jdbc, TenantSandboxService sandboxes,
        TenantAdminTenantMapper tenants, TenantNodeSchemaService schemas, TenantDbProvisioningService provisioning, ObjectMapper json, PlatformTransactionManager transactions) {
        this.store=store; this.jdbc=jdbc; this.sandboxes=sandboxes; this.tenants=tenants;
        this.provisioning=provisioning; this.schemas=schemas; this.json=json; this.tx=new TransactionTemplate(transactions);
    }

    public Map<String,Object> inspect(long id) { return inspectState(id).view(); }

    public Map<String,Object> receipt(long id, String requestId) {
        uuid(requestId);
        var command = required(id);
        var rows = jdbc.queryForList("SELECT command_id,receipt FROM byai.tenant_task_recovery WHERE source_system=? AND request_id=?",
            command.sourceSystem(),requestId);
        if (rows.size()!=1 || ((Number)rows.getFirst().get("command_id")).longValue()!=id) {
            throw new TenantCommandException(404,"RECOVERY_NOT_FOUND");
        }
        return decode(rows.getFirst().get("receipt").toString());
    }

    /** Resume only a provably safe schema step for the already authorized owning service. */
    public Map<String,Object> safeResume(long id, JsonNode body) {
        TenantCommandRequest.fields(body, Set.of("requestId", "expectedRevision"));
        var command = required(id);
        var request = json.createObjectNode();
        request.put("requestId", TenantCommandRequest.text(body, "requestId", 36));
        request.put("expectedRevision", TenantCommandRequest.text(body, "expectedRevision", 19));
        request.putObject("actor").put("type", "SYSTEM_SERVICE").put("id", command.sourceSystem());
        request.put("reason", "Progress check requested safe schema continuation");
        request.put("confirmNoInFlight", false);
        var outcome = recover(id, request, true);
        var result = new LinkedHashMap<String,Object>(required(id).view());
        result.put("decision", outcome.getOrDefault("decision", "WAIT"));
        result.put("reasonCode", outcome.getOrDefault("reasonCode", "SCHEMA_RESUME_ACCEPTED"));
        return result;
    }

    public Map<String,Object> recover(long id, JsonNode body) {
        return recover(id, body, false);
    }

    /** Share receipt/CAS handling without granting automatic calls administrator recovery powers. */
    private Map<String,Object> recover(long id, JsonNode body, boolean automatic) {
        TenantCommandRequest.fields(body,Set.of("requestId","expectedRevision","actor","reason","confirmNoInFlight"));
        String request = TenantCommandRequest.text(body,"requestId",36); uuid(request);
        String revision = TenantCommandRequest.text(body,"expectedRevision",19);
        if (!revision.matches("0|[1-9][0-9]{0,18}")) throw new TenantCommandException(400,"INVALID_REQUEST");
        long expected;
        try { expected=Long.parseLong(revision); } catch(NumberFormatException error) { throw new TenantCommandException(400,"INVALID_REQUEST"); }
        TenantCommandRequest.fields(body.get("actor"),Set.of("type","id"));
        String actorType = automatic ? "SYSTEM_SERVICE" : "PLATFORM_ADMIN";
        if (!actorType.equals(TenantCommandRequest.text(body.get("actor"),"type",32))) throw new TenantCommandException(403,"RECOVERY_ADMIN_REQUIRED");
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
            if (automatic && !"SCHEMA_INIT".equals(command.stage())) {
                return Map.of("decision", "WAIT", "reasonCode", "SAFE_RESUME_STAGE_UNSUPPORTED");
            }
            Inspection inspection=inspectState(id);
            if (automatic && (!"SCHEMA_INIT".equals(inspection.command().stage()) || !inspection.resumable())) {
                return inspection.view();
            }
            if (inspection.command().revision()!=expected) throw new TenantCommandException(409,"RECOVERY_REVISION_CONFLICT");
            if (!inspection.resumable()) throw new TenantCommandException(409,inspection.reason());
            if ("RETRY_AFTER_CONFIRMATION".equals(inspection.decision()) && !confirmed) {
                throw new TenantCommandException(409,"RECOVERY_CONFIRMATION_REQUIRED");
            }
            return tx.execute(status -> {
                if (jdbc.update("""
                    UPDATE byai.tenant_task SET status='PENDING',error_code=NULL,revision=revision+1,
                    fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,next_attempt_at=CURRENT_TIMESTAMP,
                    updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND status='MANUAL_REQUIRED'
                    AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)
                    """,id,expected)!=1) throw new TenantCommandException(409,"RECOVERY_REVISION_CONFLICT");
                if (jdbc.update("""
                    UPDATE byai.tenant_operation_state SET operation_revision=operation_revision+1
                    WHERE enterprise_id=? AND active_command_id=? AND operation_revision=?
                    """,Long.parseLong(command.enterpriseId()),id,inspection.slotRevision())!=1) {
                    throw new TenantCommandException(409,"RECOVERY_OPERATION_SLOT_CHANGED");
                }
                fenceResource(inspection.resource());
                fenceResource(inspection.nodeResource());
                if ("RESTARTED_RESOURCES_VERIFIED".equals(inspection.reason())) {
                    long tenant = Long.parseLong(command.enterpriseId());
                    var db = inspection.resource().adopted();
                    var node = inspection.nodeResource().adopted();
                    if (!restartBindingsMatch(tenant, id, db.recordId(), node.recordId())
                        || !schemas.verifiedRecoveryAudit(tenant, "internal-" + id, db.recordId())) {
                        throw new TenantCommandException(409,"RECOVERY_RESOURCE_CHANGED");
                    }
                    // Record the already verified Node result alongside the DB result in this same transaction.
                    if (jdbc.update("INSERT INTO byai.tenant_task_step(command_id,step_key,status,provider_request_key,result) "
                            + "VALUES (?,'NODE_CREATE','SUCCEEDED',?,?)", id, "command-" + id + ":NODE_CREATE", encode(node)) != 1) {
                        throw new TenantCommandException(409,"RECOVERY_STEP_CHANGED");
                    }
                }
                // A concurrent audit insertion must not turn a no-dispatch observation into a replay.
                if ("SCHEMA_NOT_DISPATCHED".equals(inspection.reason())
                    && !schemas.canRetryBeforeDispatch(Long.parseLong(command.enterpriseId()))) {
                    throw new TenantCommandException(409,"SCHEMA_AUDIT_RECONCILIATION_REQUIRED");
                }
                Step step=inspection.step();
                if (step!=null) {
                    String state=inspection.adopted()!=null ? "SUCCEEDED" : "RETRY_READY";
                    String result=inspection.adopted()!=null ? encode(inspection.adopted()) : null;
                    // A successful step stays immutable but still participates in the same revision fence.
                    if ("SUCCEEDED".equals(step.status()) && jdbc.update("UPDATE byai.tenant_task_step SET revision=revision "
                        + "WHERE command_id=? AND step_key=? AND revision=? AND status='SUCCEEDED' AND provider_request_key=?",
                        id,inspection.command().stage(),step.revision(),step.providerKey())!=1) {
                        throw new TenantCommandException(409,"RECOVERY_STEP_CHANGED");
                    }
                    if (!"SUCCEEDED".equals(step.status()) && jdbc.update("""
                        UPDATE byai.tenant_task_step SET status=?,result=?,revision=revision+1
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
                    INSERT INTO byai.tenant_task_recovery(source_system,request_id,command_id,enterprise_id,request_hash,
                    expected_revision,actor_type,actor_id,reason,confirm_no_in_flight,decision,step_key,receipt)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,command.sourceSystem(),request,id,Long.parseLong(command.enterpriseId()),hash,expected,actorType,actor,reason,
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
        var slots=jdbc.query("SELECT operation_revision FROM byai.tenant_operation_state WHERE enterprise_id=? AND active_command_id=?",
            (rs,n)->rs.getLong(1),Long.parseLong(command.enterpriseId()),id);
        if (slots.size()!=1) return decision(command,"MANUAL_REQUIRED","RECOVERY_OPERATION_SLOT_CHANGED",null,-1,null,null);
        long slot=slots.getFirst();
        var rows=jdbc.query("SELECT status,provider_request_key,revision FROM byai.tenant_task_step WHERE command_id=? AND step_key=?",
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
            if ("RESOURCE_IDENTITY_MISMATCH".equals(resource.reasonCode()) && "DB_CREATE".equals(command.stage())
                    && "STARTED".equals(step.status()) && "PROVIDER_RESULT_UNKNOWN".equals(command.errorCode())) {
                return inspectRestart(command, step, slot, tenant);
            }
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
                String nodeRecord = tenants.selectConfig(tenant, "NODE_SANDBOX_RECORD_ID");
                if (step != null && "STARTED".equals(step.status()) && originalRequest != null
                    && ("internal-" + id).equals(originalRequest) && databaseRecord != null && nodeRecord != null
                    && schemas.canRetryBeforeDispatch(tenant)) {
                    var database = sandboxes.inspectRecovery(tenant, "DB_CREATE", "command-" + id + ":DB_CREATE");
                    var node = sandboxes.inspectRecovery(tenant, "NODE_CREATE", "command-" + id + ":NODE_CREATE");
                    if (matchesRecord(database, databaseRecord) && matchesRecord(node, nodeRecord)) {
                        return new Inspection(command, "RETRY_SAFE", "SCHEMA_NOT_DISPATCHED", step, slot,
                            database, null, node);
                    }
                    return decision(command,"MANUAL_REQUIRED","SCHEMA_RESOURCE_IDENTITY_UNVERIFIED",step,slot,null,null);
                }
            } catch (RuntimeException unavailable) {
                org.slf4j.LoggerFactory.getLogger(TenantCommandRecovery.class)
                    .error("Cannot inspect schema recovery for command {}", id, unavailable);
            }
            return decision(command,"MANUAL_REQUIRED","SCHEMA_AUDIT_RECONCILIATION_REQUIRED",step,slot,null,null);
        }
        return decision(command,"MANUAL_REQUIRED","RECOVERY_STEP_UNSUPPORTED",step,slot,null,null);
    }

    /** Reconcile an out-of-band restart only when both bound records belong to the original verified initialization. */
    private Inspection inspectRestart(TenantCommandStore.Command command, Step step, long slot, long tenant) {
        var denied = decision(command,"MANUAL_REQUIRED","RESOURCE_IDENTITY_MISMATCH",step,slot,null,null);
        long id = Long.parseLong(command.commandId());
        String dbId = tenants.selectConfig(tenant, "DB_SANDBOX_RECORD_ID");
        String nodeId = tenants.selectConfig(tenant, "NODE_SANDBOX_RECORD_ID");
        if (dbId == null || nodeId == null || dbId.equals(nodeId)
            || !"hacu".equals(command.sourceSystem()) || !("internal-" + id).equals(tenants.selectConfig(tenant,"PROVISION_REQUEST_ID"))) return denied;
        var db = sandboxes.inspectRestartRecord(tenant,"DB_CREATE",dbId);
        var node = sandboxes.inspectRestartRecord(tenant,"NODE_CREATE",nodeId);
        // Preserve the provider's blocking reason so operators can distinguish identity, endpoint and runtime failures.
        if (db != null && !"MATCHED".equals(db.reasonCode())) {
            return decision(command,"MANUAL_REQUIRED",db.reasonCode(),step,slot,null,null);
        }
        if (node != null && !"MATCHED".equals(node.reasonCode())) {
            return decision(command,"MANUAL_REQUIRED",node.reasonCode(),step,slot,null,null);
        }
        if (!matchesRecord(db,dbId) || !matchesRecord(node,nodeId)
            || !restartBindingsMatch(tenant,id,db.adopted().recordId(),node.adopted().recordId())
            || !schemas.verifiedRecoveryAudit(tenant,"internal-" + id,db.adopted().recordId())
            || jdbc.queryForObject("SELECT count(*) FROM byai.tenant_task_step WHERE command_id=? AND step_key<>'DB_CREATE'",
                Integer.class,id) != 0) return denied;
        try {
            provisioning.verifyRestartedPair(tenant, db.adopted(), node.adopted());
        } catch (Exception unavailable) {
            if (unavailable instanceof InterruptedException) Thread.currentThread().interrupt();
            org.slf4j.LoggerFactory.getLogger(TenantCommandRecovery.class).warn("Restarted resources not ready for command {} ({})", id,
                unavailable.getClass().getSimpleName());
            return decision(command,"MANUAL_REQUIRED","RESTARTED_RESOURCES_NOT_READY",step,slot,null,null);
        }
        return new Inspection(command,"ADOPT_EXISTING","RESTARTED_RESOURCES_VERIFIED",step,slot,db,db.adopted(),node);
    }

    private boolean restartBindingsMatch(long tenant,long id,long database,long node) {
        String storedState = tenants.selectConfig(tenant,"PROVISION_STATE");
        if (storedState == null || storedState.isBlank()) return false;
        var state = decode(storedState);
        return "READY".equals(state.get("status")) && "1".equals(String.valueOf(state.get("generation")))
            && "true".equals(tenants.selectConfig(tenant,"COMMERCIAL_MANAGED"))
            && ("internal-" + id).equals(tenants.selectConfig(tenant,"PROVISION_REQUEST_ID"))
            && Long.toString(database).equals(tenants.selectConfig(tenant,"DB_SANDBOX_RECORD_ID"))
            && Long.toString(node).equals(tenants.selectConfig(tenant,"NODE_SANDBOX_RECORD_ID"));
    }

    /** Require the provider observation to match the original persisted resource binding. */
    private boolean matchesRecord(TenantSandboxService.RecoveryResource resource, String recordId) {
        return resource != null && "MATCHED".equals(resource.reasonCode()) && resource.adopted() != null
            && resource.observedRecord() != null && "RUNNING".equals(resource.observedRecord().getStatus())
            && Long.toString(resource.adopted().recordId()).equals(recordId)
            && resource.observedRecord().getId().toString().equals(recordId);
    }

    /** Keep each inspected resource unchanged while accepting the original command. */
    private void fenceResource(TenantSandboxService.RecoveryResource resource) {
        if (resource == null || resource.adopted() == null) {
            return;
        }
        var record = resource.observedRecord();
        if (record == null || jdbc.update("UPDATE byai.ss_sandbox_record SET lock_version=lock_version "
            + "WHERE id=? AND enterprise_id=? AND owner_scope='TENANT' AND sandbox_id=? "
            + "AND status='RUNNING' AND lock_version=? AND endpoint=?", record.getId(), record.getEnterpriseId(),
            record.getSandboxId(), record.getLockVersion(), record.getEndpoint()) != 1) {
            throw new TenantCommandException(409,"RECOVERY_RESOURCE_CHANGED");
        }
    }

    private Inspection decision(TenantCommandStore.Command command,String decision,String reason,Step step,long slot,
        TenantSandboxService.RecoveryResource resource,Object adopted) { return new Inspection(command,decision,reason,step,slot,resource,adopted,null); }
    private TenantCommandStore.Command required(long id) {
        var command=store.find(id);if(command==null) throw new TenantCommandException(404,"COMMAND_NOT_FOUND");return command;
    }
    private Map<String,Object> existing(String source,String request,String hash) {
        var rows=jdbc.queryForList("SELECT request_hash,receipt FROM byai.tenant_task_recovery WHERE source_system=? AND request_id=?",source,request);
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
        TenantSandboxService.RecoveryResource resource,Object adopted,TenantSandboxService.RecoveryResource nodeResource) {
        boolean resumable() {return Set.of("RETRY_SAFE","RETRY_AFTER_CONFIRMATION","ADOPT_EXISTING").contains(decision);}
        Map<String,Object> view() {
            var value=new LinkedHashMap<>(command.view());value.put("decision",decision);value.put("reasonCode",reason);
            value.put("capabilities",resumable()?java.util.List.of("RESUME"):java.util.List.of());value.put("checkedAt",Instant.now().toString());return value;
        }
    }
}
