package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
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
import java.util.concurrent.TimeUnit;

/**
 * 主动给钉钉用户发送单聊消息。
 * 无论原始消息来自群聊还是单聊，统一通过 oToMessages/batchSend 私聊回复用户。
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
    private final OkHttpClient okHttpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build();

    public DingtalkProactiveMessageService(
            ObjectMapper objectMapper,
            DingtalkTokenService dingtalkTokenService,
            DingtalkRobotConfigService dingtalkRobotConfigService,
            DingtalkUserService dingtalkUserService,
            UserService userService,
            com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService userExternalSystemService
    ) {
        this.objectMapper = objectMapper;
        this.dingtalkTokenService = dingtalkTokenService;
        this.dingtalkRobotConfigService = dingtalkRobotConfigService;
        this.dingtalkUserService = dingtalkUserService;
        this.userService = userService;
        this.userExternalSystemService = userExternalSystemService;
    }

    /**
     * 主动给用户发单聊消息。
     *
     * @param resourceId 数字员工资源 ID，用于定位 robotCode
     * @param userId     系统用户 ID，用于反查钉钉 senderStaffId
     * @param content    消息文本内容
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
        com.iwhalecloud.byai.manager.entity.users.UserExternalSystem externalSystem =
                userExternalSystemService.findByUserId(SourceType.DING_TALK, userId);
        if (externalSystem != null && StringUtils.hasText(externalSystem.getUnionId())) {
            String staffId = getUserIdByUnionId(accessToken, externalSystem.getUnionId());
            if (StringUtils.hasText(staffId)) {
                return staffId;
            }
            logger.info("UnionId lookup failed for userId={}, unionId={}", userId, externalSystem.getUnionId());
        } else {
            logger.info("No DingTalk binding found in po_user_external_system for userId={}", userId);
        }

        Users user = userService.findById(userId);
        if (user == null) {
            throw new IllegalStateException("User not found for userId=" + userId);
        }

        // fallback 1: 通过手机号查找
        if (StringUtils.hasText(user.getPhone())) {
            String phone = Sm4Util.decrypt(user.getPhone());
            logger.info("Trying mobile lookup for userId={}, phone={}", userId, phone != null ? phone.replaceAll("(\\d{3})\\d{4}(\\d{4})", "$1****$2") : "null");
            if (StringUtils.hasText(phone)) {
                String staffId = getUserIdByMobile(accessToken, phone);
                if (StringUtils.hasText(staffId)) {
                    saveUserExternalSystem(userId, staffId, accessToken);
                    return staffId;
                }
            }
        } else {
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
        } else {
            logger.info("No userNumber found for userId={}", userId);
        }

        throw new IllegalStateException("Cannot resolve DingTalk staffId for userId=" + userId
                + ", unionId/mobile/userNumber lookup all failed");
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
        } catch (Exception e) {
            logger.warn("Failed to save DingTalk user binding. userId={}, staffId={}", userId, staffId, e);
        }
    }

    private String getUserIdByUnionId(String accessToken, String unionId) {
        Map<String, Object> body = new HashMap<>();
        body.put("unionid", unionId);

        Request request = new Request.Builder()
                .url(GET_BY_UNIONID_URL + "?access_token=" + accessToken)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE))
                .build();

        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                logger.warn("Get userId by unionId failed, httpCode={}, body={}", response.code(), responseBody);
                return null;
            }
            var root = objectMapper.readTree(responseBody);
            if (root.path("errcode").asInt(0) != 0) {
                logger.warn("Get userId by unionId failed, errcode={}, errmsg={}", root.path("errcode"), root.path("errmsg"));
                return null;
            }
            return root.path("result").path("userid").asText(null);
        } catch (IOException e) {
            logger.warn("Request DingTalk getByUnionId failed", e);
            return null;
        }
    }

    private String getUserIdByMobile(String accessToken, String mobile) {
        Map<String, Object> body = new HashMap<>();
        body.put("mobile", mobile);

        Request request = new Request.Builder()
                .url(GET_BY_MOBILE_URL + "?access_token=" + accessToken)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE))
                .build();

        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                logger.warn("Get userId by mobile failed, httpCode={}, body={}", response.code(), responseBody);
                return null;
            }
            var root = objectMapper.readTree(responseBody);
            if (root.path("errcode").asInt(0) != 0) {
                logger.warn("Get userId by mobile failed, errcode={}, errmsg={}", root.path("errcode"), root.path("errmsg"));
                return null;
            }
            return root.path("result").path("userid").asText(null);
        } catch (IOException e) {
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

        Request request = new Request.Builder()
                .url(DEPT_LIST_URL + "?access_token=" + accessToken)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE))
                .build();

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
        } catch (IOException e) {
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

            Request request = new Request.Builder()
                    .url(USER_LIST_URL + "?access_token=" + accessToken)
                    .header("Content-Type", "application/json")
                    .post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE))
                    .build();

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
            } catch (IOException e) {
                logger.warn("List DingTalk dept users failed, deptId={}", deptId, e);
                return null;
            }
        }
        return null;
    }

    private void sendOtoMessage(String robotCode, String accessToken, String senderStaffId, String content) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("robotCode", robotCode);
        body.put("userIds", List.of(senderStaffId));
        body.put("msgKey", "sampleMarkdown");
        body.put("msgParam", toJson(Map.ofEntries(
            Map.entry("title", I18nUtil.get("dingtalk.proactive.message.title")),
            Map.entry("text", content)
        )));

        Request request = new Request.Builder()
                .url(OTO_BATCH_SEND_URL)
                .header("x-acs-dingtalk-access-token", accessToken)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(toJson(body), JSON_MEDIA_TYPE))
                .build();

        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                logger.error("Proactive oTo message send failed. robotCode={}, userId={}, code={}, body={}",
                        robotCode, senderStaffId, response.code(), responseBody);
                throw new IOException("DingTalk oToMessages API returned " + response.code() + ": " + responseBody);
            }
            logger.info("Proactive oTo message sent. robotCode={}, userId={}, response={}", robotCode, senderStaffId, responseBody);
        }
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("JSON serialization failed", e);
        }
    }
}
