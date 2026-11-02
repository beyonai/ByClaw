package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** Per-user runtime evidence, separate from resource import/configuration sync success. */
@Service
public class SkillRuntimeStatusService {
    static final String PREFIX = "byai:skill_runtime:";
    private final SsResourceService resources;
    private final SsResExtSkillService extensions;
    private final AuthApplicationService auth;
    private final StringRedisTemplate redis;

    public SkillRuntimeStatusService(SsResourceService resources, SsResExtSkillService extensions,
                                     AuthApplicationService auth, StringRedisTemplate redis) {
        this.resources = resources;
        this.extensions = extensions;
        this.auth = auth;
        this.redis = redis;
    }

    public record Skill(String resourceId, String skillCode, String name, String state, String errorCode) { }
    public record Status(String employeeId, List<Skill> skills, int liveInstances, long checkedAt) { }

    public Status query(Long employeeId) {
        assertEmployeeUse(employeeId);
        String uid = String.valueOf(CurrentUserHolder.getCurrentUserId());
        String snapshot = redis.opsForValue().get("DIG_EMPLOYEE_" + employeeId);
        String hash = snapshot == null ? "" : digest(snapshot);
        long now = System.currentTimeMillis();
        List<JSONObject> receipts = activeReceipts(redis.opsForHash().entries(PREFIX + uid + ":" + employeeId),
            String.valueOf(employeeId), now);
        List<Skill> result = new ArrayList<>();
        // Read current DB associations: stale Redis data must not hide a newly associated skill or resurrect a removed one.
        for (var resource : resources.findRelResource(employeeId)) {
            if (!"SKILL".equals(resource.getResourceBizType()) || !auth.hasResourceUsePermission(resource)) continue;
            var ext = extensions.findById(resource.getResourceId());
            if (ext != null && "inner".equals(ext.getSkillType())) {
                result.add(skill(resource, "BUILT_IN", null));
                continue;
            }
            String state = "READY";
            String error = null;
            if (receipts.isEmpty()) { state = "WAITING_RUNTIME"; error = "NO_RUNTIME_RECEIPT"; }
            for (JSONObject receipt : receipts) {
                JSONObject match = null;
                if (!hash.isEmpty() && hash.equals(receipt.getString("snapshotHash"))) {
                    var entries = receipt.getJSONArray("skills");
                    if (entries != null) for (int i = 0; i < entries.size(); i++) {
                        JSONObject entry = entries.getJSONObject(i);
                        if (entry != null && Objects.equals(resource.getResourceCode(), entry.getString("skillCode"))) {
                            match = entry;
                            break;
                        }
                    }
                }
                String instanceState = match == null ? "PREPARING" : match.getString("state");
                if ("READY".equals(instanceState) && (ext == null || !Objects.equals(ext.getVersion(), match.getString("version")))) {
                    instanceState = "PREPARING";
                    match = null;
                }
                if ("FAILED".equals(instanceState)) {
                    state = "FAILED";
                    error = safeError(match.getString("errorCode"));
                    break;
                }
                if (!"READY".equals(instanceState)) {
                    state = "PREPARING";
                    error = match == null ? "CONFIG_PENDING" : safeError(match.getString("errorCode"));
                }
            }
            result.add(skill(resource, state, error));
        }
        return new Status(String.valueOf(employeeId), result, receipts.size(), now);
    }

    /** Requests repair of existing authorized associations, never installs a market resource or grants access. */
    public Status prepare(Long employeeId) {
        Status current = query(employeeId);
        // Coalesce repeated clicks across tabs; runtimes consume the request during their bounded reconciliation loop.
        redis.opsForValue().setIfAbsent(PREFIX + "request:" + CurrentUserHolder.getCurrentUserId() + ":" + employeeId,
            UUID.randomUUID().toString(), Duration.ofSeconds(30));
        return current;
    }

    private void assertEmployeeUse(Long id) {
        SsResource employee = id == null ? null : resources.findById(id);
        if (employee == null || !"DIG_EMPLOYEE".equals(employee.getResourceBizType())
            || !auth.hasResourceUsePermission(employee)) {
            throw new BaseException(50500, I18nUtil.get("digemployee.resource.install.no.use.permission"));
        }
    }

    private static Skill skill(SsResource resource, String state, String error) {
        return new Skill(String.valueOf(resource.getResourceId()), resource.getResourceCode(),
            resource.getResourceName(), state, error);
    }

    static List<JSONObject> activeReceipts(Map<Object, Object> entries, String employeeId, long now) {
        List<JSONObject> receipts = new ArrayList<>();
        for (var entry : entries.entrySet()) {
            try {
                JSONObject receipt = JSON.parseObject(String.valueOf(entry.getValue()));
                if (receipt != null && receipt.getIntValue("schemaVersion") == 1
                    && employeeId.equals(receipt.getString("employeeId"))
                    && String.valueOf(entry.getKey()).equals(receipt.getString("runtimeId"))
                    && receipt.getLongValue("observedAt") <= now + 5000
                    && receipt.getLongValue("observedAt") >= now - 60000
                    && receipt.getLongValue("expiresAt") > now
                    && receipt.getLongValue("expiresAt") <= now + 65000) receipts.add(receipt);
            } catch (RuntimeException ignored) { /* A malformed/old receipt is not evidence of readiness. */ }
        }
        return receipts;
    }

    static String digest(String content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static String safeError(String error) {
        return error != null && error.matches("[A-Z_]{1,64}") ? error : "PREPARATION_PENDING";
    }
}
