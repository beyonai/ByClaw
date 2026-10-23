package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantPackageRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Platform administrator entry point for idempotent tenant reservation. */
@Service
public class TenantAdminTenantService {

    private final TenantAdminTenantMapper tenantMapper;
    private final SequenceService sequenceService;
    private final ObjectMapper objectMapper;
    private final HookPublisher hookPublisher;

    public TenantAdminTenantService(TenantAdminTenantMapper tenantMapper, SequenceService sequenceService,
                                    ObjectMapper objectMapper, HookPublisher hookPublisher) {
        this.tenantMapper = tenantMapper;
        this.sequenceService = sequenceService;
        this.objectMapper = objectMapper;
        this.hookPublisher = hookPublisher;
    }

    @Transactional(readOnly = true)
    public List<TenantView> list(TenantListFilter filter) {
        requirePlatformAdmin();
        TenantListFilter query = filter == null ? new TenantListFilter(null, null, null, null, null) : filter;
        String name = query.name() == null ? null : query.name().trim();
        if (name != null && name.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.filter.nameTooLong");
        }
        if (query.sortField() != null && !List.of("createdAt", "openedAt", "enterpriseName")
            .contains(query.sortField())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.sort.field.invalid");
        }
        if (query.sortOrder() != null && !List.of("asc", "desc").contains(query.sortOrder())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.sort.order.invalid");
        }
        LocalDateTime from = parseTime(query.createdFrom());
        LocalDateTime to = parseTime(query.createdTo());
        if (from != null && to != null && !from.isBefore(to)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.createdRange.invalid");
        }
        return tenantMapper.selectTenants(name, from, to, query.sortField(), query.sortOrder())
            .stream().map(this::toView).toList();
    }

    private LocalDateTime parseTime(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDateTime.parse(value);
        }
        catch (DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.createdTime.invalid", e);
        }
    }

    @Transactional(readOnly = true)
    public List<PackageView> packages() {
        requirePlatformAdmin();
        return tenantMapper.selectEnabledPackages().stream()
            .map(row -> new PackageView(row.getId(), row.getPackageName(), row.getPackageContent()))
            .toList();
    }

    @Transactional
    public TenantView create(String name, long packageId, String requestId) {
        requirePlatformAdmin();
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant.login.required");
        }
        if (name == null || name.isBlank() || name.length() > 200 || !name.equals(name.trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.name.invalid");
        }
        if (requestId == null || !requestId.matches("[a-zA-Z0-9_-]{8,64}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.requestId.invalid");
        }
        TenantPackageRow selectedPackage = tenantMapper.selectEnabledPackage(packageId);
        if (selectedPackage == null || !validPackage(selectedPackage.getPackageContent())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.package.invalid");
        }

        TenantAdminTenantRow existing = tenantMapper.selectByRequestId(requestId);
        if (existing != null) {
            if (!userId.equals(existing.getCreatedBy()) || !name.equals(existing.getEnterpriseName())
                || !selectedPackage.getPackageName().equals(existing.getPackageName())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.requestId.used");
            }
            return toView(existing);
        }

        long enterpriseId = sequenceService.nextVal();
        String state = stateJson("RESERVED");
        tenantMapper.insertEnterprise(enterpriseId, name);
        insertConfig(enterpriseId, "PROVISION_REQUEST_ID", requestId);
        insertConfig(enterpriseId, "PACKAGE_SPEC_ID", Long.toString(packageId));
        insertConfig(enterpriseId, "PACKAGE_NAME_SNAPSHOT", selectedPackage.getPackageName());
        insertConfig(enterpriseId, "PACKAGE_CONTENT_SNAPSHOT", selectedPackage.getPackageContent());
        insertConfig(enterpriseId, "PROVISION_STATE", state);
        tenantMapper.insertOwner(sequenceService.nextVal(), enterpriseId, userId);
        // 仅新建租户发布事件；幂等请求已在前面返回，HTTP 由 Hook 机制在事务提交后异步执行。
        hookPublisher.publish("tenant.created", 1, Map.of(
            "enterpriseId", Long.toString(enterpriseId),
            "enterpriseName", name,
            "packageId", Long.toString(packageId),
            "packageName", selectedPackage.getPackageName(),
            "createdBy", userId.toString(),
            "requestId", requestId,
            "provisionState", "RESERVED"));
        return new TenantView(Long.toString(enterpriseId), name, selectedPackage.getPackageName(), "RESERVED",
            "RESERVED", null, null, null);
    }

    private void insertConfig(long enterpriseId, String code, String value) {
        tenantMapper.insertConfig(sequenceService.nextVal(), enterpriseId, code, value);
    }

    private boolean validPackage(String json) {
        try {
            JsonNode content = objectMapper.readTree(json);
            return content.path("memberLimit").asInt() > 0
                && List.of("s", "m", "l").contains(content.path("profileKey").asText());
        }
        catch (Exception ignored) {
            return false;
        }
    }

    private String stateJson(String status) {
        try {
            return objectMapper.writeValueAsString(Map.of("status", status, "generation", "1", "fencingToken", "1"));
        }
        catch (JsonProcessingException e) {
            throw new IllegalStateException("tenant provision state serialization failed", e);
        }
    }

    private TenantView toView(TenantAdminTenantRow row) {
        String status = "UNAVAILABLE";
        String stage = "UNAVAILABLE";
        try {
            JsonNode state = objectMapper.readTree(row.getProvisionStateJson());
            status = state.path("status").asText("UNAVAILABLE");
            stage = "FAILED".equals(status) ? state.path("lastStage").asText("RESERVED") : status;
        }
        catch (Exception ignored) {
            // Invalid persisted state never grants tenant access.
        }
        return new TenantView(Long.toString(row.getEnterpriseId()), row.getEnterpriseName(),
            row.getPackageName(), status, stage, row.getCreatedAt(), row.getOpenedAt(), failureReason(row.getFailureReason()));
    }

    /** 后台任务保存稳定错误键；读取时按查看者语言展示，历史诊断原文保持可读。 */
    private String failureReason(String reason) {
        if (reason == null) return null;
        // 兼容已持久化的任务失败前缀，异常类型仍保留用于排查。
        for (var entry : Map.of(
            "tenant deletion failed: ", "tenant.failure.deletion",
            "tenant sandbox restart failed: ", "tenant.failure.restart",
            "tenant Node replacement failed: ", "tenant.failure.replacement").entrySet()) {
            if (reason.startsWith(entry.getKey())) {
                return I18nUtil.get(entry.getValue(), reason.substring(entry.getKey().length()));
            }
        }
        if ("tenant provisioning failed".equals(reason)) return I18nUtil.get("tenant.failure.provisioning");
        if (!reason.startsWith("tenant.")) return reason;
        try {
            return I18nUtil.get(reason);
        } catch (org.springframework.context.NoSuchMessageException ignored) {
            return reason;
        }
    }

    private void requirePlatformAdmin() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant.admin.required");
        }
    }

    public record TenantListFilter(String name, String createdFrom, String createdTo,
                                   String sortField, String sortOrder) {
    }

    public record TenantView(String enterpriseId, String enterpriseName, String packageName, String provisionState,
                             String provisionStage, String createdAt, String openedAt, String failureReason) {
    }

    public record PackageView(long id, String packageName, String packageContent) {
    }
}
