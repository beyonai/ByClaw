package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.api.DefaultDingTalkClient;
import com.dingtalk.api.DingTalkClient;
import com.dingtalk.api.request.OapiGettokenRequest;
import com.dingtalk.api.request.OapiV2UserGetRequest;
import com.dingtalk.api.response.OapiGettokenResponse;
import com.dingtalk.api.response.OapiV2UserGetResponse;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.taobao.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 钉钉开放平台服务，负责封装用户详情等开放接口调用。
 */
@Service
public class DingtalkOpenApiService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkOpenApiService.class);
    private static final String GET_TOKEN_URL = "https://oapi.dingtalk.com/gettoken";
    private static final String USER_GET_URL = "https://oapi.dingtalk.com/topapi/v2/user/get";
    private static final String DEFAULT_LANGUAGE = "zh_CN";
    private static final long ACCESS_TOKEN_EXPIRE_MINUTES = 119L;
    private static final String DING_TALK_CHANNEL = "DingTalk";
    private static final String ACCESS_TOKEN_CACHE_KEY_PREFIX = "dingtalk:access_token:";

    private final ObjectMapper objectMapper;
    private final Map<String, DingtalkRobotChannelConfig> robotConfigCache = new ConcurrentHashMap<>();

    public DingtalkOpenApiService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 刷新机器人配置缓存。
     * 从数字员工列表中解析 machineChannel，提取 channel = DingTalk 的配置，
     * 并按 robotCode 构建内存缓存。
     *
     * @param digitalEmployees 数字员工列表
     * @return 解析成功并缓存后的钉钉机器人配置列表
     */
    public List<DingtalkRobotChannelConfig> refreshRobotConfigs(List<ResourceExtDigEmployeeDto> digitalEmployees) {
        robotConfigCache.clear();
        if (digitalEmployees == null || digitalEmployees.isEmpty()) {
            return Collections.emptyList();
        }

        List<DingtalkRobotChannelConfig> configs = new ArrayList<>();
        for (ResourceExtDigEmployeeDto digitalEmployee : digitalEmployees) {
            configs.addAll(parseRobotConfigs(digitalEmployee));
        }
        for (DingtalkRobotChannelConfig config : configs) {
            DingtalkRobotChannelConfig previous = robotConfigCache.put(config.getRobotCode(), config);
            if (previous != null) {
                logger.warn("Duplicate DingTalk robotCode detected. robotCode={}, previousResourceId={}, currentResourceId={}",
                        config.getRobotCode(), previous.getResourceId(), config.getResourceId());
            }
        }
        return new ArrayList<>(robotConfigCache.values());
    }

    /**
     * 解析单个数字员工的钉钉机器人配置。
     *
     * @param digitalEmployee 数字员工
     * @return 钉钉机器人配置列表
     */
    public List<DingtalkRobotChannelConfig> buildRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        return parseRobotConfigs(digitalEmployee);
    }

    /**
     * 替换指定资源对应的机器人配置缓存。
     *
     * @param resourceId 资源标识
     * @param robotConfigs 新的机器人配置列表
     */
    public void replaceRobotConfigsForResource(Long resourceId, List<DingtalkRobotChannelConfig> robotConfigs) {
        removeRobotConfigsByResourceId(resourceId);
        if (robotConfigs == null || robotConfigs.isEmpty()) {
            return;
        }
        for (DingtalkRobotChannelConfig robotConfig : robotConfigs) {
            DingtalkRobotChannelConfig previous = robotConfigCache.put(robotConfig.getRobotCode(), robotConfig);
            if (previous != null && !safeEquals(previous.getResourceId(), robotConfig.getResourceId())) {
                logger.warn("Duplicate DingTalk robotCode detected during replace. robotCode={}, previousResourceId={}, currentResourceId={}",
                        robotConfig.getRobotCode(), previous.getResourceId(), robotConfig.getResourceId());
            }
        }
    }

    /**
     * 删除指定资源对应的机器人配置缓存。
     *
     * @param resourceId 资源标识
     */
    public void removeRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        List<String> robotCodes = new ArrayList<>();
        for (Map.Entry<String, DingtalkRobotChannelConfig> entry : robotConfigCache.entrySet()) {
            if (safeEquals(resourceId, entry.getValue().getResourceId())) {
                robotCodes.add(entry.getKey());
            }
        }
        for (String robotCode : robotCodes) {
            robotConfigCache.remove(robotCode);
        }
    }

    /**
     * 获取指定资源对应的机器人配置缓存。
     *
     * @param resourceId 资源标识
     * @return 机器人配置列表
     */
    public List<DingtalkRobotChannelConfig> getRobotConfigsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        List<DingtalkRobotChannelConfig> result = new ArrayList<>();
        for (DingtalkRobotChannelConfig robotConfig : robotConfigCache.values()) {
            if (safeEquals(resourceId, robotConfig.getResourceId())) {
                result.add(robotConfig);
            }
        }
        return result;
    }

    /**
     * 清理指定 robotCode 对应的 access_token 缓存。
     *
     * @param robotCode 机器人编码
     */
    public void evictAccessTokensByRobotCode(String robotCode) {
        if (!StringUtils.hasText(robotCode)) {
            return;
        }
        RedisUtil.delByPrefix(ACCESS_TOKEN_CACHE_KEY_PREFIX + robotCode + ":");
    }

    /**
     * 根据 robotCode 获取已缓存的钉钉机器人配置。
     *
     * @param robotCode 机器人编码
     * @return 钉钉机器人配置
     */
    public DingtalkRobotChannelConfig getRobotConfig(String robotCode) {
        if (!StringUtils.hasText(robotCode)) {
            throw new IllegalStateException("DingTalk robotCode is empty");
        }
        DingtalkRobotChannelConfig config = robotConfigCache.get(robotCode);
        if (config == null) {
            throw new IllegalStateException("DingTalk robot config not found, robotCode=" + robotCode);
        }
        return config;
    }

    /**
     * 获取发送者在当前机器人配置下的 access_token。
     * 优先从 Redis 缓存读取；未命中时使用 robotCode 对应的 clientId/clientSecret
     * 调用钉钉开放平台获取，并回写 Redis。
     *
     * @param senderStaffId 发送者 staffId
     * @param robotCode 机器人编码
     * @return access_token
     */
    public String getAccessToken(String senderStaffId, String robotCode) {
        if (!StringUtils.hasText(senderStaffId)) {
            throw new IllegalStateException("DingTalk senderStaffId is empty");
        }
        DingtalkRobotChannelConfig robotConfig = getRobotConfig(robotCode);

        String clientId = robotConfig.getClientId();
        String clientSecret = robotConfig.getClientSecret();
        if (!StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            throw new IllegalStateException("DingTalk clientId/clientSecret is empty, robotCode=" + robotCode);
        }

        String accessTokenCacheKey = ACCESS_TOKEN_CACHE_KEY_PREFIX + robotCode + ":" + clientId + ":" + senderStaffId;
        String cachedAccessToken = RedisUtil.getString(accessTokenCacheKey);
        if (StringUtils.hasText(cachedAccessToken)) {
            return cachedAccessToken;
        }

        try {
            DingTalkClient client = new DefaultDingTalkClient(GET_TOKEN_URL);
            OapiGettokenRequest request = new OapiGettokenRequest();
            request.setAppkey(clientId);
            request.setAppsecret(clientSecret);
            request.setHttpMethod("GET");

            OapiGettokenResponse response = client.execute(request);
            if (response == null || !response.isSuccess() || !StringUtils.hasText(response.getAccessToken())) {
                String errCode = response == null ? "" : String.valueOf(response.getErrcode());
                String errMsg = response == null ? "" : response.getErrmsg();
                throw new IllegalStateException("Get DingTalk access_token failed, errCode=" + errCode + ", errMsg=" + errMsg);
            }

            String accessToken = response.getAccessToken();
            RedisUtil.setString(accessTokenCacheKey, accessToken, ACCESS_TOKEN_EXPIRE_MINUTES, TimeUnit.MINUTES);
            return accessToken;
        } catch (ApiException e) {
            throw new IllegalStateException("Request DingTalk access_token failed", e);
        }
    }

    /**
     * 调用钉钉开放平台查询用户详情。
     *
     * @param accessToken 钉钉 access_token
     * @param userId 钉钉用户标识
     * @return 钉钉用户详情
     */
    public OapiV2UserGetResponse.UserGetResponse getUserDetail(String accessToken, String userId) {
        if (!StringUtils.hasText(accessToken)) {
            throw new IllegalStateException("DingTalk accessToken is empty");
        }
        if (!StringUtils.hasText(userId)) {
            throw new IllegalStateException("DingTalk userId is empty");
        }

        try {
            DingTalkClient client = new DefaultDingTalkClient(USER_GET_URL);
            OapiV2UserGetRequest request = new OapiV2UserGetRequest();
            request.setUserid(userId);
            request.setLanguage(DEFAULT_LANGUAGE);

            OapiV2UserGetResponse response = client.execute(request, accessToken);
            if (response == null || !response.isSuccess() || response.getResult() == null) {
                String errCode = response == null ? "" : String.valueOf(response.getErrcode());
                String errMsg = response == null ? "" : response.getErrmsg();
                throw new IllegalStateException("Get DingTalk user detail failed, errCode=" + errCode + ", errMsg=" + errMsg);
            }
            return response.getResult();
        } catch (ApiException e) {
            throw new IllegalStateException("Request DingTalk user detail failed", e);
        }
    }

    /**
     * 从单个数字员工中解析钉钉机器人渠道配置列表。
     *
     * @param digitalEmployee 数字员工
     * @return 钉钉机器人配置列表
     */
    private List<DingtalkRobotChannelConfig> parseRobotConfigs(ResourceExtDigEmployeeDto digitalEmployee) {
        if (digitalEmployee == null || digitalEmployee.getSsResExtDigEmployee() == null) {
            return Collections.emptyList();
        }
        String machineChannel = digitalEmployee.getSsResExtDigEmployee().getMachineChannel();
        if (!StringUtils.hasText(machineChannel)) {
            return Collections.emptyList();
        }

        try {
            JsonNode root = objectMapper.readTree(machineChannel);
            List<DingtalkRobotChannelConfig> configs = new ArrayList<>();
            collectRobotConfigs(root, digitalEmployee, configs);
            return configs;
        } catch (Exception e) {
            logger.warn("Parse machineChannel failed. resourceId={}", digitalEmployee.getResourceId(), e);
            return Collections.emptyList();
        }
    }

    /**
     * 递归收集 node 中 channel = DingTalk 的配置项。
     *
     * @param node machineChannel JSON 节点
     * @param digitalEmployee 当前数字员工
     * @param configs 输出配置列表
     */
    private void collectRobotConfigs(JsonNode node, ResourceExtDigEmployeeDto digitalEmployee,
                                     List<DingtalkRobotChannelConfig> configs) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                collectRobotConfigs(item, digitalEmployee, configs);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }

        String channel = getText(node, "channel");
        if (!DING_TALK_CHANNEL.equalsIgnoreCase(channel)) {
            return;
        }

        String robotCode = getText(node, "robotCode");
        String clientId = getText(node, "clientId");
        String clientSecret = getText(node, "clientSecret");
        if (!StringUtils.hasText(robotCode) || !StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            logger.warn("Skip DingTalk robot config due to missing credentials. resourceId={}, robotCode={}, clientIdPresent={}, clientSecretPresent={}",
                    digitalEmployee.getResourceId(), robotCode, StringUtils.hasText(clientId), StringUtils.hasText(clientSecret));
            return;
        }

        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setResourceId(digitalEmployee.getResourceId());
        config.setResourceName(digitalEmployee.getResourceName());
        config.setChannel(channel);
        config.setRobotCode(robotCode);
        config.setClientId(clientId);
        config.setClientSecret(clientSecret);
        config.setAppId(getText(node, "appId"));
        config.setCardTemplateId(getText(node, "AICardId"));
        configs.add(config);
    }

    /**
     * 安全读取 JSON 字段文本值。
     *
     * @param node JSON 节点
     * @param fieldName 字段名
     * @return 字段文本值，不存在时返回空串
     */
    private String getText(JsonNode node, String fieldName) {
        JsonNode valueNode = node.get(fieldName);
        return valueNode == null || valueNode.isNull() ? "" : valueNode.asText();
    }

    private boolean safeEquals(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }
}
