package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
    private static final String PARAM_KEY_DWS_TOKEN = "DWS_TOKEN";

    private static final Pattern USER_CODE_PATTERN = Pattern.compile("authorization code:\\s*(\\S+)");
    private static final Pattern VERIFY_URL_PATTERN = Pattern.compile("(https://login\\.dingtalk\\.com/oauth2/device/verify\\.htm\\?user_code=\\S+)");

    @Autowired
    private UserPrivateParamMapper userPrivateParamMapper;

    @Autowired
    private SequenceService sequenceService;

    // 后台运行的 device flow 进程
    private final AtomicReference<Process> deviceFlowProcess = new AtomicReference<>(null);

    /**
     * 启动 Device Flow 认证（异步）
     * 启动 dws auth login --device 进程，解析初始输出获取 userCode 和 verificationUrl，
     * 进程在后台继续轮询等待用户扫码。
     * 前端拿到 URL 后 window.open() 让用户授权，然后轮询 /dws/authStatus 等成功。
     */
    public Map<String, Object> startDeviceAuth() {
        try {
            // 如果已有进程在跑，先 kill
            Process existing = deviceFlowProcess.getAndSet(null);
            if (existing != null && existing.isAlive()) {
                existing.destroyForcibly();
            }

            List<String> cmd = List.of(DWS_BIN, "auth", "login", "--device", "-y");
            log.info("[DwsAuth] starting device flow: {}", String.join(" ", cmd));

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            Process process = pb.start();
            deviceFlowProcess.set(process);

            // 读取前几行输出，提取 userCode 和 verificationUrl
            // dws 会先输出设备码信息，然后 block 轮询
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String userCode = null;
            String verificationUrl = null;

            long startTime = System.currentTimeMillis();
            StringBuilder fullOutput = new StringBuilder();

            while (System.currentTimeMillis() - startTime < 10000) {
                if (reader.ready()) {
                    String line = reader.readLine();
                    if (line == null) break;
                    fullOutput.append(line).append("\n");

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
                log.error("[DwsAuth] failed to parse device flow output: {}", fullOutput);
                process.destroyForcibly();
                deviceFlowProcess.set(null);
                return Map.of("success", false, "message", "获取设备码失败");
            }

            log.info("[DwsAuth] device flow started: userCode={}, url={}", userCode, verificationUrl);

            // 启动后台线程等待进程结束，处理授权完成/超时
            final Process bgProcess = process;
            Thread waitThread = new Thread(() -> {
                try {
                    boolean finished = bgProcess.waitFor(900, TimeUnit.SECONDS);
                    if (finished && bgProcess.exitValue() == 0) {
                        log.info("[DwsAuth] device flow completed successfully");
                        // 记录授权到 DB
                        recordAuthToDbInternal();
                    } else if (!finished) {
                        log.warn("[DwsAuth] device flow timed out (900s)");
                        bgProcess.destroyForcibly();
                    } else {
                        log.warn("[DwsAuth] device flow exited with code: {}", bgProcess.exitValue());
                    }
                } catch (InterruptedException e) {
                    log.debug("[DwsAuth] device flow wait interrupted");
                } finally {
                    deviceFlowProcess.compareAndSet(bgProcess, null);
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
            log.error("[DwsAuth] startDeviceAuth failed", e);
            return Map.of("success", false, "message", "启动设备授权失败: " + e.getMessage());
        }
    }

    /**
     * 直接用 token 登录（用于用户手动输入 token 的场景）
     */
    public boolean injectToken(String accessToken) {
        try {
            List<String> cmd = List.of(DWS_BIN, "auth", "login", "--token", accessToken, "-y", "--format", "json");
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
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
        try {
            List<String> cmd = List.of(DWS_BIN, "auth", "status", "--format", "json");
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
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
        Map<String, Object> status = getAuthStatus();
        if (Boolean.TRUE.equals(status.get("tokenValid"))) {
            return true;
        }

        log.warn("[DwsAuth] DWS token invalid/expired for user: {}, re-authorization needed via device flow", userId);
        return false;
    }

    /**
     * 检查用户是否已保存 DWS 授权记录
     */
    public Map<String, Object> checkDwsToken() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(UserPrivateParam::getUserId, userId)
               .eq(UserPrivateParam::getParamKey, PARAM_KEY_DWS_TOKEN)
               .eq(UserPrivateParam::getDeleteFlag, "0");
        UserPrivateParam param = userPrivateParamMapper.selectOne(wrapper);
        if (param == null || param.getParamValueCipher() == null) {
            return Map.of("hasToken", false);
        }
        return Map.of("hasToken", true, "savedAt", param.getUpdateTime() != null ? param.getUpdateTime().toString() : "");
    }

    /**
     * 记录授权完成到 DB（后台线程调用，无 CurrentUser 上下文）
     */
    private void recordAuthToDbInternal() {
        try {
            Map<String, Object> status = getAuthStatus();
            String expiresAt = (String) status.getOrDefault("expiresAt", "");

            String metadata = String.format("{\"expiresAt\":\"%s\",\"authorizedAt\":\"%s\"}",
                expiresAt, LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));

            // 后台线程没有用户上下文，查 DB 里最近的授权记录更新
            LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
            wrapper.eq(UserPrivateParam::getParamKey, PARAM_KEY_DWS_TOKEN)
                   .eq(UserPrivateParam::getDeleteFlag, "0")
                   .orderByDesc(UserPrivateParam::getUpdateTime)
                   .last("LIMIT 1");
            UserPrivateParam existing = userPrivateParamMapper.selectOne(wrapper);

            String cipher = Sm4Util.encrypt(metadata);
            if (existing != null) {
                existing.setParamValueCipher(cipher);
                existing.setParamValueLast4("auth");
                existing.setUpdateTime(new Date());
                userPrivateParamMapper.updateById(existing);
            }
            log.info("[DwsAuth] recorded auth to DB");
        } catch (Exception e) {
            log.error("[DwsAuth] recordAuthToDbInternal failed", e);
        }
    }

    /**
     * 记录授权完成到 DB（有用户上下文时调用）
     */
    public void recordAuthToDb() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        Map<String, Object> status = getAuthStatus();
        String expiresAt = (String) status.getOrDefault("expiresAt", "");

        String metadata = String.format("{\"expiresAt\":\"%s\",\"authorizedAt\":\"%s\"}",
            expiresAt, LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));

        saveOrUpdateParam(userId, PARAM_KEY_DWS_TOKEN, metadata);
    }

    private void saveOrUpdateParam(Long userId, String key, String value) {
        LambdaQueryWrapper<UserPrivateParam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(UserPrivateParam::getUserId, userId)
               .eq(UserPrivateParam::getParamKey, key)
               .eq(UserPrivateParam::getDeleteFlag, "0");
        UserPrivateParam existing = userPrivateParamMapper.selectOne(wrapper);

        String cipher = Sm4Util.encrypt(value);
        String last4 = value.length() > 4 ? value.substring(value.length() - 4) : value;

        if (existing != null) {
            existing.setParamValueCipher(cipher);
            existing.setParamValueLast4(last4);
            existing.setUpdateBy(userId);
            existing.setUpdateTime(new Date());
            userPrivateParamMapper.updateById(existing);
        } else {
            UserPrivateParam param = new UserPrivateParam();
            param.setParamId(sequenceService.nextVal());
            param.setUserId(userId);
            param.setParamKey(key);
            param.setParamValueCipher(cipher);
            param.setParamValueLast4(last4);
            param.setDescription("DWS CLI 钉钉授权记录");
            param.setStatus("1");
            param.setCreateBy(userId);
            param.setCreateTime(new Date());
            param.setDeleteFlag("0");
            userPrivateParamMapper.insert(param);
        }
    }
}
