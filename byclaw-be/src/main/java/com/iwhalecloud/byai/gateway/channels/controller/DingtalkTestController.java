package com.iwhalecloud.byai.gateway.channels.controller;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.channels.enums.AssistantAccessChannel;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.enums.ChatChannelExtensionKeys;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkSessionService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardStreamingOutputStream;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 钉钉本地测试控制器。
 * 走和 DingtalkBotListener 完全相同的对话 + 输出路径：
 * 使用 DingtalkCardStreamingOutputStream 解析 JSON blocks（包含 {{file_preview_prefix}} 替换），
 * 但不创建真实卡片会话，最终将累积内容返回给 HTTP 调用方。
 */
@RestController
@RequestMapping("/dingtalk/test")
@ConditionalOnProperty(name = "dingtalk.stream.enabled", havingValue = "false", matchIfMissing = true)
public class DingtalkTestController {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkTestController.class);

    private final UserService userService;
    private final IndexService indexService;
    private final DingtalkSessionService dingtalkSessionService;
    private final EnterpriseInfoService enterpriseInfoService;
    private final SuasSuperassistService suasSuperassistService;
    private final ObjectMapper objectMapper;
    private final DingtalkRobotRegistryService dingtalkRobotRegistryService;

    public DingtalkTestController(
            UserService userService,
            IndexService indexService,
            DingtalkSessionService dingtalkSessionService,
            EnterpriseInfoService enterpriseInfoService,
            SuasSuperassistService suasSuperassistService,
            ObjectMapper objectMapper,
            DingtalkRobotRegistryService dingtalkRobotRegistryService
    ) {
        this.userService = userService;
        this.indexService = indexService;
        this.dingtalkSessionService = dingtalkSessionService;
        this.enterpriseInfoService = enterpriseInfoService;
        this.suasSuperassistService = suasSuperassistService;
        this.objectMapper = objectMapper;
        this.dingtalkRobotRegistryService = dingtalkRobotRegistryService;
    }

    @GetMapping("/chat")
    public void chat(
            @RequestParam String userCode,
            @RequestParam String text,
            @RequestParam(required = false) Long agentId,
            @RequestParam(required = false) String robotCode,
            @RequestParam(required = false, defaultValue = "1") String conversationType,
            @RequestParam(required = false) String conversationId,
            HttpServletResponse response) throws IOException {
        logger.info("DingTalk test chat. userCode={}, agentId={}, robotCode={}, text={}",
                userCode, agentId, robotCode, text);

        Users user = userService.findByUserCode(userCode);
        if (user == null) {
            response.setStatus(400);
            response.getWriter().write("User not found: " + userCode);
            return;
        }

        LoginInfo loginInfo = buildLoginInfo(user);
        CurrentUserHolder.setLoginInfo(loginInfo);

        try {
            AuthDigitEmployVo digitEmployVo = findDigitEmploy(user.getUserId(), agentId, robotCode);
            if (digitEmployVo == null) {
                response.setStatus(400);
                response.getWriter().write("No authorized digital employee found. agentId=" + agentId + ", robotCode=" + robotCode);
                return;
            }

            String resolvedConversationId = conversationId != null ? conversationId : "test-" + userCode;
            String senderStaffId = "test-" + userCode;

            String sessionExtValue = "2".equals(conversationType)
                    ? senderStaffId + resolvedConversationId
                    : resolvedConversationId;

            AssistantChatDto assistantChatDto = new AssistantChatDto();
            assistantChatDto.setAccessTerminal(ChannelType.DINGTALK.getCode());
            assistantChatDto.setChatContent(text);
            assistantChatDto.setRelModelId(-1L);
            assistantChatDto.setAgentId(digitEmployVo.getId());
            assistantChatDto.setAgentType(digitEmployVo.getAgentType());
            assistantChatDto.setSessionId(dingtalkSessionService.resolveSessionId(
                    text, sessionExtValue, digitEmployVo.getId()));
            assistantChatDto.setResourceList(buildResourceList(digitEmployVo));

            Map<String, String> channelExt = new HashMap<>();
            channelExt.put(ChatChannelExtensionKeys.CHANNEL_TYPE, AssistantAccessChannel.DINGTALK.getTypeCode());
            channelExt.put(ChatChannelExtensionKeys.DINGTALK_CONVERSATION_TYPE, conversationType);
            channelExt.put(ChatChannelExtensionKeys.DINGTALK_CONVERSATION_ID, resolvedConversationId);
            channelExt.put(ChatChannelExtensionKeys.DINGTALK_SENDER_STAFF_ID, senderStaffId);
            assistantChatDto.setChannelExtension(channelExt);
            assistantChatDto.getExtParams().put("files", Collections.emptyList());

            // 使用 DingtalkCardStreamingOutputStream 走真实解析路径（含 {{file_preview_prefix}} 替换）
            // session 传 null — 不创建卡片，通过 onContentUpdate 回调流式写 SSE 到前端
            response.setContentType("text/event-stream;charset=utf-8");
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("Connection", "keep-alive");

            var servletOut = response.getOutputStream();
            DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                    objectMapper, null, null, displayContent -> {
                try {
                    String sseFrame = "data: " + displayContent.replace("\n", "\\n") + "\n\n";
                    servletOut.write(sseFrame.getBytes(StandardCharsets.UTF_8));
                    servletOut.flush();
                } catch (IOException e) {
                    logger.warn("Failed to write SSE frame to test client", e);
                }
            });

            ChannelService channelService = ChannelServiceFactory.getService(ChannelType.DINGTALK.getCode());
            channelService.chat(assistantChatDto, outputStream);

            servletOut.write("event: done\ndata: [DONE]\n\n".getBytes(StandardCharsets.UTF_8));
            servletOut.flush();
        } catch (Exception e) {
            logger.error("DingTalk test chat failed. userCode={}", userCode, e);
            response.setStatus(500);
            response.getWriter().write("Chat failed: " + e.getMessage());
        } finally {
            CurrentUserHolder.clearLoginInfo();
        }
    }

    private AuthDigitEmployVo findDigitEmploy(Long userId, Long agentId, String robotCode) {
        MyAuthEmployQo qo = new MyAuthEmployQo();
        qo.setUserId(userId);
        if (robotCode != null) {
            qo.setMachineChannel(robotCode);
        }

        List<AuthDigitEmployVo> list = indexService.selectAuthDigitEmploy(qo);
        if (CollectionUtils.isEmpty(list)) {
            return null;
        }

        if (agentId != null) {
            return list.stream()
                    .filter(v -> agentId.equals(v.getId()))
                    .findFirst()
                    .orElse(list.get(0));
        }
        return list.get(0);
    }

    private LoginInfo buildLoginInfo(Users user) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(user.getUserId());
        loginInfo.setUserCode(user.getUserCode());
        loginInfo.setUserName(user.getUserName());
        loginInfo.setAssistantId(user.getAssistantId());
        loginInfo.setEnterpriseId(enterpriseInfoService.getEnterpriseId());
        SuasSuperassist suasSuperassist = suasSuperassistService.findByUserId(user.getUserId());
        if (suasSuperassist != null) {
            loginInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
            loginInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());
        }
        return loginInfo;
    }

    private List<ResourceVo> buildResourceList(AuthDigitEmployVo digitEmployVo) {
        ResourceVo resourceVo = new ResourceVo();
        resourceVo.setResourceId(String.valueOf(digitEmployVo.getId()));
        resourceVo.setResourceName(digitEmployVo.getName());
        resourceVo.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        resourceVo.setResourceCode(digitEmployVo.getResourceCode());
        return List.of(resourceVo);
    }

    @GetMapping("/registerStream")
    public Map<String, Object> registerStream(@RequestParam Long resourceId) {
        logger.info("DingTalk test registerStream. resourceId={}", resourceId);
        try {
            dingtalkRobotRegistryService.forceRegisterRobotClientsForResource(resourceId);
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("message", "Stream client registered for resourceId=" + resourceId);
            return result;
        } catch (Exception e) {
            logger.error("Failed to register DingTalk stream client. resourceId={}", resourceId, e);
            Map<String, Object> result = new HashMap<>();
            result.put("success", false);
            result.put("message", "Register failed: " + e.getMessage());
            return result;
        }
    }

    @GetMapping("/unregisterStream")
    public Map<String, Object> unregisterStream(@RequestParam Long resourceId) {
        logger.info("DingTalk test unregisterStream. resourceId={}", resourceId);
        try {
            dingtalkRobotRegistryService.unregisterRobotClientsForResource(resourceId);
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("message", "Stream client unregistered for resourceId=" + resourceId);
            return result;
        } catch (Exception e) {
            logger.error("Failed to unregister DingTalk stream client. resourceId={}", resourceId, e);
            Map<String, Object> result = new HashMap<>();
            result.put("success", false);
            result.put("message", "Unregister failed: " + e.getMessage());
            return result;
        }
    }
}
