package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostClient.UserContext;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;

/**
 * Users served by the resident (shared) DSH host. Their {@code byclaw-dsh} "sandbox" is a per-user context
 * inside one long-running process, so nothing here is a sandbox record: the host is the only source of
 * truth. {@link #ensure} is an idempotent {@code PUT} that returns within milliseconds for a running
 * context and boots it otherwise; {@link #release} deletes it; {@link #info} reads it for listings.
 * Tool sandboxes (B) are a separate matter the host's runtime starts on its first tool call.
 */
public final class SharedDshHostContexts {

    private static final Logger log = LoggerFactory.getLogger(SharedDshHostContexts.class);

    /** System parameter: user codes that run on the shared host; absent, blank or {@code *} = nobody. */
    public static final String USERS_PARAM = "BYCLAW_SHARED_DSH_HOST_USERS";
    public static final String WEB_INSTANCE = "openclaw";
    private static final Pattern USER_LIST_SEPARATOR = Pattern.compile("[,;\\s]+");
    private static final String SANDBOX_TYPE = SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE;

    private final SharedDshHostClient client;
    private final String webBaseUrl;
    private final Predicate<String> sharedUsers;
    private final Function<String, Map<String, String>> launchEnv;
    private final Executor prewarmExecutor;

    /**
     * @param client      the host's admin API
     * @param webBaseUrl  browser-facing base of the host's {@code /u/{user}/} gateway
     * @param sharedUsers which user codes the host serves (see {@link #userFilter})
     * @param launchEnv   the environment a user's context starts with (what a {@code byclaw-dsh} sandbox would get)
     * @param prewarmExecutor runs {@link #prewarm} off the caller's thread
     */
    public SharedDshHostContexts(SharedDshHostClient client, String webBaseUrl, Predicate<String> sharedUsers,
                                 Function<String, Map<String, String>> launchEnv, Executor prewarmExecutor) {
        this.client = client;
        this.webBaseUrl = StringUtils.removeEnd(StringUtils.trimToEmpty(webBaseUrl), "/");
        this.sharedUsers = sharedUsers;
        this.launchEnv = launchEnv;
        this.prewarmExecutor = prewarmExecutor;
    }

    /** This user's {@code byclaw-dsh} is a context on the host. */
    public boolean routes(String userCode, String sandboxType) {
        String user = StringUtils.trimToEmpty(userCode);
        return SANDBOX_TYPE.equals(sandboxType) && !user.isEmpty() && sharedUsers.test(user);
    }

    /**
     * Idempotent: a running context answers at once, a missing one is booted with the user's launch environment.
     *
     * <p>The environment is rendered on every call, so each PUT carries a freshly minted {@code BEYOND_TOKEN}
     * (user JWTs expire after {@code jwt.token.expired.hour}); the host hands it to the running context, whose
     * tool-sandbox launches call BE as the user. Login auto-start and the worker-ready check before each
     * question both come through here, so a resident context never keeps an expired token across turns.</p>
     */
    public SandboxLaunchData ensure(String userCode) {
        String user = StringUtils.trimToEmpty(userCode);
        UserContext context = client.ensureUser(user, sharedSandboxId(user), launchEnv.apply(user));
        log.info("常驻 DSH 宿主用户上下文就绪，userCode={}，hostId={}", user, context.getHostId());
        return launchData(user, context.getWebPath(), context.getWebToken());
    }

    /** {@link #ensure} on the executor; failures are logged, never thrown (login must not wait for the host). */
    public void prewarm(String userCode) {
        prewarmExecutor.execute(() -> {
            try {
                ensure(userCode);
            }
            catch (RuntimeException e) {
                log.warn("常驻 DSH 宿主预热失败，userCode={}，原因：{}", userCode, e.getMessage());
            }
        });
    }

    /** Idempotent delete of the user's context. */
    public void release(String userCode) {
        String user = StringUtils.trimToEmpty(userCode);
        client.deleteUser(user);
        log.info("常驻 DSH 宿主用户上下文已释放，userCode={}", user);
    }

    /** The user's context as a sandbox listing entry, if the host has one. */
    public Optional<SandboxInfo> info(String userCode) {
        String user = StringUtils.trimToEmpty(userCode);
        UserContext context = client.getUser(user);
        if (context == null || UserContext.STATUS_ABSENT.equals(context.getStatus())) {
            return Optional.empty();
        }
        String web = webEndpoint(user, context.getWebPath(), context.getWebToken());
        return Optional.of(SandboxInfo.builder()
            .sandboxId(sharedSandboxId(user))
            .userCode(user)
            .sandboxType(SANDBOX_TYPE)
            .endpoints(List.of(web))
            .instanceEndpoints(Map.of(WEB_INSTANCE, web))
            .gatewayToken(context.getWebToken())
            .workerId(sharedSandboxId(user))
            .workerOnline(UserContext.STATUS_READY.equals(context.getStatus()))
            .build());
    }

    /** Sandbox id of a user's shared context; stable, never stored. */
    public static String sharedSandboxId(String userCode) {
        return SANDBOX_TYPE + "-" + StringUtils.trimToEmpty(userCode);
    }

    /**
     * User filter backed by the {@value #USERS_PARAM} system parameter, read on every decision so an
     * administrator's change applies to the next request. Unreadable configuration does not grant access.
     */
    public static Predicate<String> userFilter(Supplier<String> configuredUsers) {
        return userCode -> {
            String value;
            try {
                value = configuredUsers.get();
            }
            catch (RuntimeException e) {
                log.warn("读取系统参数 {} 失败，不授予常驻 DSH 宿主访问：{}", USERS_PARAM, e.getMessage());
                return false;
            }
            return allowsUser(value, userCode);
        };
    }

    /** Exact comma/semicolon/space separated membership; empty and wildcard do not grant access. */
    static boolean allowsUser(String configuredUsers, String userCode) {
        String value = StringUtils.trimToEmpty(configuredUsers);
        if (value.isEmpty() || "*".equals(value) || StringUtils.isBlank(userCode)) {
            return false;
        }
        Set<String> users = new java.util.HashSet<>(java.util.Arrays.asList(USER_LIST_SEPARATOR.split(value)));
        return users.contains(StringUtils.trimToEmpty(userCode));
    }

    private SandboxLaunchData launchData(String userCode, String webPath, String webToken) {
        String web = webEndpoint(userCode, webPath, webToken);
        SandboxLaunchData data = new SandboxLaunchData();
        data.setSandboxId(sharedSandboxId(userCode));
        data.setEndpoint(web);
        data.setEndpoints(List.of(web));
        Map<String, String> instances = new LinkedHashMap<>();
        instances.put(WEB_INSTANCE, web);
        data.setInstanceEndpoints(instances);
        data.setGatewayToken(webToken);
        return data;
    }

    private String webEndpoint(String userCode, String webPath, String webToken) {
        String path = StringUtils.isNotBlank(webPath)
            ? webPath.trim()
            : "/u/" + URLEncoder.encode(userCode, StandardCharsets.UTF_8).replace("+", "%20") + "/";
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        String base = webBaseUrl + (path.endsWith("/") ? path : path + "/");
        return StringUtils.isBlank(webToken) ? base : base + "chat?token=" + webToken;
    }
}
