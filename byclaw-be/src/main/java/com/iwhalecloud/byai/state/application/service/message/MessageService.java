package com.iwhalecloud.byai.state.application.service.message;

import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.FORWARD_TYPE;
import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.SYSTEM_RESPONSE;
import static com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum.USER_INPUT;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.common.message.qo.MessageRelObjQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.message.model.ForwardMessageDtoDto;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.message.model.MessageFeedbackDto;
import com.iwhalecloud.byai.state.domain.message.model.FeedbackDto;
import com.iwhalecloud.byai.state.domain.message.model.GroupChatResponse;
import com.iwhalecloud.byai.state.domain.message.model.GroupChatVo;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.manager.qo.showcase.ShowcaseQueryParam;
import com.iwhalecloud.byai.state.domain.showcase.service.ShowcaseService;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.manager.vo.showcase.ByaiShowcaseVo;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.common.util.ListUtil;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.application.service.session.SessionApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ContentVo;
import com.iwhalecloud.byai.state.domain.chat.dto.ExternalMessageVo;
import com.iwhalecloud.byai.state.domain.chat.dto.FeedbackTypeDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.enums.FeedbackField;
import com.iwhalecloud.byai.state.domain.message.enums.PraiseAndTreadEnum;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.MessageContentHandlerFactory;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.session.dto.MessageDto;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import lombok.extern.slf4j.Slf4j;

/**
 * <br>
 * <Description of the type></br>
 *
 * @author track
 * @version 1.0
 * @taskId 1.0
 * @createDate 2025/4/2
 * @see com.ztesoft
 * @since 1.0
 */
@Service
@Slf4j
public class MessageService {

    @Autowired
    private MemoryMessageService memoryMessageService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SessionApplicationService sessionApplicationService;

    @Autowired
    private ShowcaseService showcaseService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private ByaiMessageRelObjService byaiMessageRelObjService;

    /**
     * 转发历史记录
     *
     * @param byaiMessageHotDto
     */
    private List<ByaiMessageHotDto> forwardHistoryRecord(ByaiMessageHotDto byaiMessageHotDto) {
        if (byaiMessageHotDto == null) {
            return Collections.emptyList();
        }
        List<Long> forwardMsgIds = extractForwardMsgIds(byaiMessageHotDto);
        if (CollectionUtils.isEmpty(forwardMsgIds)) {
            return Collections.emptyList();
        }
        List<Long> distinctForwardMsgIds = forwardMsgIds.stream().distinct().collect(Collectors.toList());

        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setMessageIds(distinctForwardMsgIds);
        List<ByaiMessageHotDto> forwardMessages = byaiMessageHotService.findByQo(messageHotQo);
        return processForwardMessages(byaiMessageHotDto, forwardMessages);
    }

    private List<Long> extractForwardMsgIds(ByaiMessageHotDto byaiMessageHotDto) {
        List<Long> forwardMsgIds = Collections.synchronizedList(new ArrayList<>());
        if (!Objects.equals(byaiMessageHotDto.getUsage(), FORWARD_TYPE.getCode())) {
            return Collections.emptyList();
        }
        processMetadataForMsgIds(byaiMessageHotDto.getMetadata(), forwardMsgIds);
        return forwardMsgIds;
    }

    private void processMetadataForMsgIds(String metadata, List<Long> forwardMsgIds) {
        if (StringUtils.isBlank(metadata)) {
            return;
        }

        Map<String, Object> jsonObject = JSONObject.parseObject(metadata);
        if (jsonObject == null) {
            return;
        }
        String forwardMsgIdsStr = MapUtils.getString(jsonObject, "forwardMsgIds");

        if (StringUtils.isNotBlank(forwardMsgIdsStr)) {
            parseAndAddMsgIds(forwardMsgIdsStr, forwardMsgIds);
        }
    }

    private void parseAndAddMsgIds(String idsStr, List<Long> forwardMsgIds) {
        try {
            List<Long> ids = Arrays.stream(idsStr.split(",")).map(String::trim).map(Long::parseLong).toList();
            if (!ids.isEmpty()) {
                forwardMsgIds.addAll(ids);
            }
        }
        catch (NumberFormatException e) {
            log.error("非法数据：{}", idsStr);
        }
    }

    private List<ByaiMessageHotDto> processForwardMessages(ByaiMessageHotDto byaiMessageHotDto,
        List<ByaiMessageHotDto> forwardMessages) {
        Map<Long, ByaiMessageHotDto> messageDtoMap = forwardMessages.stream()
            .collect(Collectors.toMap(ByaiMessageHotDto::getMessageId, dto -> dto, (v1, v2) -> v1));
        return processItemForwardMessages(byaiMessageHotDto, messageDtoMap);
    }

    private List<ByaiMessageHotDto> processItemForwardMessages(ByaiMessageHotDto byaiMessageHotDto,
        Map<Long, ByaiMessageHotDto> messageDtoMap) {
        String metadata = byaiMessageHotDto.getMetadata();
        if (StringUtils.isBlank(metadata)) {
            return Collections.emptyList();
        }

        Map<String, Object> jsonObject = JSONObject.parseObject(metadata);
        String forwardMsgIdsStr = MapUtils.getString(jsonObject, "forwardMsgIds");

        if (StringUtils.isNotBlank(forwardMsgIdsStr)) {
            return this.createForwardList(forwardMsgIdsStr, messageDtoMap);
        }
        return Collections.emptyList();
    }

    private List<ByaiMessageHotDto> createForwardList(String idsStr, Map<Long, ByaiMessageHotDto> messageDtoMap) {
        List<ByaiMessageHotDto> forwardList = new ArrayList<>();
        try {
            List<Long> ids = Arrays.stream(idsStr.split(",")).map(String::trim).map(Long::parseLong).toList();

            if (ids != null) {
                ids.stream().filter(Objects::nonNull).map(messageDtoMap::get).filter(Objects::nonNull)
                    .forEach(forwardList::add);
            }
        }
        catch (NumberFormatException e) {
            log.error("非法数据：{}", idsStr);
        }
        return forwardList;
    }

    /**
     * 获取消息列表
     *
     * @param messageQo 消息查询条件
     * @return 分页消息列表，包含代理头像信息
     */
    public PageInfo<ByaiMessageHotDtoDto> getMessages(MessageQo messageQo) {

        MessageHotPageQo messageHotPageQo = new MessageHotPageQo();
        messageHotPageQo.setPageNum(messageQo.getPageNum().intValue());
        messageHotPageQo.setPageSize(messageQo.getPageSize().intValue());
        messageHotPageQo.setSessionId(messageQo.getSessionId());
        PageInfo<ByaiMessage> byaiMessagePageInfo = byaiMessageHotService
            .selectByPageQo(messageHotPageQo);

        PageInfo<ByaiMessageHotDtoDto> pageInfo = new PageInfo<>();
        pageInfo.setPageNum(byaiMessagePageInfo.getPageNum());
        pageInfo.setPageSize(byaiMessagePageInfo.getPageSize());
        pageInfo.setTotal(byaiMessagePageInfo.getTotal());
        List<ByaiMessage> list = byaiMessagePageInfo.getList();
        List<ByaiMessageHotDto> byaiMessageHotDtos = new ArrayList<>();
        if (CollectionUtils.isNotEmpty(list)) {
            for (ByaiMessage byaiMessage : list) {
                ByaiMessageHotDto dto = new ByaiMessageHotDto();
                BeanUtils.copyProperties(byaiMessage, dto);
                byaiMessageHotDtos.add(dto);
            }
        }

        // 补充收藏信息
        pageInfo.setList(this.appendCollectInfo(byaiMessageHotDtos, messageQo.getSessionId()));

        return pageInfo;

    }

    private List<ByaiMessageHotDtoDto> appendCollectInfo(List<ByaiMessageHotDto> byaiMessageHots, Long sessionId) {

        if (ListUtil.isEmpty(byaiMessageHots)) {
            return Collections.emptyList();
        }

        List<Long> messageIds = new ArrayList<>();

        List<ByaiMessageHotDtoDto> byaiMessageHotDtoDtos = new ArrayList<>();
        for (ByaiMessageHotDto byaiMessageHot : byaiMessageHots) {
            ByaiMessageHotDtoDto byaiMessageHotDto = new ByaiMessageHotDtoDto();
            BeanUtils.copyProperties(byaiMessageHot, byaiMessageHotDto);
            byaiMessageHotDtoDtos.add(byaiMessageHotDto);

            messageIds.add(byaiMessageHot.getMessageId());
        }

        ShowcaseQueryParam param = new ShowcaseQueryParam();
        param.setSessionId(sessionId);
        param.setMessageIds(messageIds);
        param.setStatus(1);
        List<ByaiShowcaseVo> byaiShowcaseList = showcaseService.getByaiShowcaseList(param);

        Map<Long, List<String>> fileCodeMap = byaiShowcaseList.stream()
            .filter(showcase -> showcase.getMessageId() != null)
            .collect(Collectors.groupingBy(ByaiShowcase::getMessageId, Collectors.mapping(ByaiShowcase::getFileCode,
                Collectors.collectingAndThen(Collectors.toCollection(ArrayList::new), codes -> {
                    List<String> mutableCodes = new ArrayList<>(codes);
                    mutableCodes.removeIf(StringUtils::isBlank);
                    return mutableCodes;
                }))));

        byaiMessageHotDtoDtos.forEach(message -> {
            List<String> collectIds = fileCodeMap.getOrDefault(message.getMessageId(), new ArrayList<>());
            message.setCollectIds(collectIds);
        });

        return byaiMessageHotDtoDtos;
    }

    /**
     * 获取消息列表
     *
     * @param messageId 消息查询条件
     * @return 分页消息列表，包含代理头像信息
     */
    public List<ForwardMessageDtoDto> getForwardMessages(Long messageId) {
        // 从记忆引擎获取消息列表

        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(messageId);

        ForwardMessageDtoDto forwardMessageDto = new ForwardMessageDtoDto();
        BeanUtils.copyProperties(byaiMessageHotDto, forwardMessageDto);
        // 转发历史记录
        forwardMessageDto.setForwardMsgList(forwardHistoryRecord(byaiMessageHotDto));

        return Collections.singletonList(forwardMessageDto);
    }

    public List<ByaiMessageHotDto> getChatHistory(List<Long> messageIds) {
        // 从记忆引擎获取消息列表
        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setMessageIds(messageIds);
        return byaiMessageHotService.findByQo(messageHotQo);
    }

    /**
     * 更新消息反馈信息（点赞/点踩）
     *
     * @param sessionOpeartorDto 会话操作信息
     * @param praiseAndTreadEnum 点赞/点踩枚举
     * @param byaiMessageHotDto 消息数据
     * @return 更新后的metadata信息
     */
    public String updateMessage(SessionOpeartorDto sessionOpeartorDto, PraiseAndTreadEnum praiseAndTreadEnum,
        ByaiMessageHotDto byaiMessageHotDto) {

        // 解析现有metadata信息
        Map<String, Object> metadataMap = JSONObject.parseObject(byaiMessageHotDto.getMetadata());
        if (MapUtils.isEmpty(metadataMap)) {
            metadataMap = new HashMap<>();
        }

        // 获取消息索引信息
        ByaiMessageRelObjDto byaiMessageRelObjDto = this.getMessageIndexForFeedback(byaiMessageHotDto);

        // 构建反馈信息
        this.buildMetadata(metadataMap, sessionOpeartorDto, praiseAndTreadEnum, byaiMessageRelObjDto);
        byaiMessageHotDto.setMetadata(JSONObject.toJSONString(metadataMap));

        // 更新消息内容
        byaiMessageHotService.updateSelective(byaiMessageHotDto);

        // 更新消息关联索引
        byaiMessageRelObjService.updateFeedback(byaiMessageRelObjDto);

        return byaiMessageHotDto.getMetadata();
    }

    /**
     * 更新消息反馈信息（已解决/未解决）
     *
     * @param msgFeedbackDto 消息反馈信息
     * @param praiseAndTreadEnum 已解决/未解决枚举
     * @param byaiMessageHotDto 消息数据
     * @return 更新后的metadata信息
     */
    public String updateMesFeedback(MessageFeedbackDto msgFeedbackDto, PraiseAndTreadEnum praiseAndTreadEnum,
        ByaiMessageHotDto byaiMessageHotDto) {

        // 解析现有metadata信息
        Map<String, Object> metadataMap = JSONObject.parseObject(byaiMessageHotDto.getMetadata());
        if (MapUtils.isEmpty(metadataMap)) {
            metadataMap = new HashMap<>();
        }
        log.info("updateMesFeedback messageService updateMesFeedback metadataMap: {}", metadataMap.toString());

        // 获取消息索引信息
        ByaiMessageRelObjDto byaiMessageRelObjDto = getMessageIndexForFeedback(byaiMessageHotDto);
        if (byaiMessageRelObjDto == null) {
            Long taskId = byaiMessageHotDto.getTaskId();
            log.error("未找到消息索引信息，taskId：{}", taskId);
            throw new BdpRuntimeException("消息索引信息不存在，taskId: " + taskId);
        }
        // 构建反馈信息
        this.buildMetadata(metadataMap, msgFeedbackDto, praiseAndTreadEnum, byaiMessageRelObjDto);
        byaiMessageHotDto.setMetadata(JSONObject.toJSONString(metadataMap));
        log.info("updateMesFeedback messageService updateMesFeedback metadataMap 修改后: {}", metadataMap.toString());

        // 更新消息容
        byaiMessageHotService.updateSelective(byaiMessageHotDto);

        // 更新消息关联索引
        byaiMessageRelObjService.updateFeedback(byaiMessageRelObjDto);

        return byaiMessageHotDto.getMetadata();
    }

    /**
     * 根据任务ID获取消息索引信息
     *
     * @param taskId 任务ID
     * @return 消息索引信息，如果不存在则返回null
     */
    private ByaiMessageRelObjDto getMessageIndexByTaskId(Long taskId) {

        MessageRelObjQo messageRelObjQo = new MessageRelObjQo();
        messageRelObjQo.setTaskIds(Collections.singletonList(taskId));
        List<ByaiMessageRelObjDto> byaiMessageRelObjDtos = byaiMessageRelObjService.findByQo(messageRelObjQo);

        return ListUtil.isNotEmpty(byaiMessageRelObjDtos) ? byaiMessageRelObjDtos.get(0) : null;
    }

    /**
     * 获取待更新反馈的消息索引。
     * 优先使用当前反馈消息 ID 精确定位问答关系，避免同一 taskId 下多条关系记录时误写到其他问答。
     *
     * @param byaiMessageHotDto 消息数据
     * @return 消息索引信息，如果不存在则返回 null
     */
    private ByaiMessageRelObjDto getMessageIndexForFeedback(ByaiMessageHotDto byaiMessageHotDto) {
        if (byaiMessageHotDto == null) {
            return null;
        }
        Long messageId = byaiMessageHotDto.getMessageId();
        ByaiMessageRelObjDto messageRel = getMessageIndexByMessageId(messageId);
        if (messageRel != null) {
            return messageRel;
        }
        return getMessageIndexByTaskId(byaiMessageHotDto.getTaskId());
    }

    private ByaiMessageRelObjDto getMessageIndexByMessageId(Long messageId) {
        if (messageId == null) {
            return null;
        }
        ByaiMessageRelObjDto rel = getMessageIndexByResMsgId(messageId);
        if (rel != null) {
            return rel;
        }
        return getMessageIndexByAskMsgId(messageId);
    }

    private ByaiMessageRelObjDto getMessageIndexByResMsgId(Long resMsgId) {
        MessageRelObjQo messageRelObjQo = new MessageRelObjQo();
        messageRelObjQo.setResMsgIds(Collections.singletonList(String.valueOf(resMsgId)));
        List<ByaiMessageRelObjDto> byaiMessageRelObjDtos = byaiMessageRelObjService.findByQo(messageRelObjQo);
        return ListUtil.isNotEmpty(byaiMessageRelObjDtos) ? byaiMessageRelObjDtos.get(0) : null;
    }

    private ByaiMessageRelObjDto getMessageIndexByAskMsgId(Long askMsgId) {
        MessageRelObjQo messageRelObjQo = new MessageRelObjQo();
        messageRelObjQo.setAskMsgIds(Collections.singletonList(String.valueOf(askMsgId)));
        List<ByaiMessageRelObjDto> byaiMessageRelObjDtos = byaiMessageRelObjService.findByQo(messageRelObjQo);
        return ListUtil.isNotEmpty(byaiMessageRelObjDtos) ? byaiMessageRelObjDtos.get(0) : null;
    }

    /**
     * 构建消息反馈的元数据信息
     *
     * @param metadataMap 元数据映射
     * @param sessionOpeartorDto 会话操作信息
     * @param praiseAndTreadEnum 点赞/点踩枚举
     * @param byaiMessageRelObjDto 消息索引信息
     */
    private void buildMetadata(Map<String, Object> metadataMap, SessionOpeartorDto sessionOpeartorDto,
        PraiseAndTreadEnum praiseAndTreadEnum, ByaiMessageRelObjDto byaiMessageRelObjDto) {

        switch (praiseAndTreadEnum) {
            case TREAD:
            case PRAISE:
                // 移除现有反馈信息并添加新的反馈
                removeFeedback(metadataMap, byaiMessageRelObjDto);
                metadataMap.put(praiseAndTreadEnum.getType(), CurrentUserHolder.getCurrentUserId());
                appendFeedback(metadataMap, sessionOpeartorDto, byaiMessageRelObjDto);
                break;
            case None:
                // 移除所有反馈信息
                removeFeedback(metadataMap, byaiMessageRelObjDto);
                break;
            default:
                break;
        }
    }

    /**
     * 构建消息反馈的元数据信息
     *
     * @param metadataMap 元数据映射
     * @param msgFeedbackDto 消息反馈信息
     * @param praiseAndTreadEnum 点赞/点踩枚举
     * @param byaiMessageRelObjDto 消息索引信息
     */
    private void buildMetadata(Map<String, Object> metadataMap, MessageFeedbackDto msgFeedbackDto,
        PraiseAndTreadEnum praiseAndTreadEnum, ByaiMessageRelObjDto byaiMessageRelObjDto) {

        switch (praiseAndTreadEnum) {
            case TREAD:
                // 移除现有反馈信息并添加新的反馈
                removeFeedback(metadataMap, byaiMessageRelObjDto);
                metadataMap.put(praiseAndTreadEnum.getType(), CurrentUserHolder.getCurrentUserId());
                appendFeedback(metadataMap, msgFeedbackDto, byaiMessageRelObjDto);
                break;
            case PRAISE:
                // 移除现有反馈信息并添加新的反馈
                removeFeedback(metadataMap, byaiMessageRelObjDto);
                appendFeedback(metadataMap, msgFeedbackDto, byaiMessageRelObjDto);
                break;
            case None:
                // 移除所有反馈信息
                removeFeedback(metadataMap, byaiMessageRelObjDto);
                break;
            default:
                break;
        }
    }

    /**
     * 移除所有反馈内容字段
     *
     * @param metadataMap 元数据映射
     * @param byaiMessageRelObjDto 消息索引信息
     */
    private void removeFeedback(Map<String, Object> metadataMap, ByaiMessageRelObjDto byaiMessageRelObjDto) {
        // 移除点赞点踩类型值
        metadataMap.remove("tread");
        metadataMap.remove("praise");

        // 移除反馈的所有字段值
        List<String> allFieldNames = FeedbackField.getAllFieldNames();
        for (String fieldName : allFieldNames) {
            metadataMap.remove(fieldName);
        }

        // 清除消息索引中的反馈信息
        this.removeFeedback(byaiMessageRelObjDto);
    }

    /**
     * 清除消息索引中的反馈信息
     *
     * @param byaiMessageRelObjDto 消息索引信息
     */
    private void removeFeedback(ByaiMessageRelObjDto byaiMessageRelObjDto) {
        if (null != byaiMessageRelObjDto) {
            byaiMessageRelObjDto.setFeedbackType(null);
            byaiMessageRelObjDto.setFeedbackTime(null);
            byaiMessageRelObjDto.setFeedbackLabel(null);
            byaiMessageRelObjDto.setFeedbackScore(null);
            byaiMessageRelObjDto.setFeedbackContent(null);
        }
    }

    /**
     * 添加反馈信息到元数据和索引中
     *
     * @param metadataMap 元数据映射
     * @param sessionOpeartorDto 会话操作信息
     * @param byaiMessageRelObjDto 消息索引信息
     */
    private void appendFeedback(Map<String, Object> metadataMap, SessionOpeartorDto sessionOpeartorDto,
        ByaiMessageRelObjDto byaiMessageRelObjDto) {
        FeedbackDto feedbackContent = sessionOpeartorDto.getFeedback();

        // 设置反馈类型
        metadataMap.put("feedback_type", sessionOpeartorDto.getType());
        byaiMessageRelObjDto.setFeedbackType(sessionOpeartorDto.getType());

        if (null == feedbackContent) {
            return;
        }

        // 只有点踩时才添加详细反馈信息
        if (PraiseAndTreadEnum.TREAD.getType().equalsIgnoreCase(sessionOpeartorDto.getType())) {
            // 设置元数据中的反馈信息
            metadataMap.put("feedback_content", feedbackContent.getFeedbackContent());
            metadataMap.put("feedback_score", feedbackContent.getFeedbackScore());
            metadataMap.put("feedback_con_mark", feedbackContent.getFeedbackConMark());
            metadataMap.put("feedback_label", feedbackContent.getFeedbackLabel());

            // 添加索引表的反馈信息
            byaiMessageRelObjDto.setFeedbackContent(feedbackContent.getFeedbackContent());
            byaiMessageRelObjDto.setFeedbackScore(feedbackContent.getFeedbackScore());
            byaiMessageRelObjDto.setFeedbackTime(DateUtils.formatDate(new Date(), DateUtils.DATE_TIME_FORMAT));
            byaiMessageRelObjDto.setFeedbackLabel(feedbackContent.getFeedbackLabel());
        }
    }

    /**
     * 添加反馈信息到元数据和索引中
     *
     * @param metadataMap 元数据映射
     * @param messageFeedbackDto 消息反馈信息
     * @param byaiMessageRelObjDto 消息索引信息
     */
    private void appendFeedback(Map<String, Object> metadataMap, MessageFeedbackDto messageFeedbackDto,
        ByaiMessageRelObjDto byaiMessageRelObjDto) {
        String feedbackType = messageFeedbackDto.getType();
        String feedbackContent = messageFeedbackDto.getFeedbackContent();
        String feedbackLabel = messageFeedbackDto.getFeedbackLabel();

        // 设置反馈类型
        metadataMap.put("feedback_type", feedbackType);
        byaiMessageRelObjDto.setFeedbackType(feedbackType);

        // 只有点踩时才添加详细反馈信息
        if (PraiseAndTreadEnum.TREAD.getType().equalsIgnoreCase(feedbackType)) {
            // 设置元数据中的反馈信息
            metadataMap.put("feedback_content", feedbackContent);
            metadataMap.put("feedback_label", feedbackLabel);

            // 添加索引表的反馈信息
            byaiMessageRelObjDto.setFeedbackContent(feedbackContent);
            byaiMessageRelObjDto.setFeedbackTime(DateUtils.formatDate(new Date(), DateUtils.DATE_TIME_FORMAT));
            byaiMessageRelObjDto.setFeedbackLabel(List.of(feedbackLabel));
        }
    }

    /**
     * 删除指定消息
     *
     * @param messageId 消息ID
     */
    public void deleteMessage(String messageId) {
        byaiMessageHotService.deleteById(Long.parseLong(messageId));
    }

    /**
     * 添加或更新外部消息
     *
     * @param externalMessageVo 外部消息信息
     * @return 消息操作响应
     */
    public ByaiMessageHotDto addOrUpdateMessage(ExternalMessageVo externalMessageVo) {

        ByaiMessageHotDto byaiMessageHotDto = new ByaiMessageHotDto();

        // 从content中获取数据用于后续生成消息结构体
        ContentVo contentVo = externalMessageVo.getContent();
        Long messageId = externalMessageVo.getMessageId();

        // 设置消息ID（如果为空则生成新ID）
        byaiMessageHotDto.setMessageId(null == messageId ? sequenceService.nextVal() : messageId);

        // 处理消息内容
        String contentType = contentVo.getContentType();
        String content = MessageContentHandlerFactory.getHandler(contentType).handle(contentVo.getContent());
        byaiMessageHotDto.setMessageContent(content);
        byaiMessageHotDto.setSessionId(externalMessageVo.getSessionId());
        byaiMessageHotDto.setCreatorId(CurrentUserHolder.getCurrentUserId());

        // 生成消息结构体，供前端调用
        byaiMessageHotDto.setMessageStruct(generateMsgStruct(contentVo));

        // 设置消息标签
        byaiMessageHotDto.setMetadata(generateMetadata(externalMessageVo.getAgentId()));
        byaiMessageHotDto.setCreateTime(new Date());

        // usage默认是系统问答
        byaiMessageHotDto.setUsage(SYSTEM_RESPONSE.getCode());

        // 第三方平台的默认是agent-user类型
        byaiMessageHotDto.setRole(Constants.ROLE_AGENT_TO_USER);

        if (messageId != null) {
            // 修改message消息
            byaiMessageHotService.updateSelective(byaiMessageHotDto);
        }
        else {
            byaiMessageHotService.add(byaiMessageHotDto);
        }

        return byaiMessageHotDto;
    }

    /**
     * 生成消息元数据标签（来源端-目标端格式）
     *
     * @param agentId 代理ID
     * @return JSON格式的元数据字符串
     */
    public String generateMetadata(String agentId) {
        Map<String, Object> metadata = new HashMap<>();
        StringBuilder stringBuilder = new StringBuilder();
        Long userId = CurrentUserHolder.getCurrentUserId();
        // 构建角色标签：agent-agentId-userId
        stringBuilder.append(Constants.MSG_AGENT).append(agentId).append(Constants.MSG_SPLICE)
            .append(String.valueOf(userId));
        metadata.put(Constants.MSG_ROLE, stringBuilder.toString());

        return JSONObject.toJSONString(metadata);
    }

    /**
     * 生成消息结构体（供前端调用）
     *
     * @param contentMap 内容信息
     * @return JSON格式的消息结构体字符串
     */
    public String generateMsgStruct(ContentVo contentMap) {
        Map<String, Object> res = new HashMap<>();
        List<Map> choiceList = new ArrayList<>();
        Map<String, Object> delta = new HashMap<>();
        Map<String, Object> content = new HashMap<>();

        // 构建delta内容
        delta.put("content", contentMap.getContent());
        content.put("delta", delta);
        choiceList.add(content);
        res.put("choices", choiceList);
        // 设置内容类型
        res.put("contentType", contentMap.getContentType());
        return JSONObject.toJSONString(res);
    }

    public AnswerDelta generateMsgAnswerDelta(ContentVo contentMap) {
        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setContentType(contentMap.getContentType());
        DeltaDto deltaDto = new DeltaDto(contentMap.getContent());
        ChoiceDto choiceDto = new ChoiceDto();
        choiceDto.setDelta(deltaDto);
        answerDelta.setChoices(Lists.newArrayList(choiceDto));
        return answerDelta;
    }

    /**
     * 获取内容反馈类型配置
     *
     * @return 按参数类型分组的反馈类型列表
     */
    public Map<String, List<FeedbackTypeDto>> getContentFeedbackType() {
        // 获取系统配置中的反馈类型
        List<ByaiSystemConfigList> values = byaiSystemConfigService.findByParamGroupCode(Constants.FEEDBACK_TYPE);
        if (CollectionUtils.isEmpty(values)) {
            return new HashMap<>();
        }

        Map<String, List<FeedbackTypeDto>> res = new HashMap<>();

        // 按参数类型分组配置
        Map<String, List<ByaiSystemConfigList>> groupedConfigs = values.stream()
            .filter(config -> config.getParamGroupCode() != null)
            .collect(Collectors.groupingBy(ByaiSystemConfigList::getParamGroupCode));

        // 处理每个分组，按序号排序并转换为DTO
        groupedConfigs.forEach((paramGroupCode, configs) -> {
            configs.sort(Comparator.comparing(ByaiSystemConfigList::getParamSeq,
                Comparator.nullsLast(Comparator.naturalOrder())));
            configs.forEach(config -> {
                FeedbackTypeDto feedbackTypeDto = new FeedbackTypeDto();
                BeanUtils.copyProperties(config, feedbackTypeDto);
                feedbackTypeDto.setParamCode(config.getParamValue());
                res.computeIfAbsent(paramGroupCode, list -> {
                    return new ArrayList<>();
                }).add(feedbackTypeDto);
            });
        });
        return res;
    }

    /**
     * 通过 WebClient 代理下游流式接口，返回 流式数据 实现流式输出
     *
     * @param res 输出流
     * @param messageDto 消息参数
     * @throws IOException 如果发生IO异常
     */
    public void getMessageStream(OutputStream res, MessageDto messageDto) throws IOException {
        try (BufferedReader bufferedReader = getSseBufferedReader(messageDto)) {
            String line;
            while ((line = bufferedReader.readLine()) != null) {
                // line 已经是 "data: ..." 格式
                res.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                res.flush();
            }
        }
        catch (IOException e) {
            log.error("流处理异常", e);
            throw e;
        }
    }

    public BufferedReader getSseBufferedReader(MessageDto messageDto) {
        InputStream inputStream = memoryMessageService.messageStream(messageDto);
        try {
            return new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
        }
        catch (Exception e) {
            try {
                inputStream.close();
            }
            catch (IOException ex) {
                log.error("关闭流失败", ex);
            }
            throw e;
        }
    }

    /**
     * 群聊中任务发送的消息
     *
     * @param groupChatVo
     * @return
     */
    public GroupChatResponse addMessage(GroupChatVo groupChatVo) {
        // 构建入参
        GroupChatResponse groupChatResponse = new GroupChatResponse();
        BeanUtils.copyProperties(groupChatVo, groupChatResponse);
        MessageContext userContext = new MessageContext(AgentTypeEnum.AGENT, sequenceService.nextVal());
        userContext.setAnswerText(new StringBuilder(groupChatVo.getChatContent()));
        userContext.setMentionUserIds(groupChatVo.getMentionUserIds());
        userContext.setTaskId(groupChatVo.getTaskId());
        userContext.setResComIds(groupChatVo.getResComIds());
        userContext.setMsgStatus(groupChatVo.getMsgStatus());
        userContext.setCallLogs(groupChatVo.getCallLogs());
        userContext.setUploadFiles(groupChatVo.getFiles());
        if (groupChatVo.getMessageStruct() != null) {
            // 由于你的 JSON 是一个数组，首先需要解析为 JSONArray
            List<AnswerDelta> answerDeltaList = JSON.parseArray(groupChatVo.getMessageStruct(), AnswerDelta.class);
            userContext.setAnswerMessageList(answerDeltaList);
        }
        Integer usage = Objects.isNull(groupChatVo.getUsage()) ? USER_INPUT.getCode() : groupChatVo.getUsage();
        // 保存消息
        ByaiMessageHotDto messageDto = memoryMessageService.save(groupChatVo.getSessionId(), usage, userContext,
            new AssistantChatDto());
        groupChatResponse.setMessageId(messageDto.getMessageId());

        SessionOpeartorDto sessionOpeartorDto = new SessionOpeartorDto();
        sessionOpeartorDto.setSessionId(messageDto.getSessionId());
        sessionOpeartorDto.setSessionContent(ChatUtils.truncateString(groupChatVo.getChatContent(), 50));
        sessionApplicationService.updateConversationAsync(sessionOpeartorDto);
        return groupChatResponse;
    }

    /**
     * 获取公共消息内容 - 免登录接口
     *
     * @param messageId 消息ID
     * @param segment 段落标识
     * @return HTML格式的消息内容
     */
    public String getMessageContent(Long messageId, Integer segment) {
        log.info("开始获取公共消息内容 - messageId: {}, segment: {}", messageId, segment);

        try {
            // 调用记忆引擎接口获取消息详情

            ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(messageId);
            if (byaiMessageHotDto == null) {
                return buildErrorHtml("消息不存在，messageId: " + messageId);
            }

            // 直接获取消息内容
            String content = byaiMessageHotDto.getMessageContent();
            if (StringUtils.isBlank(content)) {
                return buildErrorHtml("消息内容为空，messageId: " + messageId);
            }

            // 解析HTML代码并返回对应的segment
            return parseHtmlFromContent(content, segment);

        }
        catch (Exception e) {
            log.error("获取公共消息内容失败 - messageId: {}, segment: {}, error: {}", messageId, segment, e.getMessage(), e);
            return buildErrorHtml("获取消息内容失败: " + e.getMessage());
        }
    }

    /**
     * 从消息内容中解析HTML代码
     *
     * @param content 消息内容
     * @param segment 段落标识
     * @return 对应的HTML代码
     */
    private String parseHtmlFromContent(String content, Integer segment) {
        try {
            // 查找所有HTML代码块
            List<String> htmlBlocks = extractHtmlBlocks(content);

            if (htmlBlocks.isEmpty()) {
                return buildErrorHtml("消息内容中未找到HTML代码");
            }

            // 根据segment参数返回对应的HTML代码
            if (segment < 1 || segment > htmlBlocks.size()) {
                return buildErrorHtml("segment参数超出范围，有效范围：1-" + htmlBlocks.size());
            }

            String htmlCode = htmlBlocks.get(segment - 1);
            log.info("成功解析HTML代码 - segment: {}, htmlLength: {}", segment, htmlCode.length());

            return htmlCode;

        }
        catch (Exception e) {
            log.error("解析HTML代码失败 - segment: {}, error: {}", segment, e.getMessage(), e);
            return buildErrorHtml("解析HTML代码失败: " + e.getMessage());
        }
    }

    /**
     * 从内容中提取HTML代码块
     *
     * @param content 消息内容
     * @return HTML代码块列表
     */
    private List<String> extractHtmlBlocks(String content) {
        List<String> htmlBlocks = new ArrayList<>();

        // 使用正则表达式匹配HTML代码块
        // 匹配 ```html 和 ``` 之间的内容
        String pattern = "```html\\s*([\\s\\S]*?)```";
        java.util.regex.Pattern htmlPattern = java.util.regex.Pattern.compile(pattern,
            java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher matcher = htmlPattern.matcher(content);

        while (matcher.find()) {
            String htmlCode = matcher.group(1).trim();
            if (StringUtils.isNotBlank(htmlCode)) {
                htmlBlocks.add(htmlCode);
            }
        }

        // 如果没有找到 ```html 格式的代码块，尝试查找其他HTML标识
        if (htmlBlocks.isEmpty()) {
            // 尝试匹配 <!DOCTYPE html> 开头的完整HTML文档
            String doctypePattern = "<!DOCTYPE\\s+html[\\s\\S]*?</html>";
            java.util.regex.Pattern doctypeHtmlPattern = java.util.regex.Pattern.compile(doctypePattern,
                java.util.regex.Pattern.CASE_INSENSITIVE);
            java.util.regex.Matcher doctypeMatcher = doctypeHtmlPattern.matcher(content);

            while (doctypeMatcher.find()) {
                String htmlCode = doctypeMatcher.group(0).trim();
                if (StringUtils.isNotBlank(htmlCode)) {
                    htmlBlocks.add(htmlCode);
                }
            }
        }

        // 如果还是没有找到，尝试匹配 <html> 标签
        if (htmlBlocks.isEmpty()) {
            String htmlTagPattern = "<html[\\s\\S]*?</html>";
            java.util.regex.Pattern htmlTagHtmlPattern = java.util.regex.Pattern.compile(htmlTagPattern,
                java.util.regex.Pattern.CASE_INSENSITIVE);
            java.util.regex.Matcher htmlTagMatcher = htmlTagHtmlPattern.matcher(content);

            while (htmlTagMatcher.find()) {
                String htmlCode = htmlTagMatcher.group(0).trim();
                if (StringUtils.isNotBlank(htmlCode)) {
                    htmlBlocks.add(htmlCode);
                }
            }
        }

        log.info("提取到HTML代码块数量: {}", htmlBlocks.size());
        return htmlBlocks;
    }

    /**
     * 构建错误HTML页面
     *
     * @param errorMessage 错误信息
     * @return 错误HTML页面
     */
    private String buildErrorHtml(String errorMessage) {
        return "<html><body><h1>获取消息失败</h1><p>"
            + (errorMessage != null ? errorMessage.replace("<", "&lt;").replace(">", "&gt;") : "未知错误")
            + "</p></body></html>";
    }

    public Map<String, Object> getMessageCountAndPosition(MessageQo messageQo) {
        return memoryMessageService.getMessageCountAndPosition(messageQo);
    }

    public List<ByaiMessageHotDto> getMessageByIds(MessageQo messageQo) {
        if (messageQo.getMessageIds() == null) {
            throw new BdpRuntimeException(I18nUtil.get("message.service.message.ids.null"));
        }
        return getChatHistory(messageQo.getMessageIds());
    }
}
