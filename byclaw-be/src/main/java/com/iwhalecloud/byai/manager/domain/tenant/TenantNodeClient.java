package com.iwhalecloud.byai.manager.domain.tenant;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandHashBody;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandRequest;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.ErrorEnvelope;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.ProvisionState;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.ReadyView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.Registration;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import jakarta.annotation.PreDestroy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Resolves the provisioned tenant Node from platform-owned records and calls its internal API. */
@Service
public class TenantNodeClient {

    private static final Logger LOG = LoggerFactory.getLogger(TenantNodeClient.class);

    private final TenantAdminTenantMapper tenantMapper;
    private final SsSandboxRecordMapper sandboxMapper;
    private final ObjectMapper mapper;
    private final DiscoveryClient discovery;
    private final String internalToken;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public TenantNodeClient(TenantAdminTenantMapper tenantMapper, SsSandboxRecordMapper sandboxMapper,
                            ObjectMapper mapper, RedisClient redisClient,
                            @org.springframework.beans.factory.annotation.Value("${BYCLAW_TENANT_INTERNAL_TOKEN:}")
                            String internalToken) {
        this.tenantMapper = tenantMapper;
        this.sandboxMapper = sandboxMapper;
        this.mapper = mapper;
        this.discovery = new DiscoveryClient(redisClient, 5);
        this.internalToken = internalToken;
    }

    @PreDestroy
    public void close() {
        discovery.close();
    }

    public <I, O> O request(TenantRequestContext context, String method, String path, I body,
                             TypeReference<O> responseType) {
        if (context == null || !path.startsWith("/internal/v1/") || path.contains("..")
            || !("GET".equals(method) || "POST".equals(method) || "PATCH".equals(method)
                || "DELETE".equals(method))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant Node request");
        }
        long enterpriseId = context.enterpriseId();
        String recordId = tenantMapper.selectConfig(enterpriseId, "NODE_SANDBOX_RECORD_ID");
        String stateJson = tenantMapper.selectConfig(enterpriseId, "PROVISION_STATE");
        try {
            ProvisionState state = mapper.readValue(stateJson, ProvisionState.class);
            long generation = state.generation();
            if (!"READY".equals(state.status()) || generation <= 0
                || recordId == null || !recordId.matches("[1-9][0-9]*")) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant Node is not ready");
            }
            SsSandboxRecord record = sandboxMapper.selectActiveTenantByResourceAndType(enterpriseId,
                "tenant-data-node");
            if (record == null || !"TENANT".equals(record.getOwnerScope())
                || !"RUNNING".equals(record.getStatus()) || record.getId() == null
                || record.getId() != Long.parseLong(recordId) || record.getEnterpriseId() == null
                || record.getEnterpriseId() != enterpriseId || internalToken == null || internalToken.isBlank()) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant Node identity mismatch");
            }
            String dbRecordId = dbRecordId(enterpriseId);
            URI base = discover(context, generation, dbRecordId, record);
            ReadyView ready = send(base, "/internal/v1/health/ready", "GET", null, context, generation,
                new TypeReference<ReadyView>() { });
            if (!ready.ready() || !Long.toString(enterpriseId).equals(ready.enterpriseId())
                || !Long.toString(generation).equals(ready.generation())
                || !dbRecordId.equals(ready.dbSandboxRecordId())) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant Node readiness mismatch");
            }
            return send(base, path, method, body, context, generation, responseType);
        }
        catch (ResponseStatusException e) {
            throw e;
        }
        catch (Exception e) {
            LOG.warn("Tenant Node transport failed for {} {}: {}", method, path, e.getClass().getSimpleName());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "tenant Node unavailable");
        }
    }

    public CommandResult command(TenantRequestContext context, String method, String path, String sessionId,
                                 String operation, CommandPayload payload) {
        return command(context, method, path, sessionId, operation, payload, UUID.randomUUID().toString());
    }

    public CommandResult command(TenantRequestContext context, String method, String path, String sessionId,
                                 String operation, CommandPayload payload, String requestId) {
        return command(context, method, path, sessionId, operation, payload, requestId,
            List.of(Long.toString(context.userId())));
    }

    public CommandResult command(TenantRequestContext context, String method, String path, String sessionId,
                                 String operation, CommandPayload payload, String requestId,
                                 List<String> tenantMemberUserIds) {
        try {
            if (requestId == null || !requestId.matches("[A-Za-z0-9:_-]{1,64}")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant command request ID");
            }
            long enterpriseId = context.enterpriseId();
            ProvisionState state = mapper.readValue(tenantMapper.selectConfig(enterpriseId, "PROVISION_STATE"),
                ProvisionState.class);
            String dbRecordId = tenantMapper.selectConfig(enterpriseId, "DB_SANDBOX_RECORD_ID");
            if (state == null || state.generation() <= 0
                || dbRecordId == null || !dbRecordId.matches("[1-9][0-9]*")) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant command identity missing");
            }
            CommandHashBody hashBody = new CommandHashBody(1, Long.toString(enterpriseId),
                Long.toString(context.userId()), requestId, sessionId, operation, payload);
            String hash = commandHash(mapper, hashBody);
            CommandRequest body = new CommandRequest(1, Long.toString(enterpriseId),
                Long.toString(state.generation()), dbRecordId, Long.toString(context.userId()), requestId,
                sessionId, operation, tenantMemberUserIds, hash, payload);
            return request(context, method, path, body, new TypeReference<CommandResult>() { });
        }
        catch (ResponseStatusException e) {
            throw e;
        }
        catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "tenant command unavailable");
        }
    }

    public MirrorResult mirror(TenantRequestContext context, MirrorEvent event) {
        return request(context, "POST", "/internal/v1/chat/mirror", event,
            new TypeReference<MirrorResult>() { });
    }

    static String commandHash(ObjectMapper mapper, CommandHashBody body) throws Exception {
        ObjectMapper canonical = mapper.copy().configure(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY, true);
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest(canonical.writeValueAsString(body).getBytes(StandardCharsets.UTF_8)));
    }

    private String dbRecordId(long enterpriseId) {
        String value = tenantMapper.selectConfig(enterpriseId, "DB_SANDBOX_RECORD_ID");
        if (value == null || !value.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant DB record missing");
        }
        return value;
    }

    private URI discover(TenantRequestContext context, long generation, String dbRecordId,
                         SsSandboxRecord record) {
        String name = "TENANT_DATA_" + context.enterpriseId();
        List<ServiceInstance> instances = discovery.getInstances(name);
        URI registered = registeredEndpoint(name, context.enterpriseId(), generation, dbRecordId, instances);
        return containerEndpoint(registered, record.getSandboxId());
    }

    static URI containerEndpoint(URI registered, String sandboxId) {
        try {
            if (sandboxId == null || !UUID.fromString(sandboxId).toString().equals(sandboxId)) {
                throw new IllegalArgumentException("invalid sandbox ID");
            }
        }
        catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "tenant Node sandbox identity is invalid");
        }
        return URI.create("http://sandbox-" + sandboxId + ":" + registered.getPort());
    }

    static URI registeredEndpoint(String name, long enterpriseId, long generation, String dbRecordId,
                                  List<ServiceInstance> instances) {
        if (instances == null || instances.size() != 1) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant Node registration unavailable");
        }
        ServiceInstance instance = instances.get(0);
        Registration registration = instance.getMetadata() == null ? null
            : new ObjectMapper().convertValue(instance.getMetadata(), Registration.class);
        if (registration == null
            || !Long.toString(enterpriseId).equals(registration.enterpriseId())
            || !Long.toString(generation).equals(registration.generation())
            || !dbRecordId.equals(registration.dbSandboxRecordId())
            || !"READY".equals(registration.mode())
            || !name.equals(registration.agentType())
            || !"http".equals(instance.getProtocol()) || instance.getHost() == null
            || instance.getPort() <= 0 || instance.getPort() > 65535) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant Node registration mismatch");
        }
        String pathPrefix = instance.getPathPrefix() == null ? "" : instance.getPathPrefix();
        if (pathPrefix.contains("..") || (!pathPrefix.isEmpty() && !pathPrefix.startsWith("/"))) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant Node registration path invalid");
        }
        return URI.create("http://" + instance.getHost() + ":" + instance.getPort() + pathPrefix);
    }

    private <I, O> O send(URI base, String path, String method, I body, TenantRequestContext context,
                          long generation, TypeReference<O> responseType) throws Exception {
        long enterpriseId = context.enterpriseId();
        URI target = base.resolve(base.getPath().replaceAll("/+$", "") + path);
        byte[] content = body == null ? null : mapper.writeValueAsBytes(body);
        HttpRequest.Builder request = HttpRequest.newBuilder(target).timeout(Duration.ofSeconds(15))
            .header("X-Byclaw-Internal-Token", internalToken)
            .header("X-Enterprise-Id", Long.toString(enterpriseId))
            .header("X-Tenant-Generation", Long.toString(generation))
            .header("X-Actor-User-Id", Long.toString(context.userId()));
        if (content != null) request.header("Content-Type", "application/json");
        request.method(method, content == null ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofByteArray(content));
        HttpResponse<byte[]> response = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            ErrorEnvelope error;
            try {
                error = mapper.readValue(response.body(), ErrorEnvelope.class);
            }
            catch (JsonProcessingException e) {
                LOG.warn("Tenant Node error response decode failed for {} {}: status={}, bytes={}",
                    method, path, response.statusCode(), response.body().length);
                throw e;
            }
            String code = error == null || error.error() == null ? "UNKNOWN" : error.error().code();
            throw new ResponseStatusException(response.statusCode() == 404 ? HttpStatus.NOT_FOUND
                : response.statusCode() == 403 ? HttpStatus.FORBIDDEN
                    : response.statusCode() == 400 ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY,
                "tenant Node rejected request: " + code);
        }
        try {
            return mapper.readValue(response.body(), responseType);
        }
        catch (JsonProcessingException e) {
            LOG.warn("Tenant Node success response decode failed for {} {}: status={}, bytes={}",
                method, path, response.statusCode(), response.body().length);
            throw e;
        }
    }
}
