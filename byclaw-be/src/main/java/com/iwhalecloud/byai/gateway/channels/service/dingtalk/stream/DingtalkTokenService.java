package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.api.DefaultDingTalkClient;
import com.dingtalk.api.DingTalkClient;
import com.dingtalk.api.request.OapiGettokenRequest;
import com.dingtalk.api.response.OapiGettokenResponse;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.taobao.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.concurrent.TimeUnit;

@Service
public class DingtalkTokenService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkTokenService.class);
    private static final String GET_TOKEN_URL = "https://oapi.dingtalk.com/gettoken";
    private static final long ACCESS_TOKEN_EXPIRE_MINUTES = 119L;
    private static final String ACCESS_TOKEN_CACHE_KEY_PREFIX = "dingtalk:access_token:";

    private final DingtalkRobotConfigService robotConfigService;

    public DingtalkTokenService(DingtalkRobotConfigService robotConfigService) {
        this.robotConfigService = robotConfigService;
    }

    public String getAccessToken(String senderStaffId, String robotCode) {
        if (!StringUtils.hasText(senderStaffId)) {
            throw new IllegalStateException("DingTalk senderStaffId is empty");
        }
        DingtalkRobotChannelConfig robotConfig = robotConfigService.getRobotConfig(robotCode);

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

    public void evictAccessTokensByRobotCode(String robotCode) {
        if (!StringUtils.hasText(robotCode)) {
            return;
        }
        RedisUtil.delByPrefix(ACCESS_TOKEN_CACHE_KEY_PREFIX + robotCode + ":");
    }
}
