package com.iwhalecloud.byai.manager.domain.devloop.service;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsCliExecution.Context;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsCliExecution.WorkspaceUnavailableException;

import lombok.extern.slf4j.Slf4j;

/**
 * DWS CLI 认证管理服务
 * 支持 Device Flow 授权，用于定时扫描任务的无人值守运行。
 *
 * 核心设计：
 * - 远程模式在用户沙箱执行 CLI，使用与 Agent 相同的凭证存储；本地模式保留后端用户工作区。
 * - 授权通过 device flow：后端启动 dws 进程获取设备码，前端浏览器打开授权URL
 * - dws 进程后台轮询等待授权完成，token 自动写入当前用户的 CLI HOME。
 * - 定时任务只需 check dws auth status 即可
 */
@Slf4j
@Service
public class DwsAuthService {

    private static final ObjectMapper MAPPER = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    /**
     * 关闭 keychain,改用 file-DEK 后端把登录态加密落到 DWS_CONFIG_DIR。
     * 这是 per-user 目录隔离生效的前提:默认 keychain 模式下 token 存系统钥匙串,DWS_CONFIG_DIR 换目录也读到同一份(全局共享)。
     * 显式设进每个 dws 子进程 env,不依赖容器全局 ENV,保证本地/各部署环境一致。
     */
    private static final String DWS_DISABLE_KEYCHAIN_KEY = "DWS_DISABLE_KEYCHAIN";
    private static final String DWS_DISABLE_KEYCHAIN_VALUE = "1";
    private static final List<String> TRANSPORT_ENVIRONMENT = List.of(
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "no_proxy", "all_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR");

    private static final Pattern USER_CODE_PATTERN = Pattern.compile("authorization code:\\s*(\\S+)");
    private static final Pattern VERIFY_URL_PATTERN = Pattern.compile("(https://login\\.dingtalk\\.com/oauth2/device/verify\\.htm\\?user_code=\\S+)");

    /** 本地文件存储根(NFS 挂载点),与会话工作区/代码变更同源;dws 配置按用户 bucket 隔离落在其下。 */
    @Value("${file.storage.local.path:${byclaw.sandbox.volume.file-root:/tmp/byclaw-storage}}")
    private String fileStorageRoot;

    /** 用户私有连接器工作区目录名,dws 配置(profiles)放到 {bucket}/by/.connector-auth/.dws/config。 */
    private static final String DWS_CONFIG_SEGMENT = "by/.connector-auth/.dws/config";

    /**
     * dws 登录态(DEK/token 密文)实际存在 $HOME/.local/share/dws-cli,dws 只认 HOME,不认 XDG_DATA_HOME/DWS_CONFIG_DIR。
     * 这才是隔离的关键:每个用户单独一份 HOME,放到 {bucket}/by/.connector-auth/.dws;共用 HOME 会导致一人授权全员"已授权"。
     */
    private static final String DWS_HOME_SEGMENT = "by/.connector-auth/.dws";

    @Autowired
    private UserBucketNamingService userBucketNamingService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private ConnectorCliRunner connectorCliRunner;

    @Autowired
    private DwsCliExecution dwsCliExecution;

    static record DeviceFlowRegistration(Long userId, ManagedProcess process) {
    }

    public enum DwsCredentialOutcome {
        COMPLETED,
        TIMEOUT,
        WORKSPACE_UNAVAILABLE,
        FAILED
    }

    public record DwsCredentialStatus(Map<String, Object> status, DwsCredentialOutcome outcome) {

        public DwsCredentialStatus {
            status = status == null ? Map.of() : Map.copyOf(status);
        }

        public static DwsCredentialStatus completed(Map<String, Object> status) {
            return new DwsCredentialStatus(status, DwsCredentialOutcome.COMPLETED);
        }

        public static DwsCredentialStatus timeout() {
            return new DwsCredentialStatus(Map.of(), DwsCredentialOutcome.TIMEOUT);
        }

        public static DwsCredentialStatus workspaceUnavailable() {
            return new DwsCredentialStatus(Map.of(), DwsCredentialOutcome.WORKSPACE_UNAVAILABLE);
        }

        public static DwsCredentialStatus failure() {
            return new DwsCredentialStatus(Map.of(), DwsCredentialOutcome.FAILED);
        }
    }

    private static final class DeviceFlowStartLock {

        private final ReentrantLock lock = new ReentrantLock();
        private final AtomicInteger users = new AtomicInteger();
    }

    // 后台运行的 device flow 进程，按授权任务隔离。
    final ConcurrentHashMap<String, DeviceFlowRegistration> deviceFlowRegistrations = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, DeviceFlowStartLock> deviceFlowStartLocks = new ConcurrentHashMap<>();

    /** 解析用户 bucket 的绝对路径根 {fileStorageRoot}/byclaw-{userCode};失败返回 null。 */
    private String resolveBucketBase(Long userId) {
        if (userId == null) {
            return null;
        }
        try {
            LoginInfo owner = loginApplicationService.getLoginInfo(userId);
            if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
                return null;
            }
            String bucket = userBucketNamingService.buildUserBucketName(owner.getUserCode());
            return Paths.get(fileStorageRoot, bucket).toString();
        }
        catch (Exception e) {
            log.warn("[DwsAuth] 解析用户 bucket 失败, userId={}", userId, e);
            return null;
        }
    }

    private String ensureDir(Path dir) {
        try {
            java.nio.file.Files.createDirectories(dir);
            return dir.toString();
        }
        catch (Exception e) {
            log.warn("[DwsAuth] 创建目录失败: {}", dir, e);
            return null;
        }
    }

    /**
     * 给 dws 子进程 env 注入用户隔离配置:关闭 keychain + 专属 HOME(登录态/DEK) + 专属 DWS_CONFIG_DIR(profiles)。
     * 关键(Linux 实测确证):dws 的 DEK/token 密文存 $HOME/.local/share/dws-cli,只认 HOME,不认 XDG_DATA_HOME/DWS_CONFIG_DIR。
     * 因此每个用户必须用独立 HOME 才能真正隔离登录态;共用 HOME 会导致一人授权全员"已授权"。
     * @return true 表示成功按用户隔离;false 表示解析不出该用户目录(调用方据此判定未授权,不冒用全局)。
     */
    public boolean applyUserDwsEnv(Map<String, String> env, Long userId) {
        // Legacy local-only API: callers must use runCommand in remote deployments.
        if (dwsCliExecution != null && dwsCliExecution.isRemote()) {
            return false;
        }
        env.put(DWS_DISABLE_KEYCHAIN_KEY, DWS_DISABLE_KEYCHAIN_VALUE);
        String base = resolveBucketBase(userId);
        if (base == null) {
            return false;
        }
        // HOME 隔离 DEK/token(核心);DWS_CONFIG_DIR 隔离 profiles(可选,一并指到用户目录保持整洁)。
        String homeDir = ensureDir(Paths.get(base, DWS_HOME_SEGMENT));
        String configDir = ensureDir(Paths.get(base, DWS_CONFIG_SEGMENT));
        if (homeDir == null || configDir == null) {
            return false;
        }
        env.put("HOME", homeDir);
        env.put("DWS_HOME", homeDir);
        env.put("DWS_CONFIG_DIR", configDir);
        log.info("[DwsAuth] applyUserDwsEnv userId={} home={} configDir={}", userId, homeDir, configDir);
        return true;
    }

    /** 字符串 userId 重载,供扫描服务用 source.createBy。 */
    public boolean applyUserDwsEnv(Map<String, String> env, String userId) {
        Long uid = null;
        if (userId != null && !userId.trim().isEmpty()) {
            try {
                uid = Long.valueOf(userId.trim());
            }
            catch (NumberFormatException e) {
                log.warn("[DwsAuth] invalid userId for applyUserDwsEnv: {}", userId);
            }
        }
        return applyUserDwsEnv(env, uid);
    }

    private Context resolveExecution(Long userId) {
        if (!isValidUserId(userId)) throw new WorkspaceUnavailableException();
        if (dwsCliExecution != null && dwsCliExecution.isRemote()) {
            return dwsCliExecution.resolve(userId);
        }
        Map<String, String> environment = new HashMap<>();
        if (!applyUserDwsEnv(environment, userId)) throw new WorkspaceUnavailableException();
        Map<String, String> isolated = localEnvironment(environment, System.getenv());
        return new Context() {
            @Override public CliResult run(List<String> command, Duration timeout, int maxOutputBytes) {
                List<String> executableCommand = resolveLocalExecutable(command, System.getenv("PATH"));
                return maxOutputBytes == DwsCliExecution.DEFAULT_MAX_OUTPUT_BYTES
                    ? connectorCliRunner.run(executableCommand, isolated, null, timeout)
                    : connectorCliRunner.run(executableCommand, isolated, null, timeout, maxOutputBytes);
            }
            @Override public ManagedProcess start(List<String> command, Duration timeout) {
                return connectorCliRunner.start(resolveLocalExecutable(command, System.getenv("PATH")), isolated, null);
            }
        };
    }

    static Map<String, String> localEnvironment(Map<String, String> isolated, Map<String, String> inherited) {
        Map<String, String> environment = new HashMap<>();
        for (String key : TRANSPORT_ENVIRONMENT) {
            String value = inherited.get(key);
            if (value != null) environment.put(key, value);
        }
        environment.putAll(isolated);
        return Map.copyOf(environment);
    }

    static List<String> resolveLocalExecutable(List<String> command, String path) {
        String executable = command.getFirst();
        if (executable.contains(File.separator) || path == null) return command;
        // Preserve the old ProcessBuilder lookup for installations such as ~/.local/bin/dws.
        // ConnectorCliRunner keeps its isolated child environment and cannot add arbitrary PATH entries.
        for (String directory : path.split(Pattern.quote(File.pathSeparator), -1)) {
            Path candidate = Paths.get(directory).resolve(executable);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                List<String> resolved = new ArrayList<>(command);
                resolved.set(0, candidate.toAbsolutePath().normalize().toString());
                return List.copyOf(resolved);
            }
        }
        return command;
    }

    /** All DWS consumers share the authorization execution location and credential workspace. */
    public CliResult runCommand(Long userId, List<String> command, Duration timeout) {
        return runCommand(userId, command, timeout, DwsCliExecution.DEFAULT_MAX_OUTPUT_BYTES);
    }

    public CliResult runCommand(String userId, List<String> command, Duration timeout) {
        return runCommand(parseUserId(userId), command, timeout);
    }

    public CliResult runCommand(Long userId, List<String> command, Duration timeout, int maxOutputBytes) {
        DwsCliExecution.validate(command, timeout, maxOutputBytes);
        return resolveExecution(userId).run(List.copyOf(command), timeout, maxOutputBytes);
    }

    public CliResult runCommand(String userId, List<String> command, Duration timeout, int maxOutputBytes) {
        return runCommand(parseUserId(userId), command, timeout, maxOutputBytes);
    }

    private Long parseUserId(String userId) {
        try {
            Long parsed = userId == null ? null : Long.valueOf(userId.trim());
            if (!isValidUserId(parsed)) throw new WorkspaceUnavailableException();
            return parsed;
        } catch (NumberFormatException e) {
            throw new WorkspaceUnavailableException();
        }
    }

    /**
     * 启动 Device Flow 认证（异步）
     * 启动 dws auth login --device 进程，解析初始输出获取 userCode 和 verificationUrl，
     * 进程在后台继续轮询等待用户扫码。
     * 前端拿到 URL 后 window.open() 让用户授权，然后轮询 /dws/authStatus 等成功。
     */
    public Map<String, Object> startDeviceAuth(List<String> command) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return startDeviceAuth(userId, legacyAuthorizationId(userId), command);
    }

    /**
     * 为指定用户和授权任务启动 Device Flow 认证。
     */
    public Map<String, Object> startDeviceAuth(Long userId, String authorizationId, List<String> command) {
        if (!isValidUserId(userId) || StringUtils.isBlank(authorizationId)) {
            return Map.of("success", false, "message", "Invalid user or authorization id");
        }

        final Long authUserId = userId;
        final String authId = authorizationId.trim();
        DeviceFlowStartLock startLock = acquireStartLock(authId);
        try {
            return startDeviceAuthLocked(authUserId, authId, List.copyOf(command));
        } finally {
            releaseStartLock(authId, startLock);
        }
    }

    private Map<String, Object> startDeviceAuthLocked(Long authUserId, String authId, List<String> command) {
        DeviceFlowRegistration existing = deviceFlowRegistrations.get(authId);
        if (existing != null) {
            try {
                if (existing.process() != null && existing.process().isAlive()) {
                    return Map.of("success", false, "message", "Authorization is already in progress");
                }
                deviceFlowRegistrations.remove(authId, existing);
            } catch (RuntimeException e) {
                log.warn("[DwsAuth] existing device flow inspection failed, authorizationId={}, userId={}, errorType={}",
                    authId, authUserId, e.getClass().getSimpleName());
                return Map.of("success", false,
                    "message", safeI18n("devloop.dws.auth.start.failed", "启动授权失败"));
            }
        }

        DeviceFlowRegistration registration = null;
        try {
            log.info("[DwsAuth] starting device flow, authorizationId={}, userId={}", authId, authUserId);
            DwsCliExecution.validate(command, Duration.ofSeconds(900), DwsCliExecution.DEFAULT_MAX_OUTPUT_BYTES);
            ManagedProcess process = resolveExecution(authUserId).start(command, Duration.ofSeconds(900));
            if (process == null) throw new IllegalStateException("Unable to start DWS authorization");
            registration = new DeviceFlowRegistration(authUserId, process);
            deviceFlowRegistrations.put(authId, registration);

            String userCode = null;
            String verificationUrl = null;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (System.nanoTime() < deadline && deviceFlowRegistrations.get(authId) == registration) {
                String output = process.output();
                if (process.outputTruncated()) break;
                boolean outputFinished = !process.isAlive() && process.outputComplete();
                // Remote output can split in the middle of a URL; preserve BufferedReader's complete-line contract.
                String completeLines = outputFinished ? output : output.substring(0, output.lastIndexOf('\n') + 1);
                Matcher codeMatcher = USER_CODE_PATTERN.matcher(completeLines);
                Matcher urlMatcher = VERIFY_URL_PATTERN.matcher(completeLines);
                if (codeMatcher.find()) userCode = codeMatcher.group(1);
                if (urlMatcher.find()) verificationUrl = urlMatcher.group(1);
                if (userCode != null && verificationUrl != null) break;
                if (outputFinished) break;
                Thread.sleep(100);
            }
            if (userCode == null || verificationUrl == null || process.outputTruncated()
                    || deviceFlowRegistrations.get(authId) != registration) {
                removeAndDestroy(authId, registration);
                return Map.of("success", false,
                    "message", safeI18n("devloop.dws.device.code.failed", "获取设备码失败"));
            }

            final DeviceFlowRegistration bgRegistration = registration;
            Thread waitThread = new Thread(() -> awaitDeviceFlow(authId, bgRegistration), "dws-device-flow-waiter");
            waitThread.setDaemon(true);
            waitThread.start();
            return Map.of("success", true, "userCode", userCode, "verificationUrl", verificationUrl);
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            removeAndDestroy(authId, registration);
            log.error("[DwsAuth] startDeviceAuth failed, authorizationId={}, userId={}, errorType={}",
                authId, authUserId, e.getClass().getSimpleName());
            return Map.of("success", false,
                "message", safeI18n("devloop.dws.auth.start.failed", "启动授权失败"));
        }
    }

    private void awaitDeviceFlow(String authId, DeviceFlowRegistration registration) {
        ManagedProcess process = registration.process();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(900);
        boolean finished = false;
        try {
            while (process.isAlive() && System.nanoTime() < deadline
                    && deviceFlowRegistrations.get(authId) == registration) {
                Thread.sleep(100);
            }
            if (process.isAlive()) {
                process.destroy();
            } else {
                log.info("[DwsAuth] device flow exited, authorizationId={}, userId={}, exitCode={}",
                    authId, registration.userId(), process.exitCode());
            }
            finished = true;
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            finished = destroyProcess(registration);
            log.warn("[DwsAuth] device flow wait ended, authorizationId={}, userId={}, errorType={}",
                authId, registration.userId(), e.getClass().getSimpleName());
        } finally {
            if (finished) deviceFlowRegistrations.remove(authId, registration);
        }
    }

    /** 取消指定授权任务，且仅允许任务所属用户取消。 */
    public boolean cancelDeviceAuth(String authorizationId, Long userId) {
        if (StringUtils.isBlank(authorizationId) || !isValidUserId(userId)) {
            return false;
        }
        String authId = authorizationId.trim();
        DeviceFlowRegistration registration = deviceFlowRegistrations.get(authId);
        if (registration == null || !userId.equals(registration.userId())) {
            return false;
        }
        if (!destroyProcess(registration)) {
            return false;
        }
        deviceFlowRegistrations.remove(authId, registration);
        return true;
    }

    /** 取消指定用户当前登记的全部 Device Flow 授权。 */
    public boolean cancelDeviceAuth(Long userId) {
        if (!isValidUserId(userId)) {
            return false;
        }
        return cancelDeviceAuth(legacyAuthorizationId(userId), userId);
    }

    private String legacyAuthorizationId(Long userId) {
        return "legacy-dws-user-" + userId;
    }

    private boolean isValidUserId(Long userId) {
        return userId != null && userId > 0;
    }

    private void removeAndDestroy(String authorizationId, DeviceFlowRegistration registration) {
        if (registration != null && destroyProcess(registration)) {
            deviceFlowRegistrations.remove(authorizationId, registration);
        }
    }

    private boolean destroyProcess(DeviceFlowRegistration registration) {
        try {
            // Termination must remain possible when the remote status endpoint is unavailable.
            if (registration != null && registration.process() != null) registration.process().destroy();
            return true;
        } catch (RuntimeException e) {
            log.warn("[DwsAuth] device flow termination failed, userId={}, errorType={}",
                registration == null ? null : registration.userId(), e.getClass().getSimpleName());
            return false;
        }
    }

    private DeviceFlowStartLock acquireStartLock(String authorizationId) {
        DeviceFlowStartLock startLock = deviceFlowStartLocks.compute(authorizationId, (key, existing) -> {
            DeviceFlowStartLock current = existing == null ? new DeviceFlowStartLock() : existing;
            current.users.incrementAndGet();
            return current;
        });
        startLock.lock.lock();
        return startLock;
    }

    private void releaseStartLock(String authorizationId, DeviceFlowStartLock startLock) {
        startLock.lock.unlock();
        deviceFlowStartLocks.computeIfPresent(authorizationId, (key, current) -> {
            if (current != startLock) {
                return current;
            }
            return current.users.decrementAndGet() == 0 ? null : current;
        });
    }

    private String safeI18n(String key, String fallback) {
        try {
            return I18nUtil.get(key);
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /**
     * 获取 dws auth 状态（包含完整认证信息）
     */
    public Map<String, Object> getAuthStatus(Long userId, List<String> command) {
        DwsCredentialStatus result = getCredentialStatus(userId, command);
        return result.outcome() == DwsCredentialOutcome.COMPLETED
            ? result.status() : Map.of("authenticated", false, "tokenValid", false);
    }

    /** Bounded, read-only status query used by connector synchronization. */
    public DwsCredentialStatus getCredentialStatus(Long userId, List<String> command) {
        try {
            CliResult result = runCommand(userId, command, Duration.ofSeconds(10));
            if (result.exitCode() == 124) {
                return DwsCredentialStatus.timeout();
            }
            if (result.exitCode() != 0 || result.truncated() || StringUtils.isBlank(result.output())) {
                return DwsCredentialStatus.failure();
            }
            JsonNode node = MAPPER.readTree(result.output());
            if (node == null || !node.isObject()) {
                return DwsCredentialStatus.failure();
            }
            Map<String, Object> status = new HashMap<>();
            status.put("authenticated", node.path("authenticated").asBoolean(false));
            status.put("tokenValid", node.path("token_valid").asBoolean(false));
            if (node.has("refresh_token_valid") && !node.get("refresh_token_valid").isNull()) {
                status.put("refreshTokenValid", node.get("refresh_token_valid").asBoolean(false));
            }
            status.put("expiresAt", node.path("expires_at").asText(""));
            status.put("refreshExpiresAt", node.path("refresh_expires_at").asText(""));
            status.put("corpId", node.path("corp_id").asText(""));
            status.put("corpName", node.path("corp_name").asText(""));
            status.put("userId", node.path("user_id").asText(""));
            status.put("userName", node.path("user_name").asText(""));
            return DwsCredentialStatus.completed(status);
        } catch (WorkspaceUnavailableException e) {
            return DwsCredentialStatus.workspaceUnavailable();
        } catch (Exception e) {
            log.warn("[DwsAuth] bounded credential status query failed, userId={}", userId, e);
            return DwsCredentialStatus.failure();
        }
    }

    /** Clears the DWS credential stored in the explicit user's isolated workspace. */
    public void revokeCredential(Long userId, List<String> command) {
        CliResult result = runCommand(userId, command, Duration.ofSeconds(30));
        if (result == null || result.exitCode() != 0 || result.truncated()) {
            throw new IllegalStateException("Unable to revoke DWS credential");
        }
    }

}
