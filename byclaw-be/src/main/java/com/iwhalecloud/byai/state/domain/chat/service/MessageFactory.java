package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import com.iwhalecloud.byai.common.message.qo.MessageRelObjQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import io.jsonwebtoken.lang.Collections;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Map;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class MessageFactory {
    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private ByaiMessageRelObjService byaiMessageRelObjService;

    private static final String date_format = "yyyy-MM-dd HH:mm:ss";

    public ByaiMessageHotDtoDto generateAskMessage(Long sessionId, String chatContent, long userMessageId) {
        ByaiMessageHotDtoDto askMsg = new ByaiMessageHotDtoDto();
        askMsg.setSessionId(sessionId);
        // 提问来源渠道
        askMsg.setProjectId(
            Long.parseLong(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID)));
        // 提问来源终端
        // askMsg.setAccessTerminal(assistantChatDto.getAccessTerminal());
        // 提问目前默认为自己
        askMsg.setObjId(CurrentUserHolder.getCurrentUserId());
        askMsg.setObjType(ChatObjType.HUMAN);
        // 提问时间
        askMsg.setCreateTime(new Date());
        // 提问内容
        askMsg.setMessageContent(chatContent);
        askMsg.setMessageId(userMessageId);
        // todo 提问消息标签
        askMsg.setContentTags(null);
        return askMsg;
    }

    public ByaiMessageRelObjDto getMessageIndexByResMsgId(Long resMsgId) {
        // 查询消息的问题
        MessageRelObjQo messageRelObjQo = new MessageRelObjQo();
        messageRelObjQo.setResMsgIds(ImmutableList.of(resMsgId.toString()));
        List<ByaiMessageRelObjDto> list = byaiMessageRelObjService.findByQo(messageRelObjQo);
        if (CollectionUtils.isEmpty(list)) {
            throw new BdpRuntimeException(
                I18nUtil.get("message.factory.data.error.res.msg.id.index.not.exist", resMsgId));
        }
        return list.get(0);
    }

    /**
     * 任务修改需要给到历史消息给python 原任务json、原用户问题
     *
     * @param ctx 用户输入内容
     * @return List<MessageDto>
     */
    public List<ByaiMessageHotDto> generateUpdateTaskHistory(ChatProcessContext ctx) {
        AssistantChatDto assistantChatDto = ctx.getAssistantChatDto();
        List<ByaiMessageHotDto> messageList = Lists.newArrayList();
        // 根据任务消息查询用户问题

        ByaiMessageHotDto messageDto = byaiMessageHotService.findById(assistantChatDto.getLlmMessageId());
        // 查询消息的问题
        ByaiMessageRelObjDto messageIndexDto = getMessageIndexByResMsgId(assistantChatDto.getLlmMessageId());
        ctx.setTaskMessageIndex(messageIndexDto);

        // 用户输入的消息
        ByaiMessageHotDto userMessage = byaiMessageHotService.findById(messageIndexDto.getAskMsgId());

        // 原用户问题
        messageList.add(userMessage);

        // 用户输入生成的任务
        messageList.add(messageDto);

        return messageList;
    }

    public void updateTaskState(ByaiMessageHotDto byaiMessageHotDto) {
        updateMessageContentState(byaiMessageHotDto, MessageContentTypeEnum.TASK, "status", 2);
    }

    public void updateMessageContentState(ByaiMessageHotDto byaiMessageHotDto, MessageContentTypeEnum contentTypeEnum,
        String stateKey, Object state) {
        List<AnswerDelta> answerDeltas = JSON.parseArray(byaiMessageHotDto.getMessageStruct(), AnswerDelta.class);
        Optional<AnswerDelta> first = answerDeltas.stream()
            .filter(item -> contentTypeEnum.getCode().equals(item.getContentType())).findFirst();
        if (first.isEmpty()) {
            return;
        }
        AnswerDelta answerDelta = first.get();
        String content = answerDelta.getChoices().get(0).getDelta().getContent();
        Map<String, Object> jsonObject = JSON.parseObject(content);
        jsonObject.put(stateKey, state);
        answerDelta.getChoices().get(0).getDelta().setContent(JSON.toJSONString(jsonObject));
        byaiMessageHotDto.setMessageStruct(JSON.toJSONString(answerDeltas));

        byaiMessageHotService.updateSelective(byaiMessageHotDto);
    }

    public String getDate() {
        // 为了避免多线程问题先每个创建(可优化)
        SimpleDateFormat simpleDateFormat = new SimpleDateFormat(date_format);
        return simpleDateFormat.format(new Date());
    }

    /**
     * 构建消息索引DTO（带首词响应时长）
     *
     * @param taskId 任务id
     * @param askMsg 问题消息
     * @param resMsg 响应消息
     * @param taskDueTime 任务耗时
     * @param status 请求状态(0:成功, -1:失败)
     * @param firstTextDuration 首词响应时长（毫秒），可为null
     * @return 消息索引DTO
     */
    public ByaiMessageRelObjDto buildMessageIndexDto(Long taskId, ByaiMessageHotDtoDto askMsg,
        ByaiMessageHotDtoDto resMsg, Float taskDueTime, int status, Float firstTextDuration) {
        ByaiMessageRelObjDto byaiMessageRelObjDto = new ByaiMessageRelObjDto();

        String accessTerminal = getAccessTerminal();

        // 设置请求消息数据
        byaiMessageRelObjDto.setSessionId(askMsg.getSessionId());
        byaiMessageRelObjDto.setAskTime(askMsg.getCreateTime());
        byaiMessageRelObjDto.setAskContent(askMsg.getMessageContent());
        byaiMessageRelObjDto.setAskAccessTerminal(accessTerminal);
        byaiMessageRelObjDto.setAskContentTags(askMsg.getContentTags());
        byaiMessageRelObjDto.setAskObjType(askMsg.getObjType());
        byaiMessageRelObjDto.setAskObjId(askMsg.getObjId());

        byaiMessageRelObjDto.setAskMsgId(askMsg.getMessageId());

        // 设置状态和耗时
        byaiMessageRelObjDto.setRequestStatus(status);
        // 任务耗时
        byaiMessageRelObjDto.setTaskDueTime(taskDueTime);
        byaiMessageRelObjDto.setCreateTime(new Date());
        byaiMessageRelObjDto.setProjectId(
            Long.parseLong(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID)));
        if (taskId == null) {
            taskId = getTaskId();
        }
        byaiMessageRelObjDto.setTaskId(taskId);
        byaiMessageRelObjDto.setComAcctId(CurrentUserHolder.getEnterpriseId());

        // 从系统回复获取信息
        if (resMsg != null) {
            byaiMessageRelObjDto.setResMsgId(resMsg.getMessageId());
            byaiMessageRelObjDto.setResContent(resMsg.getMessageContent());
            byaiMessageRelObjDto.setResAccessTerminal(accessTerminal);
            byaiMessageRelObjDto.setResContentTags(resMsg.getContentTags());
            byaiMessageRelObjDto.setResObjType(resMsg.getObjType());
            byaiMessageRelObjDto.setResObjId(resMsg.getObjId());
            byaiMessageRelObjDto.setResTime(new Date());
        }

        // 设置首词响应时长
        if (firstTextDuration != null && firstTextDuration > 0) {
            byaiMessageRelObjDto.setFirstTextDuration(firstTextDuration);
        }

        return byaiMessageRelObjDto;
    }

    private String getAccessTerminal() {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        String filterType = CurrentUserHolder.getFilterType();
        if (attributes != null && !"URL-TOKEN".equalsIgnoreCase(filterType)) {
            HttpServletRequest request = attributes.getRequest();
            if (request != null) {
                return request.getHeader(Constants.ACCESS_TERMINAL);
            }
        }
        return null;
    }

    /**
     * 保存消息索引
     *
     * @param askMsg 消息索引DTO
     * @param resMsg 消息索引DTO
     */
    public void updateMessageIndex(Long relId, Long taskId, ByaiMessageHotDtoDto askMsg, ByaiMessageHotDtoDto resMsg) {
        try {
            ByaiMessageRelObjDto byaiMessageRelObjDto = buildMessageIndexDto(taskId, askMsg, resMsg, null,
                Constants.ResponseStatus.FALSE, null);
            // 调用ES服务保存记录
            byaiMessageRelObjDto.setRelId(relId);
            byaiMessageRelObjService.updateSelective(byaiMessageRelObjDto);
        }
        catch (Exception e) {
            log.error("修改消息索引时发生错误", e);
        }
    }

    /**
     * 保存消息索引
     *
     * @param askMsg 消息索引DTO
     * @param resMsg 消息索引DTO
     * @param ctx 上下文
     */
    public void saveMessageIndex(Long taskId, ByaiMessageHotDtoDto askMsg, ByaiMessageHotDtoDto resMsg,
        float taskDueTime, Integer status, ChatProcessContext ctx) {
        try {
            // 计算首词响应时长（如果还未计算）
            if (ctx.getFirstTextDuration() == null && ctx.getFirstTextStartTime() > 0
                && ctx.getFirstTextEndTime() > 0) {
                ctx.setFirstTextDuration((float) (ctx.getFirstTextEndTime() - ctx.getFirstTextStartTime()) / 1000.0f);
            }
            ByaiMessageRelObjDto byaiMessageRelObjDto = this.buildMessageIndexDto(taskId, askMsg, resMsg, taskDueTime,
                status, ctx.getFirstTextDuration());

            List<ByaiMessageRelObjDto> byaiMessageRelObjDtos = new ArrayList<>();
            if (!Collections.isEmpty(ctx.getAgentIds())) {
                for (Long agentId : ctx.getAgentIds()) {
                    ByaiMessageRelObjDto newByaiMessageRelObjDto = new ByaiMessageRelObjDto();
                    BeanUtils.copyProperties(byaiMessageRelObjDto, newByaiMessageRelObjDto);
                    newByaiMessageRelObjDto.setResObjId(agentId);
                    newByaiMessageRelObjDto.setResObjType(ChatObjType.AGENT);
                    TokenStats tokenStats = ctx.getTokenStatsMap().getOrDefault(agentId, new TokenStats());
                    newByaiMessageRelObjDto.setInputTokenCount(tokenStats.getInputTokenCount());
                    newByaiMessageRelObjDto.setOutputTokenCount(tokenStats.getOutputTokenCount());
                    newByaiMessageRelObjDto.setOutputTokenPerSecond(tokenStats.getOutputTokenPerSecond());
                    byaiMessageRelObjDtos.add(newByaiMessageRelObjDto);
                }
            }
            else {
                ByaiMessageRelObjDto newByaiMessageRelObjDto = new ByaiMessageRelObjDto();
                BeanUtils.copyProperties(byaiMessageRelObjDto, newByaiMessageRelObjDto);
                newByaiMessageRelObjDto.setResObjType(ChatObjType.SUASS);
                TokenStats tokenStats = new TokenStats();
                newByaiMessageRelObjDto.setInputTokenCount(tokenStats.getInputTokenCount());
                newByaiMessageRelObjDto.setOutputTokenCount(tokenStats.getOutputTokenCount());
                newByaiMessageRelObjDto.setOutputTokenPerSecond(tokenStats.getOutputTokenPerSecond());
                byaiMessageRelObjDtos.add(newByaiMessageRelObjDto);
            }

            // 调用ES服务保存记录
            if (!Collections.isEmpty(byaiMessageRelObjDtos)) {
                byaiMessageRelObjService.batchAdd(byaiMessageRelObjDtos);
            }

        }
        catch (Exception e) {
            log.error("保存消息索引时发生错误:{}", e.getMessage(), e);
        }
    }

    /**
     * 获取任务ID（REQUEST_ID） 统一使用 RequestContextUtil 获取，支持 HTTP 和 WebSocket 两种场景
     *
     * @return 任务ID
     */
    public Long getTaskId() {
        // 使用统一工具类获取 REQUEST_ID
        // TraceFilter 或 WebSocketHandler 已在入口设置
        return RequestContextUtil.getRequestIdOrGenerate();
    }
}
