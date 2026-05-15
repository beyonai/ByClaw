package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.api.DefaultDingTalkClient;
import com.dingtalk.api.DingTalkClient;
import com.dingtalk.api.request.OapiV2UserGetRequest;
import com.dingtalk.api.response.OapiV2UserGetResponse;
import com.taobao.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class DingtalkUserService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkUserService.class);
    private static final String USER_GET_URL = "https://oapi.dingtalk.com/topapi/v2/user/get";
    private static final String DEFAULT_LANGUAGE = "zh_CN";

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
}
