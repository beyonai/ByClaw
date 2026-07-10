package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuUserDetail;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 飞书用户到系统用户的解析与绑定服务。
 *
 * <p>机器人消息不是系统登录态请求，因此需要在消息入口手动构造 LoginInfo。
 * 解析顺序与钉钉保持一致：先用历史绑定快速命中；没有绑定时拉飞书通讯录详情，
 * 再用工号、手机号、姓名匹配本地用户，并在唯一匹配后写入 po_user_external_system。</p>
 */
@Service
public class FeishuUserService {

    private static final Logger logger = LoggerFactory.getLogger(FeishuUserService.class);
    private static final Pattern USER_CODE_PATTERN = Pattern.compile("(?i)user\\s*code\\s*[:=]?\\s*([a-zA-Z0-9_\\-]+)");
    private static final String USER_GET_URL_PREFIX = "https://open.feishu.cn/open-apis/contact/v3/users/";

    private final okhttp3.OkHttpClient okHttpClient = new okhttp3.OkHttpClient();
    private final ObjectMapper objectMapper;
    private final UserService userService;
    private final UserExternalSystemService userExternalSystemService;
    private final EnterpriseInfoService enterpriseInfoService;
    private final SuasSuperassistService suasSuperassistService;
    private final SequenceService sequenceService;
    private final FeishuTokenService feishuTokenService;
    private final FeishuReplyDispatcher feishuReplyDispatcher;

    public FeishuUserService(
            ObjectMapper objectMapper,
            UserService userService,
            UserExternalSystemService userExternalSystemService,
            EnterpriseInfoService enterpriseInfoService,
            SuasSuperassistService suasSuperassistService,
            SequenceService sequenceService,
            FeishuTokenService feishuTokenService,
            FeishuReplyDispatcher feishuReplyDispatcher
    ) {
        this.objectMapper = objectMapper;
        this.userService = userService;
        this.userExternalSystemService = userExternalSystemService;
        this.enterpriseInfoService = enterpriseInfoService;
        this.suasSuperassistService = suasSuperassistService;
        this.sequenceService = sequenceService;
        this.feishuTokenService = feishuTokenService;
        this.feishuReplyDispatcher = feishuReplyDispatcher;
    }

    public LoginInfo resolveLoginInfo(FeishuCallbackMessage message) throws IOException {
        List<String> eventExternalIds = resolveEventExternalIds(message);
        Users matchedUser = findMatchedUserFromExternalSystem(eventExternalIds);
        if (matchedUser != null) {
            logger.info("Matched Feishu user from po_user_external_system by event ids. externalIds={}, userId={}",
                    eventExternalIds, matchedUser.getUserId());
            return buildLoginInfo(matchedUser);
        }

        FeishuUserDetail userDetail;
        try {
            userDetail = fetchUserDetail(message);
        } catch (IllegalStateException e) {
            handleUserDetailUnavailable(message, eventExternalIds, e);
            return null;
        }

        List<String> detailExternalIds = resolveDetailExternalIds(message, userDetail);
        String externalId = detailExternalIds.isEmpty() ? null : detailExternalIds.get(0);
        matchedUser = findMatchedUserFromExternalSystem(detailExternalIds);
        if (matchedUser != null) {
            saveUserExternalSystem(externalId, matchedUser.getUserId(), userDetail);
            return buildLoginInfo(matchedUser);
        }

        LoginInfo userInfo = resolveLoginInfoFromUserDetail(message, userDetail);
        if (userInfo != null) {
            saveUserExternalSystem(externalId, userInfo.getUserId(), userDetail);
        }
        return userInfo;
    }

    private void handleUserDetailUnavailable(
            FeishuCallbackMessage message,
            List<String> eventExternalIds,
            IllegalStateException cause
    ) throws IOException {
        logger.warn("Unable to fetch Feishu user detail. appId={}, messageId={}, eventExternalIds={}",
                message.getAppId(), message.getMessageId(), eventExternalIds, cause);
        sendTextReply(message,
                "无法获取您的飞书用户信息，请联系管理员确认应用已开通通讯录用户信息权限，"
                        + "且您在应用可用范围/通讯录权限范围内。"
                        + "如果您是外部成员，需要先维护飞书账号与系统账号的绑定。");
    }

    private FeishuUserDetail fetchUserDetail(FeishuCallbackMessage message) {
        String appId = message.getAppId();
        String openId = message.getSenderOpenId();
        if (!StringUtils.hasText(openId)) {
            throw new IllegalStateException("Feishu sender open_id is empty");
        }
        String tenantAccessToken = feishuTokenService.getTenantAccessToken(appId);
        String url = USER_GET_URL_PREFIX + openId + "?user_id_type=open_id";
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + tenantAccessToken)
                .get()
                .build();
        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IllegalStateException("Get Feishu user detail failed, httpCode="
                        + response.code() + ", body=" + responseBody);
            }
            JsonNode root = objectMapper.readTree(responseBody);
            if (root.path("code").asInt(-1) != 0) {
                throw new IllegalStateException("Get Feishu user detail failed, code="
                        + root.path("code").asInt() + ", msg=" + root.path("msg").asText(""));
            }
            FeishuUserDetail detail = toUserDetail(root.path("data").path("user"));
            logger.info("Fetched Feishu user detail. openId={}, unionId={}, userId={}, name={}, mobile={}, employeeNo={}",
                    detail.getOpenId(), detail.getUnionId(), detail.getUserId(),
                    detail.getName(), detail.getMobile(), detail.getEmployeeNo());
            return detail;
        } catch (IOException e) {
            throw new IllegalStateException("Request Feishu user detail failed", e);
        }
    }

    private FeishuUserDetail toUserDetail(JsonNode userNode) {
        FeishuUserDetail detail = new FeishuUserDetail();
        detail.setUserId(userNode.path("user_id").asText(""));
        detail.setOpenId(userNode.path("open_id").asText(""));
        detail.setUnionId(userNode.path("union_id").asText(""));
        detail.setName(userNode.path("name").asText(""));
        detail.setMobile(userNode.path("mobile").asText(""));
        detail.setEmail(userNode.path("email").asText(""));
        detail.setEmployeeNo(resolveEmployeeNo(userNode));
        return detail;
    }

    /**
     * 飞书不同租户/权限返回的工号字段可能存在差异，这里做宽松读取。
     */
    private String resolveEmployeeNo(JsonNode userNode) {
        String employeeNo = userNode.path("employee_no").asText("");
        if (StringUtils.hasText(employeeNo)) {
            return employeeNo;
        }
        return userNode.path("employee_id").asText("");
    }

    private Users findMatchedUserFromExternalSystem(String externalId) {
        if (!StringUtils.hasText(externalId)) {
            return null;
        }

        UserExternalSystem externalSystem = userExternalSystemService.findByUnionId(SourceType.FEISHU, externalId);
        if (externalSystem == null || externalSystem.getUserId() == null) {
            return null;
        }

        Users matchedUser = userService.findById(externalSystem.getUserId());
        if (matchedUser == null) {
            logger.warn("Found Feishu external binding but local user is missing. externalId={}, userId={}",
                    externalId, externalSystem.getUserId());
        }
        return matchedUser;
    }

    private Users findMatchedUserFromExternalSystem(List<String> externalIds) {
        if (externalIds == null || externalIds.isEmpty()) {
            return null;
        }
        for (String externalId : externalIds) {
            Users matchedUser = findMatchedUserFromExternalSystem(externalId);
            if (matchedUser != null) {
                return matchedUser;
            }
        }
        return null;
    }

    private LoginInfo resolveLoginInfoFromUserDetail(
            FeishuCallbackMessage message,
            FeishuUserDetail userDetail
    ) throws IOException {
        List<Users> users = findUsersByUserDetail(userDetail);
        if (users == null || users.isEmpty()) {
            sendTextReply(message, "未找到匹配的系统用户，请联系管理员创建账号后再试。");
            return null;
        }

        String selectedUserCode = extractSelectedUserCode(message.getTextContent());
        if (selectedUserCode != null) {
            users = filterUsersBySelectedUserCode(users, selectedUserCode);
            if (users.isEmpty()) {
                sendTextReply(message, "未找到 userCode=" + selectedUserCode + " 对应用户，请从候选列表中选择。");
                return null;
            }
        }

        if (users.size() > 1) {
            sendTextReply(message, buildMultipleUsersPrompt(userDetail.getName(), users));
            return null;
        }

        return buildLoginInfo(users.get(0));
    }

    private void sendTextReply(FeishuCallbackMessage message, String content) throws IOException {
        String token = feishuTokenService.getTenantAccessToken(message.getAppId());
        feishuReplyDispatcher.replyTextMessage(token, message.getMessageId(), content);
    }

    private List<Users> findUsersByUserDetail(FeishuUserDetail userDetail) {
        List<Users> users = new ArrayList<>();

        String employeeNo = userDetail == null ? null : userDetail.getEmployeeNo();
        if (StringUtils.hasText(employeeNo)) {
            Users matchedByUserCode = userService.findByUserCode(employeeNo);
            if (matchedByUserCode != null) {
                users.add(matchedByUserCode);
            }
        }

        if (!users.isEmpty()) {
            return users;
        }

        String mobile = userDetail == null ? null : userDetail.getMobile();
        if (StringUtils.hasText(mobile)) {
            Users matchedByMobile = userService.findByUserPhone(mobile);
            if (matchedByMobile != null) {
                users.add(matchedByMobile);
            }
        }

        if (!users.isEmpty()) {
            return users;
        }

        String name = userDetail == null ? null : userDetail.getName();
        return StringUtils.hasText(name) ? userService.findByUserName(name) : users;
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

    private List<String> resolveEventExternalIds(FeishuCallbackMessage message) {
        List<String> externalIds = new ArrayList<>();
        if (message == null) {
            return externalIds;
        }
        addExternalId(externalIds, message.getSenderUnionId());
        addExternalId(externalIds, message.getSenderOpenId());
        addExternalId(externalIds, message.getSenderUserId());
        return externalIds;
    }

    private List<String> resolveDetailExternalIds(FeishuCallbackMessage message, FeishuUserDetail userDetail) {
        Set<String> externalIds = new LinkedHashSet<>();
        if (userDetail != null) {
            addExternalId(externalIds, userDetail.getUnionId());
            addExternalId(externalIds, userDetail.getOpenId());
            addExternalId(externalIds, userDetail.getUserId());
        }
        if (message != null) {
            addExternalId(externalIds, message.getSenderUnionId());
            addExternalId(externalIds, message.getSenderOpenId());
            addExternalId(externalIds, message.getSenderUserId());
        }
        return new ArrayList<>(externalIds);
    }

    private void addExternalId(List<String> externalIds, String externalId) {
        if (StringUtils.hasText(externalId) && !externalIds.contains(externalId)) {
            externalIds.add(externalId);
        }
    }

    private void addExternalId(Set<String> externalIds, String externalId) {
        if (StringUtils.hasText(externalId)) {
            externalIds.add(externalId);
        }
    }

    private void saveUserExternalSystem(String externalId, Long userId, FeishuUserDetail userDetail) {
        if (!StringUtils.hasText(externalId) || userId == null || userDetail == null) {
            return;
        }

        UserExternalSystem existing = userExternalSystemService.findByUnionId(SourceType.FEISHU, externalId);
        if (existing != null) {
            existing.setUserId(userId);
            existing.setSourceAccount(userDetail.getEmployeeNo());
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
        userExternalSystem.setSourceType(SourceType.FEISHU);
        userExternalSystem.setSourceAccount(userDetail.getEmployeeNo());
        userExternalSystem.setSourceNickname(userDetail.getName());
        userExternalSystem.setSourceEmail(userDetail.getEmail());
        userExternalSystem.setBindingTime(new Date());
        userExternalSystem.setUnionId(externalId);
        userExternalSystemService.save(userExternalSystem);
    }

    private String extractSelectedUserCode(String textContent) {
        if (!StringUtils.hasText(textContent)) {
            return null;
        }
        Matcher matcher = USER_CODE_PATTERN.matcher(textContent);
        if (!matcher.find()) {
            return null;
        }
        return matcher.group(1).trim();
    }

    private String buildMultipleUsersPrompt(String senderName, List<Users> users) {
        StringBuilder builder = new StringBuilder();
        builder.append("检测到");
        if (StringUtils.hasText(senderName)) {
            builder.append("飞书用户「").append(senderName).append("」");
        } else {
            builder.append("当前飞书用户");
        }
        builder.append("匹配到多个系统用户，请回复 user code: 用户编码 完成绑定。\n");
        for (Users user : users) {
            builder.append("- ")
                    .append(user.getUserName())
                    .append(" / ")
                    .append(user.getUserCode())
                    .append('\n');
        }
        return builder.toString();
    }
}
