package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostClient.UserContext;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

/**
 * Runs {@code byclaw-dsh} sandboxes as user contexts on the shared DSH host and delegates every other
 * sandbox type to the regular runtime.
 *
 * <p>A shared context is recorded like any sandbox. Its sandbox id is {@code byclaw-dsh-<userCode>}, the
 * same value as the {@code BYAI_WORKER_ID} a per-user DSH container reports activity under, so idle
 * reclaim, reconcile and release find it without changes. Records whose id differs (per-user sandboxes
 * started before the host was configured) keep going to the regular runtime until they are released.</p>
 *
 * <p>Which users get a shared context is decided per launch by {@code sharedUsers}: the system parameter
 * {@value #USERS_PARAM} lists their user codes ({@link #userFilter(Supplier)}); absent, blank or {@code *}
 * means every {@code byclaw-dsh} user, as before. Other users' {@code byclaw-dsh} sandboxes stay on the
 * regular runtime. A running record keeps its runtime either way until it is released.</p>
 */
public class SharedDshHostRuntimeProvider implements SandboxRuntimeProvider {

    private static final Logger log = LoggerFactory.getLogger(SharedDshHostRuntimeProvider.class);

    static final String METADATA_SHARED_HOST = "sharedDshHost";
    /** System parameter: user codes that run on the shared host; absent, blank or {@code *} = everyone. */
    public static final String USERS_PARAM = "BYCLAW_SHARED_DSH_HOST_USERS";
    private static final Pattern USER_LIST_SEPARATOR = Pattern.compile("[,;\\s]+");
    private static final String METADATA_GATEWAY_TOKEN = "gateway_token";
    private static final String SANDBOX_TYPE = SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE;

    private final SandboxRuntimeProvider delegate;
    private final SharedDshHostClient client;
    private final String webBaseUrl;
    private final Predicate<String> sharedUsers;

    /** Every {@code byclaw-dsh} user runs on the shared host. */
    public SharedDshHostRuntimeProvider(SandboxRuntimeProvider delegate, SharedDshHostClient client, String webBaseUrl) {
        this(delegate, client, webBaseUrl, userCode -> true);
    }

    /**
     * @param sharedUsers decides per user code whether a new {@code byclaw-dsh} sandbox becomes a shared
     *                    context (true) or goes to the regular runtime (false)
     */
    public SharedDshHostRuntimeProvider(SandboxRuntimeProvider delegate, SharedDshHostClient client, String webBaseUrl,
                                        Predicate<String> sharedUsers) {
        this.delegate = delegate;
        this.client = client;
        this.webBaseUrl = StringUtils.removeEnd(StringUtils.trimToEmpty(webBaseUrl), "/");
        this.sharedUsers = sharedUsers;
    }

    /**
     * User filter backed by the {@value #USERS_PARAM} system parameter, read on every decision so an
     * administrator's change applies to the next launch. Unreadable configuration keeps the default
     * (everyone) and is logged.
     */
    public static Predicate<String> userFilter(Supplier<String> configuredUsers) {
        return userCode -> {
            String value;
            try {
                value = configuredUsers.get();
            }
            catch (RuntimeException e) {
                log.warn("读取系统参数 {} 失败，按全部用户使用共享 DSH 宿主处理：{}", USERS_PARAM, e.getMessage());
                return true;
            }
            return allowsUser(value, userCode);
        };
    }

    /** {@code null}, blank or {@code *} allows everyone; otherwise the comma/semicolon/space separated list. */
    static boolean allowsUser(String configuredUsers, String userCode) {
        String value = StringUtils.trimToEmpty(configuredUsers);
        if (value.isEmpty() || "*".equals(value)) {
            return true;
        }
        Set<String> users = Set.of(USER_LIST_SEPARATOR.split(value));
        return users.contains(StringUtils.trimToEmpty(userCode));
    }

    /** Sandbox id of a user's shared context; equals the worker id BE injects as {@code BYAI_WORKER_ID}. */
    public static String sharedSandboxId(String userCode) {
        return SANDBOX_TYPE + "-" + userCode;
    }

    @Override
    public String providerType() {
        return delegate.providerType() + "+shared-dsh-host";
    }

    @Override
    public Optional<SandboxRuntimeInstance> findReusable(String userCode, String sandboxType) {
        // PUT is idempotent and is the only call that returns the web token, so a running context is
        // "reused" by create().
        return routesToHost(userCode, sandboxType) ? Optional.empty() : delegate.findReusable(userCode, sandboxType);
    }

    @Override
    public SandboxRuntimeInstance create(CreateSandboxRequest request,
                                         SandboxServiceSpec spec,
                                         String userCode,
                                         String sandboxType,
                                         String idempotencyKey) {
        if (!routesToHost(userCode, sandboxType)) {
            return delegate.create(request, spec, userCode, sandboxType, idempotencyKey);
        }
        String sandboxId = sharedSandboxId(userCode);
        log.info("共享 DSH 宿主启动用户上下文，userCode={}，sandboxId={}", userCode, sandboxId);
        UserContext context = client.ensureUser(userCode, sandboxId, request != null ? request.getEnv() : null);
        Map<String, String> metadata = new LinkedHashMap<>();
        if (request != null && request.getMetadata() != null) {
            metadata.putAll(request.getMetadata());
        }
        metadata.put("userCode", userCode);
        metadata.put("serviceKey", sandboxType);
        metadata.put(METADATA_GATEWAY_TOKEN, context.getWebToken());
        metadata.put(METADATA_SHARED_HOST, StringUtils.defaultString(context.getHostId()));
        log.info("共享 DSH 宿主用户上下文就绪，userCode={}，sandboxId={}，hostId={}", userCode, sandboxId,
            context.getHostId());
        return SandboxRuntimeInstance.builder()
            .sandboxId(sandboxId)
            .endpoints(List.of(webEndpoint(userCode, context.getWebPath())))
            .createdAt(OffsetDateTime.now())
            .state("Running")
            .reusable(Boolean.TRUE)
            .metadata(metadata)
            .build();
    }

    @Override
    public List<String> resolveEndpoints(SandboxRuntimeInstance instance,
                                         SandboxServiceSpec spec,
                                         CreateSandboxRequest request) {
        return isShared(instance) ? instance.getEndpoints() : delegate.resolveEndpoints(instance, spec, request);
    }

    @Override
    public Map<String, String> resolveEndpointHeaders(SandboxRuntimeInstance instance) {
        return isShared(instance) ? null : delegate.resolveEndpointHeaders(instance);
    }

    @Override
    public void remove(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (!owns(userCode, sandboxType, sandboxInfo)) {
            delegate.remove(userCode, sandboxType, sandboxInfo);
            return;
        }
        log.info("共享 DSH 宿主释放用户上下文，userCode={}，sandboxId={}", userCode,
            sandboxInfo != null ? sandboxInfo.getSandboxId() : null);
        client.deleteUser(userCode);
    }

    @Override
    public void heartbeat(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        // A shared context has no remote expiry; it lives until DELETE.
        if (!owns(userCode, sandboxType, sandboxInfo)) {
            delegate.heartbeat(userCode, sandboxType, sandboxInfo);
        }
    }

    @Override
    public Optional<SandboxRuntimeInstance> getSandbox(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (!owns(userCode, sandboxType, sandboxInfo)) {
            return delegate.getSandbox(userCode, sandboxType, sandboxInfo);
        }
        return toInstance(userCode, client.getUser(userCode));
    }

    @Override
    public boolean exists(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (!owns(userCode, sandboxType, sandboxInfo)) {
            return delegate.exists(userCode, sandboxType, sandboxInfo);
        }
        return getSandbox(userCode, sandboxType, sandboxInfo)
            .map(SandboxRuntimeInstance::getReusable)
            .orElse(false);
    }

    /**
     * Adds the user's shared context to the regular runtime's page when the query targets one user's
     * {@code byclaw-dsh} sandboxes, so reconcile sees both migrated and not-yet-migrated records. A host
     * error propagates: reconcile then reports the group as failed instead of releasing its records.
     */
    @Override
    public SandboxRuntimePage<SandboxRuntimeInstance> listSandboxesByMetadata(Map<String, String> metadata,
                                                                              int pageNo,
                                                                              int pageSize) {
        SandboxRuntimePage<SandboxRuntimeInstance> page = delegate.listSandboxesByMetadata(metadata, pageNo, pageSize);
        String userCode = metadata != null ? StringUtils.trimToNull(metadata.get("userCode")) : null;
        if (userCode == null || pageNo > 1 || !targetsDsh(metadata)) {
            return page;
        }
        Optional<SandboxRuntimeInstance> shared = toInstance(userCode, client.getUser(userCode));
        if (shared.isEmpty()) {
            return page;
        }
        List<SandboxRuntimeInstance> items = new ArrayList<>(page != null ? page.safeItems() : List.of());
        items.add(shared.get());
        return SandboxRuntimePage.<SandboxRuntimeInstance>builder()
            .items(items)
            .pageNo(page != null ? page.getPageNo() : Math.max(1, pageNo))
            .pageSize(page != null ? page.getPageSize() : Math.max(1, pageSize))
            .hasNext(page != null && page.isHasNext())
            .build();
    }

    private Optional<SandboxRuntimeInstance> toInstance(String userCode, UserContext context) {
        String status = context != null ? StringUtils.trimToEmpty(context.getStatus()) : UserContext.STATUS_ABSENT;
        if (UserContext.STATUS_ABSENT.equals(status) || status.isEmpty()) {
            return Optional.empty();
        }
        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("userCode", userCode);
        metadata.put("serviceKey", SANDBOX_TYPE);
        metadata.put(METADATA_SHARED_HOST, StringUtils.defaultString(context.getHostId()));
        String state = switch (status) {
            case UserContext.STATUS_READY -> "Running";
            case UserContext.STATUS_STARTING -> "Pending";
            default -> "Failed";
        };
        return Optional.of(SandboxRuntimeInstance.builder()
            .sandboxId(sharedSandboxId(userCode))
            .state(state)
            .reusable(!"Failed".equals(state))
            .metadata(metadata)
            .build());
    }

    private String webEndpoint(String userCode, String webPath) {
        String path = StringUtils.isNotBlank(webPath)
            ? webPath.trim()
            : "/u/" + URLEncoder.encode(userCode, StandardCharsets.UTF_8).replace("+", "%20") + "/";
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        return webBaseUrl + (path.endsWith("/") ? path : path + "/");
    }

    /** A {@code byclaw-dsh} record belongs to the host unless it carries another runtime's sandbox id. */
    private static boolean owns(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        if (!isDsh(sandboxType) || StringUtils.isBlank(userCode)) {
            return false;
        }
        String sandboxId = sandboxInfo != null ? sandboxInfo.getSandboxId() : null;
        return StringUtils.isBlank(sandboxId) || sharedSandboxId(userCode).equals(sandboxId);
    }

    private static boolean isShared(SandboxRuntimeInstance instance) {
        return instance != null && instance.getMetadata() != null
            && instance.getMetadata().containsKey(METADATA_SHARED_HOST);
    }

    private static boolean targetsDsh(Map<String, String> metadata) {
        String serviceKey = StringUtils.trimToNull(metadata.get("serviceKey"));
        if (serviceKey != null) {
            return isDsh(serviceKey);
        }
        return isDsh(StringUtils.trimToNull(metadata.get("serviceType")));
    }

    private static boolean isDsh(String sandboxType) {
        return SANDBOX_TYPE.equals(sandboxType);
    }

    /** New {@code byclaw-dsh} sandboxes of listed users become shared contexts; others use the delegate. */
    private boolean routesToHost(String userCode, String sandboxType) {
        return isDsh(sandboxType) && sharedUsers.test(StringUtils.trimToEmpty(userCode));
    }
}
