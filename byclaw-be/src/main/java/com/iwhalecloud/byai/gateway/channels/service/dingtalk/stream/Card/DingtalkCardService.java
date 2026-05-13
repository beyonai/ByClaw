package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.card;

import com.aliyun.dingtalkcard_1_0.Client;
import com.aliyun.dingtalkcard_1_0.models.CreateAndDeliverHeaders;
import com.aliyun.dingtalkcard_1_0.models.CreateAndDeliverRequest;
import com.aliyun.dingtalkcard_1_0.models.PrivateDataValue;
import com.aliyun.dingtalkcard_1_0.models.StreamingUpdateHeaders;
import com.aliyun.dingtalkcard_1_0.models.StreamingUpdateRequest;
import com.aliyun.dingtalkcard_1_0.models.UpdateCardHeaders;
import com.aliyun.dingtalkcard_1_0.models.UpdateCardRequest;
import com.aliyun.tea.TeaException;
import com.aliyun.tea.TeaConverter;
import com.aliyun.tea.TeaPair;
import com.aliyun.teaopenapi.models.Config;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotConfigService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkTokenService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 固定封装“智能体回复卡片”的发送逻辑。
 * 当前实现按最新单聊/群聊 demo 组装请求，并将 createAndDeliver 与
 * streamingUpdate 拆开，便于在 chat() 生成过程中实时更新卡片内容。
 */
@Service
public class DingtalkCardService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkCardService.class);

    static final String SINGLE_CHAT_TYPE = "1";
    static final String GROUP_CHAT_TYPE = "2";
    private static final String SPACE_TYPE_IM_ROBOT = "IM_ROBOT";

    /**
     * TODO 按实际钉钉模板填写；留空时外层会自动回退为文本回复。
     */
    private static final String CARD_TEMPLATE_ID = "9b643b4e-9602-4dab-811a-290d13299e14.schema";
    private static final String DEFAULT_CALLBACK_TYPE = "STREAM";
    private static final String DEFAULT_LAST_MESSAGE = "AI 回复";
    private static final String LAST_MESSAGE_LANGUAGE = "ZH_CN";
    private static final String ROBOT_OPEN_SPACE_ID_PREFIX = "dtv1.card//im_robot.";
    private static final String GROUP_OPEN_SPACE_ID_PREFIX = "dtv1.card//im_group.";
    private static final String DEFAULT_SEARCH_ICON = "";
    private static final String DEFAULT_SEARCH_DESC = "智能体回复卡片";
    private static final String CARD_DEBUG_TOOL_ENTRY_KEY = "_CARD_DEBUG_TOOL_ENTRY";
    private static final String CARD_DEBUG_TOOL_ENTRY_VALUE = "show";
    private static final String STREAMING_UPDATE_CONTENT_KEY = "content";
    private static final String CARDPARAMMAP_COPYCONTENT_KEY = "copyContent";

    private final ObjectMapper objectMapper;
    private final DingtalkTokenService dingtalkTokenService;
    private final DingtalkRobotConfigService dingtalkRobotConfigService;

    public DingtalkCardService(ObjectMapper objectMapper, DingtalkTokenService dingtalkTokenService, DingtalkRobotConfigService dingtalkRobotConfigService) {
        this.objectMapper = objectMapper;
        this.dingtalkTokenService = dingtalkTokenService;
        this.dingtalkRobotConfigService = dingtalkRobotConfigService;
    }

    /**
     * 先创建一张空内容卡片，返回后续用于 streamingUpdate 的会话对象。
     * 这里的 outTrackId 会在整个卡片生命周期内复用。
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public DingtalkCardStreamSession createAssistantReplyCardSession(
            String senderStaffId,
            String robotCode,
            String conversationType,
            String conversationId,
            String agentName
    ) throws Exception {
        if (!StringUtils.hasText(senderStaffId)) {
            throw new IllegalArgumentException("DingTalk senderStaffId is empty");
        }
        if (!StringUtils.hasText(robotCode)) {
            throw new IllegalArgumentException("DingTalk robotCode is empty");
        }
        String cardTemplateId = resolveCardTemplateId(robotCode);
        if (!StringUtils.hasText(cardTemplateId)) {
            throw new IllegalStateException("DingTalk assistant reply card template not configured");
        }

        String accessToken = dingtalkTokenService.getAccessToken(senderStaffId, robotCode);
        String outTrackId = resolveOutTrackId(robotCode, senderStaffId, conversationType);
        Map<String, String> cardParamMap = buildAssistantReplyCardParamMap(agentName);
        CreateAndDeliverHeaders headers = buildCreateAndDeliverHeaders(accessToken);

        CreateAndDeliverRequest request = buildAssistantReplyRequest(
                senderStaffId,
                robotCode,
                conversationType,
                conversationId,
                outTrackId,
                cardTemplateId,
                cardParamMap
        );

        Client client = createClient();
        client.createAndDeliverWithOptions(
                request,
                headers,
                new com.aliyun.teautil.models.RuntimeOptions()
        );
        return new DingtalkCardStreamSession(client, accessToken, outTrackId);
    }

    /**
     * 按会话类型组装创建卡片请求：
     * 单聊使用 imRobotOpen* 模型，群聊使用 imGroupOpen* 模型。
     */
    CreateAndDeliverRequest buildAssistantReplyRequest(
            String senderStaffId,
            String robotCode,
            String conversationType,
            String conversationId,
            String outTrackId,
            String cardTemplateId,
            Map<String, String> cardParamMap
    ) {
        CreateAndDeliverRequest request = new CreateAndDeliverRequest()
                .setUserId(senderStaffId)
                .setCardTemplateId(cardTemplateId)
                .setOutTrackId(outTrackId)
                .setCallbackType(DEFAULT_CALLBACK_TYPE)
                .setCardData(new CreateAndDeliverRequest.CreateAndDeliverRequestCardData().setCardParamMap(cardParamMap))
                .setUserIdType(1);
        
        request.setPrivateData(buildDebugPrivateData(senderStaffId));

        if (GROUP_CHAT_TYPE.equals(conversationType)) {
            if (!StringUtils.hasText(conversationId)) {
                throw new IllegalArgumentException("DingTalk group conversationId is empty");
            }
            return request
                    .setImGroupOpenDeliverModel(
                        new CreateAndDeliverRequest.CreateAndDeliverRequestImGroupOpenDeliverModel()
                            .setRobotCode(robotCode)
                            // .setRecipients(java.util.List.of(senderStaffId)) 是否指定人员可见
                    )
                    .setImGroupOpenSpaceModel(buildGroupOpenSpaceModel(cardParamMap.get("lastMessage")))
                    .setOpenSpaceId(GROUP_OPEN_SPACE_ID_PREFIX + conversationId);
        }
        return request
                .setImRobotOpenDeliverModel(new CreateAndDeliverRequest.CreateAndDeliverRequestImRobotOpenDeliverModel()
                        .setSpaceType(SPACE_TYPE_IM_ROBOT)
                        .setRobotCode(robotCode))
                .setImRobotOpenSpaceModel(buildRobotOpenSpaceModel(cardParamMap.get("lastMessage")))
                .setOpenSpaceId(ROBOT_OPEN_SPACE_ID_PREFIX + senderStaffId);
    }

    /**
     * 组装卡片公有数据。
     * 当前字段结构与现行卡片 schema 对齐；除 content 外，其他动态字段先给默认值。
     */
    Map<String, String> buildAssistantReplyCardParamMap(String agentName) {
        Map<String, Object> rawCardData = new LinkedHashMap<>();
        rawCardData.put("lastMessage", buildCardLastMessage(agentName));
        rawCardData.put("content", buildCardLastMessage(agentName));
        rawCardData.put(CARDPARAMMAP_COPYCONTENT_KEY, "");
        rawCardData.put("resources", Collections.emptyList());
        rawCardData.put("users", Collections.emptyList());
        rawCardData.put("progress", 100);
        rawCardData.put("commandList", Collections.emptyList());
        return convertCardData(rawCardData);
    }

    /**
     * 钉钉卡片接口要求 cardParamMap 的 value 全部是 string，
     * 因此数组、对象、数字等复杂值都统一序列化为 JSON 字符串。
     */
    Map<String, String> convertCardData(Map<String, Object> rawCardData) {
        if (rawCardData == null || rawCardData.isEmpty()) {
            return Collections.emptyMap();
        }

        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : rawCardData.entrySet()) {
            String key = entry.getKey();
            if (key == null || key.isBlank()) {
                continue;
            }

            Object value = entry.getValue();
            if (value == null) {
                result.put(key, "");
                continue;
            }

            if (value instanceof String stringValue) {
                result.put(key, stringValue);
                continue;
            }

            try {
                result.put(key, objectMapper.writeValueAsString(value));
            } catch (JsonProcessingException e) {
                throw new IllegalArgumentException("Serialize DingTalk card param failed, key=" + key, e);
            }
        }
        return result;
    }

    StreamingUpdateRequest buildStreamingUpdateRequest(
            String outTrackId,
            String guid,
            String key,
            String content,
            boolean isFinalize
    ) {
        if (!StringUtils.hasText(key)) {
            throw new IllegalArgumentException("DingTalk streaming update key is empty");
        }

        StreamingUpdateRequest request = new StreamingUpdateRequest()
                .setOutTrackId(outTrackId)
                .setGuid(guid)
                .setKey(key)
                .setContent(content)
                .setIsFull(true)
                .setIsError(false);

        if (isFinalize) {
            request.setIsFinalize(true);
        } else {
            request.setIsFinalize(false);
        }

        return request;
    }

    /**
     * 单聊卡片的空间模型。
     * 负责消息列表展示文案、搜索展示信息，以及是否支持转发。
     */
    private CreateAndDeliverRequest.CreateAndDeliverRequestImRobotOpenSpaceModel buildRobotOpenSpaceModel(String lastMessage) {
        CreateAndDeliverRequest.CreateAndDeliverRequestImRobotOpenSpaceModel model =
                new CreateAndDeliverRequest.CreateAndDeliverRequestImRobotOpenSpaceModel()
                        .setSupportForward(true)
                        .setLastMessageI18n(TeaConverter.buildMap(new TeaPair(LAST_MESSAGE_LANGUAGE, lastMessage)));

        if (StringUtils.hasText(DEFAULT_SEARCH_ICON) || StringUtils.hasText(DEFAULT_SEARCH_DESC)) {
            model.setSearchSupport(new CreateAndDeliverRequest.CreateAndDeliverRequestImRobotOpenSpaceModelSearchSupport()
                    .setSearchIcon(DEFAULT_SEARCH_ICON)
                    .setSearchDesc(DEFAULT_SEARCH_DESC));
        }
        return model;
    }

    /**
     * 为调试用户注入卡片调试入口。
     * 结构对应钉钉文档中的：
     * privateData: { userId: { cardParamMap: { "_CARD_DEBUG_TOOL_ENTRY": "show" } } }
     */
    Map<String, PrivateDataValue> buildDebugPrivateData(String senderStaffId) {
        if (!StringUtils.hasText(senderStaffId)) {
            return Collections.emptyMap();
        }

        Map<String, String> debugCardParamMap = new LinkedHashMap<>();
        debugCardParamMap.put(CARD_DEBUG_TOOL_ENTRY_KEY, CARD_DEBUG_TOOL_ENTRY_VALUE);

        Map<String, PrivateDataValue> privateData = new LinkedHashMap<>();
        privateData.put(senderStaffId, new PrivateDataValue().setCardParamMap(debugCardParamMap));
        return privateData;
    }

    /**
     * 群聊卡片的空间模型。
     * 结构与单聊类似，但钉钉 SDK 使用独立的 imGroupOpenSpaceModel 类型。
     */
    private CreateAndDeliverRequest.CreateAndDeliverRequestImGroupOpenSpaceModel buildGroupOpenSpaceModel(String lastMessage) {
        CreateAndDeliverRequest.CreateAndDeliverRequestImGroupOpenSpaceModel model =
                new CreateAndDeliverRequest.CreateAndDeliverRequestImGroupOpenSpaceModel()
                        .setSupportForward(true)
                        .setLastMessageI18n(TeaConverter.buildMap(new TeaPair(LAST_MESSAGE_LANGUAGE, lastMessage)));

        if (StringUtils.hasText(DEFAULT_SEARCH_ICON) || StringUtils.hasText(DEFAULT_SEARCH_DESC)) {
            model.setSearchSupport(new CreateAndDeliverRequest.CreateAndDeliverRequestImGroupOpenSpaceModelSearchSupport()
                    .setSearchIcon(DEFAULT_SEARCH_ICON)
                    .setSearchDesc(DEFAULT_SEARCH_DESC));
        }
        return model;
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void streamingUpdateAssistantReply(
            DingtalkCardStreamSession session,
            String content,
            boolean isFinalize
    ) throws Exception {
        String normalizedContent = StringUtils.hasText(content) ? content : "";
        streamingUpdateCardField(session, STREAMING_UPDATE_CONTENT_KEY, normalizedContent, isFinalize);
    }

    /**
     * copyContent 必须对应卡片模板中已定义的公有变量。
     * 该字段不走 streamingUpdate，而是通过 updateCard 按 key 更新，
     * 避免复制字段参与流式状态机带来的平台兼容性问题。
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void updateCopyContent(
            DingtalkCardStreamSession session,
            String copyContent
    ) throws Exception {
        if (session == null || session.isFinalized()) {
            return;
        }

        String normalizedCopyContent = StringUtils.hasText(copyContent) ? copyContent : "";
        UpdateCardRequest updateCardRequest = new UpdateCardRequest()
                .setOutTrackId(session.getOutTrackId())
                .setUserIdType(1)
                .setCardData(new UpdateCardRequest.UpdateCardRequestCardData()
                        .setCardParamMap(Map.of(CARDPARAMMAP_COPYCONTENT_KEY, normalizedCopyContent)))
                .setCardUpdateOptions(new UpdateCardRequest.UpdateCardRequestCardUpdateOptions()
                        .setUpdateCardDataByKey(true));
        UpdateCardHeaders headers = new UpdateCardHeaders()
                .setXAcsDingtalkAccessToken(session.getAccessToken());
        com.aliyun.teautil.models.RuntimeOptions runtimeOptions = new com.aliyun.teautil.models.RuntimeOptions();
        runtimeOptions.setKeepAlive(true);

        try {
            session.getClient().updateCardWithOptions(updateCardRequest, headers, runtimeOptions);
        } catch (TeaException err) {
            if (!com.aliyun.teautil.Common.empty(err.code) && !com.aliyun.teautil.Common.empty(err.message)) {
                logger.error("DingTalk update copyContent failed. outTrackId={}, code={}, message={}",
                        session.getOutTrackId(), err.code, err.message);
            } else {
                logger.error("DingTalk update copyContent failed. outTrackId={}",
                        session.getOutTrackId(), err);
            }
            throw err;
        } catch (Exception _err) {
            TeaException err = new TeaException(_err.getMessage(), _err);
            if (!com.aliyun.teautil.Common.empty(err.code) && !com.aliyun.teautil.Common.empty(err.message)) {
                logger.error("DingTalk update copyContent failed. outTrackId={}, code={}, message={}",
                        session.getOutTrackId(), err.code, err.message);
            } else {
                logger.error("DingTalk update copyContent failed. outTrackId={}",
                        session.getOutTrackId(), err);
            }
            throw err;
        }
    }

    private void streamingUpdateCardField(
            DingtalkCardStreamSession session,
            String key,
            String content,
            boolean isFinalize
    ) throws Exception {
        if (session == null || session.isFinalized()) {
            return;
        }

        StreamingUpdateRequest streamingUpdateRequest = buildStreamingUpdateRequest(
                session.getOutTrackId(),
                UUID.randomUUID().toString(),
                key,
                content,
                isFinalize
        );
        StreamingUpdateHeaders headers = new StreamingUpdateHeaders().setXAcsDingtalkAccessToken(session.getAccessToken());
        com.aliyun.teautil.models.RuntimeOptions runtimeOptions = new com.aliyun.teautil.models.RuntimeOptions();
        runtimeOptions.setKeepAlive(true);

        try {
            session.getClient().streamingUpdateWithOptions(streamingUpdateRequest, headers, runtimeOptions);
            if (isFinalize) {
                session.setFinalized(true);
            }
        } catch (TeaException err) {
            if (!com.aliyun.teautil.Common.empty(err.code) && !com.aliyun.teautil.Common.empty(err.message)) {
                logger.error("DingTalk streaming update failed. outTrackId={}, key={}, isFinalize={}, code={}, message={}",
                        session.getOutTrackId(), key, isFinalize, err.code, err.message);
            } else {
                logger.error("DingTalk streaming update failed. outTrackId={}, key={}, isFinalize={}",
                        session.getOutTrackId(), key, isFinalize, err);
            }
            throw err;
        } catch (Exception _err) {
            TeaException err = new TeaException(_err.getMessage(), _err);
            if (!com.aliyun.teautil.Common.empty(err.code) && !com.aliyun.teautil.Common.empty(err.message)) {
                logger.error("DingTalk streaming update failed. outTrackId={}, key={}, isFinalize={}, code={}, message={}",
                        session.getOutTrackId(), key, isFinalize, err.code, err.message);
            } else {
                logger.error("DingTalk streaming update failed. outTrackId={}, key={}, isFinalize={}",
                        session.getOutTrackId(), key, isFinalize, err);
            }
            throw err;
        }
    }

    private CreateAndDeliverHeaders buildCreateAndDeliverHeaders(String accessToken) {
        CreateAndDeliverHeaders headers = new CreateAndDeliverHeaders();
        headers.xAcsDingtalkAccessToken = accessToken;
        return headers;
    }

    /**
     * 用于消息列表和搜索结果中的摘要文案。
     * 优先使用“来自某智能体的回复”，否则回退默认文案。
     */
    private String buildCardLastMessage(String agentName) {
        if (StringUtils.hasText(agentName)) {
            return "来自 " + agentName + " 的回复";
        }
        return DEFAULT_LAST_MESSAGE;
    }

    String resolveCardTemplateId(String robotCode) {
        if (StringUtils.hasText(robotCode)) {
            try {
                String configuredCardTemplateId = dingtalkRobotConfigService.getRobotConfig(robotCode).getCardTemplateId();
                if (StringUtils.hasText(configuredCardTemplateId)) {
                    return configuredCardTemplateId;
                }
            } catch (IllegalStateException e) {
                logger.debug("DingTalk robot config not found when resolving card template. robotCode={}", robotCode);
            }
        }
        return CARD_TEMPLATE_ID;
    }

    private String resolveOutTrackId(String robotCode, String senderStaffId, String conversationType) {
        String channelType = GROUP_CHAT_TYPE.equals(conversationType) ? "group" : "single";
        return robotCode + "-" + senderStaffId + "-" + channelType + "-assistantReply-" + System.currentTimeMillis();
    }

    private Client createClient() throws Exception {
        Config config = new Config();
        config.protocol = "https";
        config.regionId = "central";
        return new Client(config);
    }
}
