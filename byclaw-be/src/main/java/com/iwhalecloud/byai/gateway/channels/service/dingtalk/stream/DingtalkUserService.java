package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import java.io.IOException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import com.dingtalk.api.DefaultDingTalkClient;
import com.dingtalk.api.DingTalkClient;
import com.dingtalk.api.request.OapiV2UserGetRequest;
import com.dingtalk.api.response.OapiV2UserGetResponse;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.taobao.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class DingtalkUserService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkUserService.class);
    private static final String USER_GET_URL = "https://oapi.dingtalk.com/topapi/v2/user/get";
    private static final String DEFAULT_LANGUAGE = "zh_CN";
    private static final Pattern USER_CODE_PATTERN = Pattern.compile("(?i)user\\s*code\\s*[:=]?\\s*([a-zA-Z0-9_\\-]+)");

    @Autowired
    private UserService userService;
    @Autowired
    private UserExternalSystemService userExternalSystemService;
    @Autowired
    private EnterpriseInfoService enterpriseInfoService;
    @Autowired
    private SuasSuperassistService suasSuperassistService;
    @Autowired
    private SequenceService sequenceService;
    @Autowired
    private DingtalkTokenService dingtalkTokenService;
    @Autowired
    private DingtalkReplyDispatcher dingtalkReplyDispatcher;

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

    public LoginInfo resolveLoginInfo(DingtalkCallbackMessage DDMessage) throws IOException {
        String senderStaffId = DDMessage.getSenderStaffId();
        String robotCode = DDMessage.getRobotCode();
        String textContent = DDMessage.getTextContent();
        String sessionWebhook = DDMessage.getSessionWebhook();

        Users matchedUser = findMatchedUserFromExternalSystem(senderStaffId);
        if (matchedUser != null) {
            logger.info("Matched DingTalk user from po_user_external_system by senderStaffId. senderStaffId={}, userId={}",
                    senderStaffId, matchedUser.getUserId());
            return buildLoginInfo(matchedUser);
        }

        OapiV2UserGetResponse.UserGetResponse userDetail = fetchUserDetail(senderStaffId, robotCode);

        String unionId = resolveExternalUnionId(senderStaffId, userDetail);
        matchedUser = findMatchedUserFromExternalSystem(unionId);
        if (matchedUser != null) {
            logger.info("Matched DingTalk user from po_user_external_system by unionId. senderStaffId={}, unionId={}, userId={}",
                    senderStaffId, unionId, matchedUser.getUserId());
            saveUserExternalSystem(unionId, matchedUser.getUserId(), userDetail);
            return buildLoginInfo(matchedUser);
        }

        LoginInfo userInfo = resolveLoginInfoFromUserDetail(sessionWebhook, textContent, userDetail);
        if (userInfo != null) {
            saveUserExternalSystem(unionId, userInfo.getUserId(), userDetail);
        }
        return userInfo;
    }

    private OapiV2UserGetResponse.UserGetResponse fetchUserDetail(String senderStaffId, String robotCode) {
        OapiV2UserGetResponse.UserGetResponse userDetail =
                getUserDetail(dingtalkTokenService.getAccessToken(senderStaffId, robotCode), senderStaffId);
        logger.info("Fetched DingTalk user detail. senderStaffId={}, userId={}, unionId={}, name={}, mobile={}, email={}, jobNumber={}",
                senderStaffId,
                userDetail.getUserid(),
                userDetail.getUnionid(),
                userDetail.getName(),
                userDetail.getMobile(),
                userDetail.getEmail(),
                userDetail.getJobNumber());
        return userDetail;
    }

    private Users findMatchedUserFromExternalSystem(String unionId) {
        if (unionId == null || unionId.isBlank()) {
            return null;
        }

        UserExternalSystem externalSystem = userExternalSystemService.findByUnionId(SourceType.DING_TALK, unionId);
        if (externalSystem == null || externalSystem.getUserId() == null) {
            return null;
        }

        Users matchedUser = userService.findById(externalSystem.getUserId());
        if (matchedUser == null) {
            logger.warn("Found po_user_external_system record but local user is missing. unionId={}, userId={}",
                    unionId, externalSystem.getUserId());
        }
        return matchedUser;
    }

    private LoginInfo resolveLoginInfoFromUserDetail(
            String sessionWebhook, String textContent,
            OapiV2UserGetResponse.UserGetResponse userDetail) throws IOException {
        List<Users> users = findUsersByUserDetail(userDetail);
        String resolvedSenderNick = userDetail == null ? null : userDetail.getName();
        if (users == null || users.isEmpty()) {
            dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "未找到匹配的系统用户，请联系管理员创建账号后再试。");
            return null;
        }

        String selectedUserCode = extractSelectedUserCode(textContent);
        if (selectedUserCode != null) {
            users = filterUsersBySelectedUserCode(users, selectedUserCode);
            if (users.isEmpty()) {
                dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, "未找到 userCode=" + selectedUserCode + " 对应用户，请从候选列表中选择。");
                return null;
            }
        }

        if (users.size() > 1) {
            dingtalkReplyDispatcher.sendTextMessage(sessionWebhook, buildMultipleUsersPrompt(resolvedSenderNick, users));
            return null;
        }

        Users matchedUser = users.get(0);
        return buildLoginInfo(matchedUser);
    }

    private List<Users> findUsersByUserDetail(OapiV2UserGetResponse.UserGetResponse userDetail) {
        List<Users> users = new ArrayList<>();

        String jobNumber = userDetail == null ? null : userDetail.getJobNumber();
        if (jobNumber != null && !jobNumber.isBlank()) {
            Users matchedByUserCode = userService.findByUserCode(jobNumber);
            if (matchedByUserCode != null) {
                users.add(matchedByUserCode);
            }
        }

        if (!users.isEmpty()) {
            return users;
        }

        String mobile = userDetail == null ? null : userDetail.getMobile();
        if (mobile != null && !mobile.isBlank()) {
            Users matchedByMobile = userService.findByUserPhone(mobile);
            if (matchedByMobile != null) {
                users.add(matchedByMobile);
            }
        }

        if (!users.isEmpty()) {
            return users;
        }

        String resolvedSenderNick = userDetail == null ? null : userDetail.getName();
        return userService.findByUserName(resolvedSenderNick);
    }

    private List<Users> filterUsersBySelectedUserCode(List<Users> users, String selectedUserCode) {
        return users.stream()
                .filter(user -> user.getUserCode() != null)
                .filter(user -> user.getUserCode().equalsIgnoreCase(selectedUserCode))
                .collect(Collectors.toList());
    }

    private LoginInfo buildLoginInfo(Users matchedUser) {
        LoginInfo userInfo = new LoginInfo();
        userInfo.setUserId(matchedUser.getUserId());
        userInfo.setUserCode(matchedUser.getUserCode());
        userInfo.setUserName(matchedUser.getUserName());
        userInfo.setAssistantId(matchedUser.getAssistantId());
        userInfo.setEnterpriseId(enterpriseInfoService.getEnterpriseId());
        SuasSuperassist suasSuperassist = suasSuperassistService.findByUserId(matchedUser.getUserId());
        if (suasSuperassist != null) {
            userInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
            userInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());
        }
        CurrentUserHolder.setLoginInfo(userInfo);
        return userInfo;
    }

    private String resolveExternalUnionId(
            String senderStaffId,
            OapiV2UserGetResponse.UserGetResponse userDetail) {
        String unionId = userDetail == null ? null : userDetail.getUnionid();
        if (unionId != null && !unionId.isBlank()) {
            return unionId;
        }
        return senderStaffId;
    }

    private void saveUserExternalSystem(
            String unionId, Long userId,
            OapiV2UserGetResponse.UserGetResponse userDetail) {
        if (unionId == null || unionId.isBlank() || userId == null || userDetail == null) {
            return;
        }

        UserExternalSystem existing = userExternalSystemService.findByUnionId(SourceType.DING_TALK, unionId);
        if (existing != null) {
            existing.setUserId(userId);
            existing.setSourceAccount(userDetail.getJobNumber());
            existing.setSourceNickname(userDetail.getName());
            existing.setSourceEmail(userDetail.getEmail());
            if (existing.getBindingTime() == null) {
                existing.setBindingTime(new Date());
            }
            userExternalSystemService.update(existing);
            return;
        }

        UserExternalSystem userExternalSystem = new UserExternalSystem();
        userExternalSystem.setId(sequenceService.nextVal());
        userExternalSystem.setUserId(userId);
        userExternalSystem.setSourceType(SourceType.DING_TALK);
        userExternalSystem.setSourceAccount(userDetail.getJobNumber());
        userExternalSystem.setSourceNickname(userDetail.getName());
        userExternalSystem.setSourceEmail(userDetail.getEmail());
        userExternalSystem.setBindingTime(new Date());
        userExternalSystem.setUnionId(unionId);
        userExternalSystemService.save(userExternalSystem);
    }

    private String extractSelectedUserCode(String textContent) {
        if (textContent == null || textContent.isBlank()) {
            return null;
        }
        Matcher matcher = USER_CODE_PATTERN.matcher(textContent);
        if (!matcher.find()) {
            return null;
        }
        return matcher.group(1).trim();
    }

    private String buildMultipleUsersPrompt(String senderNick, List<Users> users) {
        StringBuilder builder = new StringBuilder();
        builder.append("检测到昵称【").append(senderNick).append("】匹配到多个用户，请回复以下 userCode 之一进行选择：\n");
        for (Users user : users) {
            builder.append("- userCode: ")
                    .append(user.getUserCode())
                    .append("，userName: ")
                    .append(user.getUserName())
                    .append("\n");
        }
        builder.append("示例：回复“选择 userCode=xxx”");
        return builder.toString();
    }
}
