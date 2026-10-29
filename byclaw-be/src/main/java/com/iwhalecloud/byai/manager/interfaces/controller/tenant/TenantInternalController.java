package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.integration.*;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Fixed service-only routes; no browser principal or arbitrary provider proxy crosses this boundary. */
@RestController
@RequestMapping("/internal/v1")
@ConditionalOnProperty(name="byclaw.integration.enabled",havingValue="true")
public class TenantInternalController {
    @org.springframework.beans.factory.annotation.Autowired
    private TenantCommandRecovery recoveries;

    private final TenantCommandService commands;
    private final TenantCommandStore store;
    private final TenantExecutionPolicyService policies;
    private final TenantInternalEnterpriseService enterprises;
    private final TenantAdminTenantMapper tenants;
    private final TenantSandboxService sandboxes;
    private final ObjectMapper json;
    public TenantInternalController(TenantCommandService commands,TenantCommandStore store,TenantExecutionPolicyService policies,
        TenantInternalEnterpriseService enterprises,TenantAdminTenantMapper tenants,TenantSandboxService sandboxes,ObjectMapper json) {
        this.commands=commands;this.store=store;this.policies=policies;this.enterprises=enterprises;
        this.tenants=tenants;this.sandboxes=sandboxes;this.json=json;
    }
    @PostMapping("/tenant-provisionings")
    public ResponseEntity<?> provision(HttpServletRequest http,@RequestBody JsonNode body) {
        var principal=InternalServicePrincipal.require(http);principal.requireScope("tenant:provision");
        var request=TenantCommandRequest.parse(body);principal.requireSource(request.sourceSystem());
        if(!principal.allTenants()) throw new TenantCommandException(403,"TENANT_PROVISION_SCOPE_REQUIRED");
        return accepted(commands.provision(request));
    }
    @GetMapping("/commands/by-request")
    public ResponseUtil<?> byRequest(HttpServletRequest http,@RequestParam String sourceSystem,@RequestParam String requestId) {
        var principal=InternalServicePrincipal.require(http);principal.requireScope("tenant:read");principal.requireSource(sourceSystem);
        return ResponseUtil.success(visible(principal,store.byRequest(sourceSystem,requestId)).view());
    }
    @GetMapping("/commands/{id}")
    public ResponseUtil<?> command(HttpServletRequest http,@PathVariable String id) {
        var principal=InternalServicePrincipal.require(http);principal.requireScope("tenant:read");
        return ResponseUtil.success(visible(principal,store.find(identifier(id))).view());
    }
    @GetMapping("/commands/{id}/recovery")
    public ResponseUtil<?> recovery(HttpServletRequest http,@PathVariable String id) {
        var principal=InternalServicePrincipal.require(http);principal.requireScope("tenant:read");
        visible(principal,store.find(identifier(id)));
        return ResponseUtil.success(recoveries.inspect(identifier(id)));
    }
    @PostMapping("/commands/{id}/recoveries")
    public ResponseEntity<?> recover(HttpServletRequest http,@PathVariable String id,@RequestBody JsonNode body) {
        var principal=InternalServicePrincipal.require(http);principal.requireScope("tenant:provision");
        visible(principal,store.find(identifier(id)));
        return ResponseEntity.accepted().body(ResponseUtil.success(recoveries.recover(identifier(id),body)));
    }
    @GetMapping("/commands/{id}/recovery-requests/{requestId}")
    public ResponseUtil<?> recoveryReceipt(HttpServletRequest http,@PathVariable String id,@PathVariable String requestId) {
        var principal=InternalServicePrincipal.require(http);principal.requireScope("tenant:read");
        visible(principal,store.find(identifier(id)));
        return ResponseUtil.success(recoveries.receipt(identifier(id),requestId));
    }
    @GetMapping("/tenants/{id}/runtime")
    public ResponseUtil<?> runtime(HttpServletRequest http,@PathVariable String id) {
        long tenant=authorize(http,id,"tenant:read");
        String state=tenants.selectConfig(tenant,"PROVISION_STATE");
        String stage="UNKNOWN";
        try { stage=json.readTree(state).path("status").asText("UNKNOWN"); } catch(Exception ignored) { }
        var result=new java.util.LinkedHashMap<String,Object>();
        result.put("enterpriseId",id);result.put("stage",stage);result.put("status",stage);result.put("generation","1");
        if ("true".equals(tenants.selectConfig(tenant,"COMMERCIAL_MANAGED"))) {
            boolean deleting=Set.of("DELETING","DELETE_FAILED","DELETED").contains(stage);
            var command=deleting ? store.latestDeletion(tenant) : store.latestProvision(tenant);
            if(command!=null) {
                if (!deleting) { result.put("stage",command.stage());result.put("status",command.status()); }
                result.put("commandStatus",command.status());
                result.put("errorCode",command.errorCode());result.put("commandId",command.commandId());
                result.put("commandRevision",Long.toString(command.revision()));
            }
        }
        result.put("observedAt",Instant.now().toString());result.put("policy",policies.projection(tenant));
        result.put("resources",java.util.List.of(resource(tenant,"tenant-opengauss"),resource(tenant,"tenant-data-node")));
        result.put("capabilities",Map.of("RECREATE_NODE",false,"REPLACE_DATABASE",false,"CHANGE_PROFILE",false,"DELETE",false));
        return ResponseUtil.success(result);
    }

    private Map<String,Object> resource(long tenant,String type) {
        var row=sandboxes.latestRecord(tenant,type);
        var result=new java.util.LinkedHashMap<String,Object>();
        result.put("type",type);result.put("observedAt",Instant.now().toString());
        result.put("recordId",row==null?null:row.getId().toString());
        result.put("recordRevision",row==null?null:String.valueOf(row.getLockVersion()));
        result.put("recordStatus",row==null?"ABSENT":row.getStatus());
        result.put("actualStatus",row==null?"UNKNOWN":sandboxes.providerStatus(row));
        return result;
    }
    @PutMapping("/tenants/{id}/execution-policy")
    public ResponseEntity<?> policy(HttpServletRequest http,@PathVariable String id,@RequestBody JsonNode body) {
        long tenant=authorize(http,id,"tenant:policy:write");
        return accepted(commands.policy(InternalServicePrincipal.require(http).sourceSystem(),tenant,body));
    }
    @PostMapping("/tenants/{id}/operations")
    public ResponseEntity<?> operation(HttpServletRequest http,@PathVariable String id,@RequestBody JsonNode body) {
        authorize(http,id,"sandbox:operate");
        // Capability absence is explicit; legacy restart may delete/replace a database and is not a safe substitute.
        throw new TenantCommandException(409,"OPERATION_NOT_SUPPORTED");
    }
    @GetMapping("/tenants/{id}/enterprise")
    public ResponseUtil<?> enterprise(HttpServletRequest http,@PathVariable String id) {
        return ResponseUtil.success(enterprises.getEnterprise(authorize(http,id,"tenant:read")));
    }
    @GetMapping("/tenants/{id}/members")
    public ResponseUtil<?> members(HttpServletRequest http,@PathVariable String id) {
        return ResponseUtil.success(enterprises.listMembers(authorize(http,id,"tenant:read")));
    }
    @PutMapping("/tenants/{id}/enterprise")
    public ResponseEntity<?> updateEnterprise(HttpServletRequest http,@PathVariable String id,@RequestBody JsonNode body) {
        long tenant=authorize(http,id,"tenant:manage");auditMutation(body);
        return accepted(commands.mutation(InternalServicePrincipal.require(http).sourceSystem(),tenant,"ENTERPRISE_UPDATE",body,
            () -> { enterprises.updateEnterprise(tenant,body.get("data"));return null; }));
    }
    @PostMapping("/tenants/{id}/members")
    public ResponseEntity<?> addMember(HttpServletRequest http,@PathVariable String id,@RequestBody JsonNode body) {
        long tenant=authorize(http,id,"tenant:manage");auditMutation(body);
        return accepted(commands.mutation(InternalServicePrincipal.require(http).sourceSystem(),tenant,"MEMBER_ADD",body,
            () -> { enterprises.addMember(tenant,body.get("data"));return null; }));
    }

    /**
     * 为不启动独立 Node 的共享工作区增加成员。该接口只表达通用成员写入，
     * 不携带套餐或试用语义；商业开通由 HACU 负责。
     */
    @PostMapping("/shared-workspaces/{id}/members")
    public ResponseEntity<?> addSharedWorkspaceMember(HttpServletRequest http,@PathVariable String id,
        @RequestBody JsonNode body) {
        var principal = InternalServicePrincipal.require(http);
        principal.requireScope("tenant:manage");
        if (!principal.allTenants()) throw new TenantCommandException(403,"TENANT_MANAGE_SCOPE_REQUIRED");
        long tenant = identifier(id);
        if (!TenantContextService.isSharedWorkspace(tenant)) {
            throw new TenantCommandException(404,"SHARED_WORKSPACE_NOT_FOUND");
        }
        auditMutation(body);
        return ResponseEntity.ok(ResponseUtil.success(enterprises.addSharedWorkspaceMember(tenant,body.get("data"))));
    }
    private void auditMutation(JsonNode body) {
        TenantCommandRequest.fields(body,Set.of("requestId","actor","reason","data"));
        TenantCommandRequest.fields(body.get("actor"),Set.of("type","id"));
        TenantCommandRequest.text(body.get("actor"),"type",64);TenantCommandRequest.text(body.get("actor"),"id",128);
        TenantCommandRequest.text(body,"reason",500);
    }
    private long authorize(HttpServletRequest request,String id,String scope) {
        var principal=InternalServicePrincipal.require(request);principal.requireScope(scope);principal.requireTenant(id);
        long tenant=identifier(id);commands.requireSourceTenant(principal.sourceSystem(),tenant);return tenant;
    }
    private TenantCommandStore.Command visible(InternalServicePrincipal principal,TenantCommandStore.Command command) {
        if(command==null) throw new TenantCommandException(404,"COMMAND_NOT_FOUND");
        principal.requireSource(command.sourceSystem());principal.requireTenant(command.enterpriseId());return command;
    }
    private static long identifier(String value) { return TenantCommandRequest.decimal(TextNode.valueOf(value)); }
    private static ResponseEntity<?> accepted(TenantCommandStore.Command value) {
        return ResponseEntity.accepted().body(ResponseUtil.success(value.view()));
    }
}
