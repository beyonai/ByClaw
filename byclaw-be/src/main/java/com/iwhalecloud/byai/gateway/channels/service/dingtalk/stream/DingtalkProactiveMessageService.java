package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk.DwsDingtalkAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 主动给钉钉用户发送单聊消息。 无论原始消息来自群聊还是单聊，统一通过 oToMessages/batchSend 私聊回复用户。
 */
@Service
public class DingtalkProactiveMessageService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkProactiveMessageService.class);

    private static final String OTO_BATCH_SEND_URL = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend";

    private static final String GET_BY_UNIONID_URL = "https://oapi.dingtalk.com/topapi/user/getbyunionid";

    private static final String GET_BY_MOBILE_URL = "https://oapi.dingtalk.com/topapi/v2/user/getbymobile";

    private static final String DEPT_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/department/listsub";

    private static final String USER_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/user/list";

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    private final ObjectMapper objectMapper;

    private final DingtalkTokenService dingtalkTokenService;

    private final DingtalkRobotConfigService dingtalkRobotConfigService;

    private final DingtalkUserService dingtalkUserService;

    private final UserService userService;

    private final com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService userExternalSystemService;

    private final DwsAuthService dwsAuthService;

    private final DwsDingtalkAuthorizationProvider dwsAuthorizationProvider;

    private final ConnectorInfoService connectorInfoService;

    private final ConnectorCliRunner connectorCliRunner;

    public DingtalkProactiveMessageService(ObjectMapper objectMapper, DingtalkTokenService dingtalkTokenService,
        DingtalkRobotConfigService dingtalkRobotConfigService, DingtalkUserService dingtalkUserService,
        UserService userService,
        com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService userExternalSystemService,
        DwsAuthService dwsAuthService, DwsDingtalkAuthorizationProvider dwsAuthorizationProvider,
        ConnectorInfoService connectorInfoService, ConnectorCliRunner connectorCliRunner) {
        this.objectMapper = objectMapper;
        this.dingtalkTokenService = dingtalkTokenService;
        this.dingtalkRobotConfigService = dingtalkRobotConfigService;
        this.dingtalkUserService = dingtalkUserService;
        this.userService = userService;
        this.userExternalSystemService = userExternalSystemService;
        this.dwsAuthService = dwsAuthService;
        this.dwsAuthorizationProvider = dwsAuthorizationProvider;
        this.connectorInfoService = connectorInfoService;
        this.connectorCliRunner = connectorCliRunner;
    }

    /**
     * 主动给用户发单聊消息。
     *
     * @param resourceId 数字员工资源 ID，用于定位 robotCode
     * @param userId 系统用户 ID，用于反查钉钉 senderStaffId
     * @param content 消息文本内容
     */
    public void sendTextToUser(Long resourceId, Long userId, String content) throws IOException {
        String robotCode = resolveRobotCode(resourceId);
        String accessToken = getAccessTokenByRobotCode(robotCode);
        String senderStaffId = resolveSenderStaffId(userId, accessToken);

        sendOtoMessage(robotCode, accessToken, senderStaffId, content);
    }

    private String resolveRobotCode(Long resourceId) {
        List<DingtalkRobotChannelConfig> configs = dingtalkRobotConfigService.getRobotConfigsByResourceId(resourceId);
        if (configs.isEmpty()) {
            throw new IllegalStateException("No DingTalk robot config found for resourceId=" + resourceId);
        }
        return configs.get(0).getRobotCode();
    }

    private String getAccessTokenByRobotCode(String robotCode) {
        DingtalkRobotChannelConfig config = dingtalkRobotConfigService.getRobotConfig(robotCode);
        String clientId = config.getClientId();
        String clientSecret = config.getClientSecret();
        if (!StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            throw new IllegalStateException("DingTalk clientId/clientSecret is empty, robotCode=" + robotCode);
        }
        // getAccessToken 第一个参数用作 cache key 的一部分，这里传 clientId 即可
        return dingtalkTokenService.getAccessToken(clientId, robotCode);
    }

    private String resolveSenderStaffId(Long userId, String accessToken) {
        // 优先通过 unionId 查找
        com.iwhalecloud.byai.manager.entity.users.UserExternalSystem externalSystem = userExternalSystemService
            .findByUserId(SourceType.DING_TALK, userId);
        if (externalSystem != null && StringUtils.hasText(externalSystem.getUnionId())) {
            String staffId = getUserIdByUnionId(accessToken, externalSystem.getUnionId());
            if (StringUtils.hasText(staffId)) {
                return staffId;
            }
            logger.info("UnionId lookup failed for userId={}, unionId={}", userId, externalSystem.getUnionId());
        }
        else {
            logger.info("No DingTalk binding found in po_user_external_system for userId={}", userId);
        }

        Users user = userService.findById(userId);
        if (user == null) {
            throw new IllegalStateException("User not found for userId=" + userId);
        }

        // fallback 1: 通过手机号查找
        if (StringUtils.hasText(user.getPhone())) {
            String phone = Sm4Util.decrypt(user.getPhone());
            logger.info("Trying mobile lookup for userId={}, phone={}", userId,
                phone != null ? phone.replaceAll("(\\d{3})\\d{4}(\\d{4})", "$1****$2") : "null");
            if (StringUtils.hasText(phone)) {
                String staffId = getUserIdByMobile(accessToken, phone);
                if (StringUtils.hasText(staffId)) {
                    saveUserExternalSystem(userId, staffId, accessToken);
                    return staffId;
                }
            }
        }
        else {
            logger.info("No phone found for userId={}", userId);
        }

        // fallback 2: 通过工号遍历部门成员匹配
        if (StringUtils.hasText(user.getUserNumber())) {
            logger.info("Trying jobNumber lookup for userId={}, userNumber={}", userId, user.getUserNumber());
            String staffId = getUserIdByJobNumber(accessToken, user.getUserNumber());
            if (StringUtils.hasText(staffId)) {
                saveUserExternalSystem(userId, staffId, accessToken);
                return staffId;
            }
        }
        else {
            logger.info("No userNumber found for userId={}", userId);
        }

        throw new IllegalStateException(
            "Cannot resolve DingTalk staffId for userId=" + userId + ", unionId/mobile/userNumber lookup all failed");
    }

    private void saveUserExternalSystem(Long userId, String staffId, String accessToken) {
        try {
            var userDetail = dingtalkUserService.getUserDetail(accessToken, staffId);
            String unionId = userDetail.getUnionid();
            if (!StringUtils.hasText(unionId)) {
                unionId = staffId;
            }
            dingtalkUserService.saveUserExternalSystem(unionId, userId, userDetail);
            logger.info("Saved DingTalk user binding. userId={}, staffId={}, unionId={}", userId, staffId, unionId);
        }
        catch (Exception e) {
            logger.warn("Failed to save DingTalk user binding. userId={}, staffId={}", userId, staffId, e);
        }
    }

    private String getUserIdByUnionId(String accessToken, String unionId) {
        Map<String, Object> body = new HashMap<>();
        body.put("unionid", unionId);

        Request request = new Request.Builder().url(GET_BY_UNIONID_URL + "?access_token=" + accessToken)
            .header("Content-Type", "application/json").post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE)).build();

        OkHttpClient okHttpClient = OkHttpUtil.getHttpClient();
        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                logger.warn("Get userId by unionId failed, httpCode={}, body={}", response.code(), responseBody);
                return null;
            }
            var root = objectMapper.readTree(responseBody);
            if (root.path("errcode").asInt(0) != 0) {
                logger.warn("Get userId by unionId failed, errcode={}, errmsg={}", root.path("errcode"),
                    root.path("errmsg"));
                return null;
            }
            return root.path("result").path("userid").asText(null);
        }
        catch (IOException e) {
            logger.warn("Request DingTalk getByUnionId failed", e);
            return null;
        }
    }

    private String getUserIdByMobile(String accessToken, String mobile) {
        Map<String, Object> body = new HashMap<>();
        body.put("mobile", mobile);

        Request request = new Request.Builder().url(GET_BY_MOBILE_URL + "?access_token=" + accessToken)
            .header("Content-Type", "application/json").post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE)).build();

        OkHttpClient okHttpClient = OkHttpUtil.getHttpClient();
        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                logger.warn("Get userId by mobile failed, httpCode={}, body={}", response.code(), responseBody);
                return null;
            }
            var root = objectMapper.readTree(responseBody);
            if (root.path("errcode").asInt(0) != 0) {
                logger.warn("Get userId by mobile failed, errcode={}, errmsg={}", root.path("errcode"),
                    root.path("errmsg"));
                return null;
            }
            return root.path("result").path("userid").asText(null);
        }
        catch (IOException e) {
            logger.warn("Request DingTalk getByMobile failed", e);
            return null;
        }
    }

    private String getUserIdByJobNumber(String accessToken, String jobNumber) {
        List<Long> deptIds = listAllDeptIds(accessToken);
        for (Long deptId : deptIds) {
            String staffId = findUserInDeptByJobNumber(accessToken, deptId, jobNumber);
            if (StringUtils.hasText(staffId)) {
                return staffId;
            }
        }
        logger.warn("Get userId by jobNumber failed, no match found. jobNumber={}", jobNumber);
        return null;
    }

    private List<Long> listAllDeptIds(String accessToken) {
        List<Long> allDeptIds = new ArrayList<>();
        collectDeptIds(accessToken, 1L, allDeptIds);
        return allDeptIds;
    }

    private void collectDeptIds(String accessToken, Long parentDeptId, List<Long> allDeptIds) {
        allDeptIds.add(parentDeptId);

        Map<String, Object> body = new HashMap<>();
        body.put("dept_id", parentDeptId);

        Request request = new Request.Builder().url(DEPT_LIST_URL + "?access_token=" + accessToken)
            .header("Content-Type", "application/json").post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE)).build();

        OkHttpClient okHttpClient = OkHttpUtil.getHttpClient();
        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                return;
            }
            var root = objectMapper.readTree(responseBody);
            if (root.path("errcode").asInt(0) != 0) {
                return;
            }
            var resultList = root.path("result");
            if (resultList.isArray()) {
                for (var dept : resultList) {
                    long subDeptId = dept.path("dept_id").asLong(0);
                    if (subDeptId > 0) {
                        collectDeptIds(accessToken, subDeptId, allDeptIds);
                    }
                }
            }
        }
        catch (IOException e) {
            logger.warn("List DingTalk sub departments failed, parentDeptId={}", parentDeptId, e);
        }
    }

    private String findUserInDeptByJobNumber(String accessToken, Long deptId, String jobNumber) {
        long cursor = 0;
        int size = 100;
        boolean hasMore = true;

        while (hasMore) {
            Map<String, Object> body = new HashMap<>();
            body.put("dept_id", deptId);
            body.put("cursor", cursor);
            body.put("size", size);

            Request request = new Request.Builder().url(USER_LIST_URL + "?access_token=" + accessToken)
                .header("Content-Type", "application/json").post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE))
                .build();

            OkHttpClient okHttpClient = OkHttpUtil.getHttpClient();
            try (Response response = okHttpClient.newCall(request).execute()) {
                String responseBody = response.body() == null ? "" : response.body().string();
                if (!response.isSuccessful()) {
                    return null;
                }
                var root = objectMapper.readTree(responseBody);
                if (root.path("errcode").asInt(0) != 0) {
                    return null;
                }
                var result = root.path("result");
                hasMore = result.path("has_more").asBoolean(false);
                cursor = result.path("next_cursor").asLong(0);

                var userList = result.path("list");
                if (userList.isArray()) {
                    for (var userNode : userList) {
                        String nodeJobNumber = userNode.path("job_number").asText(null);
                        if (jobNumber.equals(nodeJobNumber)) {
                            return userNode.path("userid").asText(null);
                        }
                    }
                }
            }
            catch (IOException e) {
                logger.warn("List DingTalk dept users failed, deptId={}", deptId, e);
                return null;
            }
        }
        return null;
    }

    private void sendOtoMessage(String robotCode, String accessToken, String senderStaffId, String content)
        throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("robotCode", robotCode);
        body.put("userIds", List.of(senderStaffId));
        body.put("msgKey", "sampleMarkdown");
        body.put("msgParam", toJson(Map.ofEntries(Map.entry("title", I18nUtil.get("dingtalk.proactive.message.title")),
            Map.entry("text", content))));

        Request request = new Request.Builder().url(OTO_BATCH_SEND_URL)
            .header("x-acs-dingtalk-access-token", accessToken).header("Content-Type", "application/json")
            .post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE)).build();

        OkHttpClient okHttpClient = OkHttpUtil.getHttpClient();
        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                logger.error("Proactive oTo message send failed. robotCode={}, userId={}, code={}, body={}", robotCode,
                    senderStaffId, response.code(), responseBody);
                throw new IOException("DingTalk oToMessages API returned " + response.code() + ": " + responseBody);
            }
            logger.info("Proactive oTo message sent. robotCode={}, userId={}, response={}", robotCode, senderStaffId,
                responseBody);
        }
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        }
        catch (JsonProcessingException e) {
            throw new IllegalArgumentException("JSON serialization failed", e);
        }
    }

    /**
     * 通过 dws 给 ByClaw 用户发钉钉单聊消息。
     *
     * @param senderUserId 发送人(执行 skill 的用户),用他的 dws 授权执行命令
     * @param receiverUserId 接收人(ByClaw userId),自动映射为钉钉 staffId
     * @param content 消息内容(Markdown 格式)
     * @throws IllegalStateException 发送人未授权钉钉连接器,或接收人无法映射为钉钉用户
     */
    public void sendUserToUserViaDws(Long senderUserId, Long receiverUserId, String content) {
        // 1. 校验发送人是否已授权钉钉连接器
        ConnectorInfo dingtalkConnector = connectorInfoService.findByCode("dingtalk");
        if (dingtalkConnector == null) {
            throw new IllegalStateException("钉钉连接器未配置");
        }

        AuthorizationStatusResult authStatus = dwsAuthorizationProvider.verify(senderUserId, dingtalkConnector);
        if (authStatus.status() != AuthorizationStatus.CONNECTED) {
            throw new IllegalStateException(
                "发送人未授权钉钉连接器，请先完成 dws auth login。userId=" + senderUserId);
        }

        // 2. 映射接收人: ByClaw userId → 钉钉 staffId (用发送人的 dws 环境查询)
        String receiverStaffId = resolveStaffIdViaDws(senderUserId, receiverUserId);

        // 3. 发送消息 (用发送人的 dws 环境执行)
        sendMessageViaDws(senderUserId, receiverStaffId, content);
    }

    /**
     * 通过 dws 命令映射 ByClaw userId 到钉钉 staffId。
     * 优先使用手机号匹配,fallback 到工号匹配。
     */
    private String resolveStaffIdViaDws(Long senderUserId, Long receiverUserId) {
        Users receiver = userService.findById(receiverUserId);
        if (receiver == null) {
            throw new IllegalStateException("接收人不存在: userId=" + receiverUserId);
        }

        // 准备 dws 环境 (用发送人的授权)
        Map<String, String> dwsEnv = new HashMap<>();
        if (!dwsAuthService.applyUserDwsEnv(dwsEnv, senderUserId)) {
            throw new IllegalStateException("无法初始化 dws 环境: senderUserId=" + senderUserId);
        }

        // 方式1: 通过手机号查询 (首选)
        if (StringUtils.hasText(receiver.getPhone())) {
            try {
                String phone = Sm4Util.decrypt(receiver.getPhone());
                logger.info("【调试】解密手机号: receiverUserId={}, encrypted={}, decrypted={}****",
                    receiverUserId, receiver.getPhone(),
                    phone != null ? phone.substring(0, Math.min(3, phone.length())) : "null");

                if (StringUtils.hasText(phone)) {
                    logger.info("尝试通过手机号查询钉钉 staffId: receiverUserId={}, phone={}****", receiverUserId,
                        phone.substring(0, Math.min(3, phone.length())));

                    String staffId = queryStaffIdByPhone(dwsEnv, phone);
                    if (StringUtils.hasText(staffId)) {
                        logger.info("通过手机号成功映射: userId={} → staffId={}", receiverUserId, staffId);
                        return staffId;
                    }
                }
            }
            catch (Exception e) {
                logger.warn("手机号查询失败: receiverUserId={}", receiverUserId, e);
            }
        }
        else {
            logger.warn("【调试】接收人没有手机号: receiverUserId={}", receiverUserId);
        }

        // 方式2: 通过工号查询 (fallback)
        if (StringUtils.hasText(receiver.getUserNumber())) {
            logger.info("尝试通过工号查询钉钉 staffId: receiverUserId={}, userNumber={}", receiverUserId,
                receiver.getUserNumber());

            String staffId = queryStaffIdByJobNumber(dwsEnv, receiver.getUserNumber());
            if (StringUtils.hasText(staffId)) {
                logger.info("通过工号成功映射: userId={} → staffId={}", receiverUserId, staffId);
                return staffId;
            }
        }

        throw new IllegalStateException(
            "无法将接收人映射为钉钉用户，手机号和工号查询均失败: userId=" + receiverUserId);
    }

    /**
     * 通过 dws contact user search-mobile 查询钉钉 staffId。
     */
    private String queryStaffIdByPhone(Map<String, String> dwsEnv, String phone) {
        List<String> command = List.of("dws", "contact", "user", "search-mobile", "--mobile", phone, "--format", "json");

        // 调试日志：打印环境变量
        logger.info("【调试】dws 环境变量: HOME={}, DWS_CONFIG_DIR={}",
            dwsEnv.get("HOME"), dwsEnv.get("DWS_CONFIG_DIR"));
        logger.info("【调试】执行命令: {}", String.join(" ", command));

        try {
            ConnectorCliRunner.CliResult result = connectorCliRunner.run(command, dwsEnv, null, java.time.Duration.ofSeconds(10));

            // 调试日志：打印完整输出
            logger.info("【调试】dws 命令执行结果: exitCode={}, output={}, truncated={}",
                result.exitCode(), result.output(), result.truncated());

            if (result.exitCode() != 0) {
                logger.warn("dws contact user search-mobile 命令执行失败: exitCode={}, output={}", result.exitCode(),
                    result.output());
                return null;
            }

            // 解析 JSON: dws 可能返回包装对象或数组
            var root = objectMapper.readTree(result.output());
            logger.info("【调试】解析后的 JSON 节点类型: {}, 内容键数: {}",
                root.getNodeType(), root.isObject() ? root.size() : "N/A");

            // 格式1: {"success": true, "result": {"userId": "xxx", ...}}
            if (root.isObject() && root.path("success").asBoolean(false)) {
                String userId = root.path("result").path("userId").asText(null);
                logger.info("【调试】从包装对象提取的 userId: {}", userId);
                if (StringUtils.hasText(userId)) {
                    return userId;
                }
            }

            // 格式2: [{"userId": "xxx", ...}]
            if (root.isArray() && !root.isEmpty()) {
                String userId = root.get(0).path("userId").asText(null);
                logger.info("【调试】从数组提取的 userId: {}", userId);
                if (StringUtils.hasText(userId)) {
                    return userId;
                }
            }

            logger.warn("dws contact user search-mobile 未返回有效结果: phone={}****, output={}", phone.substring(0, 3),
                result.output());
            return null;
        }
        catch (Exception e) {
            logger.warn("dws contact user search-mobile 执行异常", e);
            return null;
        }
    }
    /**
     * 通过 dws aisearch person 查询钉钉 staffId (注意: dimension=jobNumber 返回的是 userId,非实际工号)。
     */
    private String queryStaffIdByJobNumber(Map<String, String> dwsEnv, String jobNumber) {
        List<String> command = List.of("dws", "aisearch", "person", "--keyword", jobNumber, "--dimension", "jobNumber",
            "--format", "json");

        try {
            ConnectorCliRunner.CliResult result = connectorCliRunner.run(command, dwsEnv, null, java.time.Duration.ofSeconds(10));

            if (result.exitCode() != 0) {
                logger.warn("dws aisearch person 命令执行失败: exitCode={}, output={}", result.exitCode(), result.output());
                return null;
            }

            // 解析 JSON: dws 可能返回包装对象或数组
            var root = objectMapper.readTree(result.output());

            // 格式1: {"success": true, "result": {"userId": "xxx", ...}}
            if (root.isObject() && root.path("success").asBoolean(false)) {
                String userId = root.path("result").path("userId").asText(null);
                if (StringUtils.hasText(userId)) {
                    logger.info("dws aisearch 从包装对象返回 staffId: {}", userId);
                    return userId;
                }
            }

            // 格式2: [{"meta": {"jobNumber": "xxx"}, ...}]
            // 注意: meta.jobNumber 实际是钉钉 userId/staffId,不是真实工号
            if (root.isArray() && !root.isEmpty()) {
                String staffId = root.get(0).path("meta").path("jobNumber").asText(null);
                if (StringUtils.hasText(staffId)) {
                    logger.info("dws aisearch 从数组返回 staffId: {} (注意此字段名为 jobNumber 但实为 staffId)", staffId);
                    return staffId;
                }
            }

            logger.warn("dws aisearch person 未返回有效结果: jobNumber={}, output={}", jobNumber, result.output());
            return null;
        }
        catch (Exception e) {
            logger.warn("dws aisearch person 执行异常", e);
            return null;
        }
    }

    /**
     * 通过 dws chat message send 发送单聊消息。
     */
    private void sendMessageViaDws(Long senderUserId, String receiverStaffId, String content) {
        List<String> command = List.of("dws", "chat", "message", "send", "--users", receiverStaffId, "--content",
            content, "--format", "json");

        Map<String, String> dwsEnv = new HashMap<>();
        if (!dwsAuthService.applyUserDwsEnv(dwsEnv, senderUserId)) {
            throw new IllegalStateException("无法初始化 dws 环境: senderUserId=" + senderUserId);
        }

        try {
            ConnectorCliRunner.CliResult result = connectorCliRunner.run(command, dwsEnv, null, java.time.Duration.ofSeconds(15));

            if (result.exitCode() != 0) {
                logger.error("dws chat message send 命令执行失败: exitCode={}, output={}", result.exitCode(),
                    result.output());
                throw new IllegalStateException(
                    "钉钉消息发送失败: exitCode=" + result.exitCode() + ", output=" + result.output());
            }

            logger.info("钉钉消息发送成功: senderUserId={}, receiverStaffId={}, output={}", senderUserId, receiverStaffId,
                result.output());
        }
        catch (IllegalStateException e) {
            throw e;
        }
        catch (Exception e) {
            logger.error("dws chat message send 执行异常", e);
            throw new IllegalStateException("钉钉消息发送异常: " + e.getMessage(), e);
        }
    }
}
