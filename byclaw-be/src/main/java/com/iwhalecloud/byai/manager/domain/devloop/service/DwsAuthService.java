package com.iwhalecloud.byai.manager.domain.devloop.service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.nio.file.Paths;
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
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;

import lombok.extern.slf4j.Slf4j;

/**
 * DWS CLI 认证管理服务
 * 支持 Device Flow 授权，用于定时扫描任务的无人值守运行。
 *
 * 核心设计：
 * - dws CLI 运行在后端容器，token 由 dws 自身持久化（macOS Keychain / Linux 文件）
 * - 授权通过 device flow：后端启动 dws 进程获取设备码，前端浏览器打开授权URL
 * - 后端 dws 进程后台轮询等待授权完成，token 自动写入后端本地
 * - 定时任务只需 check dws auth status 即可
 */
@Slf4j
@Service
public class DwsAuthService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String DWS_BIN = "dws";
    /**
     * 关闭 keychain,改用 file-DEK 后端把登录态加密落到 DWS_CONFIG_DIR。
     * 这是 per-user 目录隔离生效的前提:默认 keychain 模式下 token 存系统钥匙串,DWS_CONFIG_DIR 换目录也读到同一份(全局共享)。
     * 显式设进每个 dws 子进程 env,不依赖容器全局 ENV,保证本地/各部署环境一致。
     */
    private static final String DWS_DISABLE_KEYCHAIN_KEY = "DWS_DISABLE_KEYCHAIN";
    private static final String DWS_DISABLE_KEYCHAIN_VALUE = "1";

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

    @FunctionalInterface
    interface DwsProcessLauncher {

        Process start(ProcessBuilder builder) throws IOException;
    }

    static record DeviceFlowRegistration(Long userId, Process process) {
    }

    private static final class DeviceFlowStartLock {

        private final ReentrantLock lock = new ReentrantLock();
        private final AtomicInteger users = new AtomicInteger();
    }

    private final DwsProcessLauncher processLauncher;

    // 后台运行的 device flow 进程，按授权任务隔离。
    final ConcurrentHashMap<String, DeviceFlowRegistration> deviceFlowRegistrations = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, DeviceFlowStartLock> deviceFlowStartLocks = new ConcurrentHashMap<>();

    public DwsAuthService() {
        this(ProcessBuilder::start);
    }

    DwsAuthService(DwsProcessLauncher processLauncher) {
        this.processLauncher = processLauncher;
    }

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

    /**
     * 构造 dws 子进程:按用户注入隔离 env(禁 keychain + 专属 HOME + DWS_CONFIG_DIR)。
     * 用于授权动作(startDeviceAuth/injectToken):由当前登录用户发起。
     */
    private ProcessBuilder newDwsProcess(Long userId, List<String> cmd) {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        if (!applyUserDwsEnv(pb.environment(), userId)) {
            throw new IllegalStateException("Unable to isolate DWS environment for userId=" + userId);
        }
        return pb;
    }

    /**
     * 启动 Device Flow 认证（异步）
     * 启动 dws auth login --device 进程，解析初始输出获取 userCode 和 verificationUrl，
     * 进程在后台继续轮询等待用户扫码。
     * 前端拿到 URL 后 window.open() 让用户授权，然后轮询 /dws/authStatus 等成功。
     */
    public Map<String, Object> startDeviceAuth() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return startDeviceAuth(userId, legacyAuthorizationId(userId));
    }

    /**
     * 为指定用户和授权任务启动 Device Flow 认证。
     */
    public Map<String, Object> startDeviceAuth(Long userId, String authorizationId) {
        if (!isValidUserId(userId) || StringUtils.isBlank(authorizationId)) {
            return Map.of("success", false, "message", "Invalid user or authorization id");
        }

        final Long authUserId = userId;
        final String authId = authorizationId.trim();
        DeviceFlowStartLock startLock = acquireStartLock(authId);
        try {
            return startDeviceAuthLocked(authUserId, authId);
        } finally {
            releaseStartLock(authId, startLock);
        }
    }

    private Map<String, Object> startDeviceAuthLocked(Long authUserId, String authId) {
        DeviceFlowRegistration existing = deviceFlowRegistrations.get(authId);
        if (existing != null && existing.process() != null && existing.process().isAlive()) {
            return Map.of("success", false, "message", "Authorization is already in progress");
        }
        if (existing != null) {
            deviceFlowRegistrations.remove(authId, existing);
        }

        DeviceFlowRegistration registration = null;
        BufferedReader reader = null;
        boolean drainStarted = false;
        try {
            List<String> cmd = List.of(
                DWS_BIN, "auth", "login", "--device", "--no-browser", "--recommend", "-y");
            log.info("[DwsAuth] starting device flow, authorizationId={}, userId={}", authId, authUserId);

            ProcessBuilder pb = newDwsProcess(authUserId, cmd);
            Process process = processLauncher.start(pb);
            registration = new DeviceFlowRegistration(authUserId, process);
            deviceFlowRegistrations.put(authId, registration);

            // 读取前几行输出，提取 userCode 和 verificationUrl
            // dws 会先输出设备码信息，然后 block 轮询
            reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String userCode = null;
            String verificationUrl = null;

            long startTime = System.currentTimeMillis();

            while (System.currentTimeMillis() - startTime < 10000) {
                if (reader.ready()) {
                    String line = reader.readLine();
                    if (line == null) break;

                    // 解析 authorization code
                    Matcher codeMatcher = USER_CODE_PATTERN.matcher(line);
                    if (codeMatcher.find()) {
                        userCode = codeMatcher.group(1);
                    }

                    // 解析完整 URL
                    Matcher urlMatcher = VERIFY_URL_PATTERN.matcher(line);
                    if (urlMatcher.find()) {
                        verificationUrl = urlMatcher.group(1);
                    }

                    // 拿到两个值后就可以返回了，进程继续后台轮询
                    if (userCode != null && verificationUrl != null) {
                        break;
                    }
                } else {
                    Thread.sleep(100);
                }
            }

            if (userCode == null || verificationUrl == null) {
                log.error("[DwsAuth] failed to parse device flow output, authorizationId={}, userId={}",
                    authId, authUserId);
                removeAndDestroy(authId, registration);
                closeReader(reader, authId, authUserId);
                return Map.of("success", false,
                    "message", safeI18n("devloop.dws.device.code.failed", "获取设备码失败"));
            }

            log.info("[DwsAuth] device flow started, authorizationId={}, userId={}", authId, authUserId);
            startOutputDrain(reader, authId, authUserId);
            drainStarted = true;

            // 启动后台线程等待进程结束，处理授权完成/超时
            final DeviceFlowRegistration bgRegistration = registration;
            final Process bgProcess = bgRegistration.process();
            Thread waitThread = new Thread(() -> {
                try {
                    boolean finished = bgProcess.waitFor(900, TimeUnit.SECONDS);
                    if (finished && bgProcess.exitValue() == 0) {
                        log.info("[DwsAuth] device flow completed successfully, authorizationId={}, userId={}",
                            authId, authUserId);
                    } else if (!finished) {
                        log.warn("[DwsAuth] device flow timed out (900s), authorizationId={}, userId={}",
                            authId, authUserId);
                        bgProcess.destroyForcibly();
                    } else {
                        log.warn("[DwsAuth] device flow exited, authorizationId={}, userId={}, exitCode={}",
                            authId, authUserId, bgProcess.exitValue());
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    log.debug("[DwsAuth] device flow wait interrupted, authorizationId={}, userId={}",
                        authId, authUserId);
                } finally {
                    deviceFlowRegistrations.remove(authId, bgRegistration);
                }
            }, "dws-device-flow-waiter");
            waitThread.setDaemon(true);
            waitThread.start();

            return Map.of(
                "success", true,
                "userCode", userCode,
                "verificationUrl", verificationUrl
            );
        } catch (Exception e) {
            removeAndDestroy(authId, registration);
            if (!drainStarted) {
                closeReader(reader, authId, authUserId);
            }
            log.error("[DwsAuth] startDeviceAuth failed, authorizationId={}, userId={}, errorType={}",
                authId, authUserId, e.getClass().getSimpleName());
            return Map.of("success", false,
                "message", safeI18n("devloop.dws.auth.start.failed", "启动授权失败"));
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
        if (!deviceFlowRegistrations.remove(authId, registration)) {
            return false;
        }
        destroyIfAlive(registration);
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
        if (registration != null) {
            deviceFlowRegistrations.remove(authorizationId, registration);
            destroyIfAlive(registration);
        }
    }

    private void destroyIfAlive(DeviceFlowRegistration registration) {
        if (registration != null && registration.process() != null && registration.process().isAlive()) {
            registration.process().destroyForcibly();
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

    private void startOutputDrain(BufferedReader reader, String authorizationId, Long userId) {
        Thread drainThread = new Thread(() -> {
            try (BufferedReader ownedReader = reader) {
                while (ownedReader.readLine() != null) {
                    // Drain without retaining or logging device-flow output.
                }
            } catch (IOException e) {
                log.debug("[DwsAuth] device flow output drain ended, authorizationId={}, userId={}, errorType={}",
                    authorizationId, userId, e.getClass().getSimpleName());
            }
        }, "dws-device-flow-output-drain");
        drainThread.setDaemon(true);
        drainThread.start();
    }

    private void closeReader(BufferedReader reader, String authorizationId, Long userId) {
        if (reader == null) {
            return;
        }
        try {
            reader.close();
        } catch (IOException e) {
            log.debug("[DwsAuth] device flow reader close failed, authorizationId={}, userId={}, errorType={}",
                authorizationId, userId, e.getClass().getSimpleName());
        }
    }

    private String safeI18n(String key, String fallback) {
        try {
            return I18nUtil.get(key);
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /**
     * 直接用 token 登录（用于用户手动输入 token 的场景）
     */
    public boolean injectToken(String accessToken) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        try {
            List<String> cmd = List.of(DWS_BIN, "auth", "login", "--token", accessToken, "-y", "--format", "json");
            ProcessBuilder pb = newDwsProcess(userId, cmd);
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line);
                }
            }

            boolean finished = process.waitFor(15, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                return false;
            }

            log.debug("[DwsAuth] injectToken result: exitCode={}", process.exitValue());
            return process.exitValue() == 0;
        } catch (Exception e) {
            log.error("[DwsAuth] injectToken failed", e);
            return false;
        }
    }

    /**
     * 获取 dws auth 状态（包含完整认证信息）
     */
    public Map<String, Object> getAuthStatus() {
        return getAuthStatus(CurrentUserHolder.getCurrentUserId());
    }

    /**
     * 查询指定用户的 dws 授权状态:严格用该用户 bucket 下的 DWS_CONFIG_DIR。
     * 关键:解析不出该用户专属目录时,直接判定未授权,【绝不回退全局 ~/.dws】——
     * 否则会读到别人授权过的 token,误报该用户"已授权"(如非创建者看别人的源)。
     */
    public Map<String, Object> getAuthStatus(Long userId) {
        try {
            List<String> cmd = List.of(DWS_BIN, "auth", "status", "--format", "json");
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            // 严格按用户隔离(禁 keychain + 专属 HOME + DWS_CONFIG_DIR);解析不出该用户目录则判未授权,绝不冒用全局。
            if (!applyUserDwsEnv(pb.environment(), userId)) {
                log.info("[DwsAuth] 无法解析用户 {} 的 dws 隔离目录,判定未授权", userId);
                return Map.of("authenticated", false, "tokenValid", false);
            }
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line);
                }
            }

            process.waitFor(10, TimeUnit.SECONDS);
            JsonNode node = MAPPER.readTree(output.toString());

            Map<String, Object> result = new HashMap<>();
            result.put("authenticated", node.path("authenticated").asBoolean(false));
            result.put("tokenValid", node.path("token_valid").asBoolean(false));
            result.put("refreshTokenValid", node.path("refresh_token_valid").asBoolean(false));
            result.put("expiresAt", node.path("expires_at").asText(""));
            result.put("refreshExpiresAt", node.path("refresh_expires_at").asText(""));
            result.put("corpId", node.path("corp_id").asText(""));
            result.put("corpName", node.path("corp_name").asText(""));
            result.put("userId", node.path("user_id").asText(""));
            result.put("userName", node.path("user_name").asText(""));
            return result;
        } catch (Exception e) {
            log.error("[DwsAuth] getAuthStatus failed", e);
            return Map.of("authenticated", false, "tokenValid", false);
        }
    }

    /**
     * 确保 dws 已认证（定时任务调用前先调用此方法）
     * dws 自身管理 token 持久化和自动刷新，这里只检查状态。
     * 如果 token 失效（refresh_token 过期），返回 false，需要用户重新走 device flow。
     */
    public boolean ensureAuthenticated(String userId) {
        // 按需求来源创建者查其专属 dws 目录的授权状态,不再共用全局。
        Long uid = null;
        try {
            uid = userId != null ? Long.valueOf(userId) : null;
        }
        catch (NumberFormatException e) {
            log.warn("[DwsAuth] invalid userId for ensureAuthenticated: {}", userId);
        }
        Map<String, Object> status = getAuthStatus(uid);
        if (Boolean.TRUE.equals(status.get("tokenValid"))) {
            return true;
        }

        log.warn("[DwsAuth] DWS token invalid/expired for user: {}, re-authorization needed via device flow", userId);
        return false;
    }

    /**
     * 兼容旧 Service 调用：hasToken 表示用户 native-home 当前存在 DWS 认证状态，savedAt 保留为空字符串。
     * 凭证只由 dws 写入用户 native-home，不再读取或生成 DWS_TOKEN 数据库记录。
     */
    public Map<String, Object> checkDwsToken() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        Map<String, Object> runtimeStatus = getAuthStatus(userId);
        boolean hasToken = Boolean.TRUE.equals(runtimeStatus.get("authenticated"));
        return Map.of("hasToken", hasToken, "savedAt", "");
    }
}
