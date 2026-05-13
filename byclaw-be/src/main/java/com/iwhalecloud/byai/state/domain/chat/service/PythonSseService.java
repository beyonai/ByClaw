package com.iwhalecloud.byai.state.domain.chat.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.BufferedReader;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.google.common.collect.ImmutableMap;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.entity.men.MenTaskRecObj;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.state.application.service.chat.PythonWebService;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.SuggestionQuestionVo;
import com.iwhalecloud.byai.state.domain.chat.model.ChatRelatedResource;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.men.enums.MenTaskStatusEnum;
import com.iwhalecloud.byai.state.domain.men.enums.SystemCodeEnum;
import com.iwhalecloud.byai.state.domain.men.enums.TaskTypeEnum;
import com.iwhalecloud.byai.state.domain.men.service.MenResComService;
import com.iwhalecloud.byai.state.domain.men.service.MenTaskService;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.log.exception.PythonRuntimeException;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class PythonSseService {

    private static final Logger logger = LoggerFactory.getLogger(PythonSseService.class);


    @Autowired
    private PythonWebService pythonWebService;

    @Autowired
    private MenTaskService menTaskService;

    @Autowired
    private MenResComService menResComService;

    /**
     * 处理Python SSE流：请求Python服务，处理流式响应，增量写入客户端。
     */
    public void handlePythonSse(ChatProcessContext ctx) throws Exception {
        int i = 0;
        long time01 = System.currentTimeMillis();
        try (BufferedReader bufferedReader = pythonWebService.requestPythonWeb(ctx.params)) {
            // long requestTime = System.currentTimeMillis();
            String line;
            while ((line = bufferedReader.readLine()) != null) {
                if (i == 0) {
                    long time02 = System.currentTimeMillis();
                    logger.info("chat {} time03:{}", ctx.assistantChatDto.getSessionId(), time02 - time01);
                }
                if (i == 0 && TaskOperateTypeEnum.UPDATE.equals(ctx.assistantChatDto.getTaskOperateType())) {
                    // 输出清空事件
                    CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.initMessage,
                        JSON.toJSONString(ImmutableMap.of("messageId", ctx.assistantChatDto.getLlmMessageId())),
                        ctx.sessionId);
                }
                i++;
                getContentFromPythonStreamV3(line, ctx.res, ctx.messageContext, ctx.getAgentIds(), ctx);
                // 规划的和待办任务也需要根据类型返回卡片 目前 3013 2011 2008 会进入这里然后返回给前端新event （之前是放在response 可是逻辑太多这个返回很慢有问题了
                if (StringUtils.isNotEmpty(setMenResCom(ctx.assistantChatDto, ctx.messageContext, line, null))) {
                    CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.resComComplete,
                        ctx.messageContext.getResComIds(), ctx.sessionId);
                }

            }
            ctx.messageContext.setComplete(true);
            // 2010 动态卡片放在循环外面最后才获取吧
            if (StringUtils.isNotEmpty(setMenResCom(ctx.assistantChatDto, ctx.messageContext, null,
                MessageContentTypeEnum.UI_AGENT_CARD.getCode()))) {
                CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.resComComplete,
                    ctx.messageContext.getResComIds(), ctx.sessionId);
            }
        }
    }

    /**
     * 处理Python算法模块发送过滤的增量流事件。
     */
    public void getContentFromPythonStreamV3(String line, OutputStream res, MessageContext messageContext,
        Set<Long> agentIds, ChatProcessContext ctx) {
        JSONObject jsonObject = JSON.parseObject(line);
        String key = jsonObject.getString("event");
        String value = jsonObject.getString("data");
        value = handleDigitExecSessionId(key, value);

        if (SseResponseEventEnum.answerDelta.equals(key)) {
            // 记录首词响应结束时间（仅记录第一次）
            if (ctx != null && !ctx.isFirstTextTimeRecorded()) {
                ctx.setFirstTextEndTime(System.currentTimeMillis());
                ctx.setFirstTextTimeRecorded(Boolean.TRUE);
            }
            messageContext.recordAnswerText(value);
            messageContext.recordStreamAnswerText(value);
            messageContext.recordAnswerStruct(value);
        }

        if (SseResponseEventEnum.answerDelta.equals(key)) {
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.answerStart.equals(key)) {
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.answerEnd.equals(key)) {
            CompletionsUtils.responseWrite(res, SseResponseEventEnum.answerDelta, "[DONE]",
                ctx != null ? ctx.sessionId : null);
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.moduleStatus.equals(key)) {
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.reasoningLogStart.equals(key)) {
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.reasoningLogDelta.equals(key)) {
            messageContext.recordInferLog(value);
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.reasoningLogEnd.equals(key)) {
            CompletionsUtils.responseWrite(res, key, value, ctx != null ? ctx.sessionId : null);
        }
        else if (SseResponseEventEnum.error.equals(key)) {
            throwPythonException(value);
        }
        else if (SseResponseEventEnum.stopTask.equals(key)) {
            messageContext.recordCallLog(value);
        }
        else if (SseResponseEventEnum.appStreamResponse.equals(key)) {
            messageContext.recordChatRelatedResource(getRelateResource(value));
        }
        else if (SseResponseEventEnum.taskCreate.equals(key)) {
            // 新类型，列表待办或者规划任务的时候产生子任务 taskId 就是父任务，stepId 就是子任务外部id(到时候修改我根据这个
            addOrUpdateMenSubTask("add", value);
        }
        else if (SseResponseEventEnum.stepComplete.equals(key)) {
            // 每个步骤完成的时候会回调这里
            addOrUpdateMenSubTask("update", value);
        }
        else if (SseResponseEventEnum.tokenCount.equals(key)) {
            handleTokenCount(value, ctx);
        }

        this.buildAgentIdsAndDatasetIds(ctx, agentIds, value);

        // 添加推荐问题
        this.appendRelatedQuestions(ctx, value);

    }

    /**
     * 仅积累事件数据到 MessageContext，不写 OutputStream。 用于处理非当前 traceId 的历史消息：需要入库但不推送给客户端。
     */
    public void accumulateEvent(String line, MessageContext messageContext) {
        JSONObject jsonObject = JSON.parseObject(line);
        String key = jsonObject.getString("event");
        String value = jsonObject.getString("data");

        if (SseResponseEventEnum.answerDelta.equals(key)) {
            messageContext.recordAnswerText(value);
            messageContext.recordAnswerStruct(value);
        }
        else if (SseResponseEventEnum.reasoningLogDelta.equals(key)) {
            messageContext.recordInferLog(value);
        }
        else if (SseResponseEventEnum.stopTask.equals(key)) {
            messageContext.recordCallLog(value);
        }
        else if (SseResponseEventEnum.appStreamResponse.equals(key)) {
            messageContext.recordChatRelatedResource(getRelateResource(value));
        }
    }

    /**
     * 推荐问题
     *
     * @param ctx 上下文
     * @param value 值
     */
    private void appendRelatedQuestions(ChatProcessContext ctx, String value) {
        Map<String, Object> data = JSON.parseObject(value);
        if (data.containsKey("relatedQuestions")) {
            List<String> relatedQuestions = (List<String>) data.get("relatedQuestions");
            SuggestionQuestionVo suggestionQuestionVo = new SuggestionQuestionVo();
            suggestionQuestionVo.setRelatedQuestions(relatedQuestions);
            ctx.setSuggestionQuestion(suggestionQuestionVo);
        }
        if (data.containsKey("metadata")) {
            JSONObject metadata = JSON.parseObject(data.get("metadata").toString());
            List<String> relatedQuestions = (List<String>) metadata.get("relatedResources");
            SuggestionQuestionVo suggestionQuestionVo = new SuggestionQuestionVo();
            suggestionQuestionVo.setRelatedQuestions(relatedQuestions);
            ctx.setSuggestionQuestion(suggestionQuestionVo);
        }
    }

    /**
     * 处理event=tokenCount事件
     */
    private void handleTokenCount(String value, ChatProcessContext ctx) {
        JSONObject tokenJsonObj = JSON.parseObject(value);
        // 安全地转换数值类型，避免Integer到Float的强制转换异常
        Float promptTokenCount = convertToFloat(tokenJsonObj.get("promptTokenCount"));
        Float candidatesTokenCount = convertToFloat(tokenJsonObj.get("candidatesTokenCount"));
        Float tokensPerSecond = convertToFloat(tokenJsonObj.get("tokensPerSecond"));
        Long agentId = tokenJsonObj.getLong("agentId");
        TokenStats tokenStats = ctx.getTokenStatsMap().getOrDefault(agentId, new TokenStats());
        tokenStats.setInputTokenCount(promptTokenCount);
        tokenStats.setOutputTokenCount(candidatesTokenCount);
        tokenStats.setOutputTokenPerSecond(tokensPerSecond);
        ctx.getTokenStatsMap().put(agentId, tokenStats);
    }

    /**
     * 安全地将Object转换为Float，避免类型转换异常
     *
     * @param value 要转换的值
     * @return 转换后的Float值，如果为null或转换失败则返回null
     */
    private Float convertToFloat(Object value) {
        if (value == null) {
            return null;
        }
        try {
            if (value instanceof Number) {
                return ((Number) value).floatValue();
            }
            else if (value instanceof String) {
                return Float.parseFloat((String) value);
            }
        }
        catch (Exception e) {
            log.warn("转换Float值失败: {}, 类型: {}", value, value.getClass(), e);
        }
        return null;
    }

    private void buildAgentIdsAndDatasetIds(ChatProcessContext ctx, Set<Long> agentIds, String value) {
        Map<String, Object> data = JSONObject.parseObject(value);
        if (data.containsKey("agentId")) {
            String agentId = MapUtils.getString(data, "agentId");
            // 校验是否为数字
            if (StringUtils.isNumeric(agentId)) {
                agentIds.add(Long.parseLong(agentId));
            }
        }
        // 构建datasetIds
        buildDatasetIds(ctx, value);

    }

    /**
     * 构建知识库ID集合 从SSE响应的delta.content中解析resourceId列表
     *
     * @param ctx 聊天流程上下文
     * @param value SSE响应JSON字符串
     */
    private void buildDatasetIds(ChatProcessContext ctx, String value) {
        if (StringUtils.isBlank(value)) {
            return;
        }
        try {
            List<Map<String, Object>> choices = parseChoicesFromValue(value);
            if (CollectionUtils.isEmpty(choices)) {
                return;
            }
            for (Map<String, Object> choice : choices) {
                extractResourceIdsFromChoice(ctx, choice);
            }
        }
        catch (Exception e) {
            log.error("解析datasetIds失败: {}", value, e);
        }
    }

    /**
     * 从SSE响应值中解析choices数组
     *
     * @param value SSE响应JSON字符串
     * @return choices数组，解析失败返回null
     */
    private List<Map<String, Object>> parseChoicesFromValue(String value) {
        Map<String, Object> jsonObject = JSON.parseObject(value);
        if (jsonObject == null) {
            return null;
        }
        // 3004是文档库的
        String contentType = MapUtils.getString(jsonObject, "contentType");
        if (StringUtils.isNotBlank(contentType) && "3004".equals(contentType)) {
            return (List<Map<String, Object>>) MapUtils.getObject(jsonObject, "choices");
        }
        return null;

    }

    /**
     * 从choice中提取resourceId并添加到上下文
     *
     * @param ctx 聊天流程上下文
     * @param choice choice对象
     */
    private void extractResourceIdsFromChoice(ChatProcessContext ctx, Map<String, Object> choice) {
        if (choice == null) {
            return;
        }
        String content = getContentFromChoice(choice);
        if (StringUtils.isBlank(content)) {
            return;
        }
        JSONArray contentArray = parseContentAsArray(content);
        if (contentArray == null || CollectionUtils.isEmpty(contentArray)) {
            return;
        }
        extractResourceIdsFromContentArray(ctx, contentArray);
    }

    /**
     * 从choice中获取content字符串
     *
     * @param choice choice对象
     * @return content字符串，获取失败返回null
     */
    private String getContentFromChoice(Map<String, Object> choice) {
        Map<String, Object> delta = MapUtils.getMap(choice, "delta");
        if (delta == null) {
            return null;
        }
        return MapUtils.getString(delta, "content");
    }

    /**
     * 将content字符串解析为JSON数组 注意：content可能是普通字符串（如"04]"）或JSON数组字符串，只有数组格式才包含resourceId
     *
     * @param content content字符串
     * @return JSON数组，解析失败返回null
     */
    private JSONArray parseContentAsArray(String content) {
        try {
            return JSON.parseArray(content);
        }
        catch (Exception e) {
            // 异常被捕获且不抛出，使用error级别日志便于排查问题
            log.error("解析content为数组失败，跳过resourceId提取，content: {}", content, e);
            return null;
        }
    }

    /**
     * 从content数组中提取resourceId并添加到上下文
     *
     * @param ctx 聊天流程上下文
     * @param contentArray content JSON数组
     */
    private void extractResourceIdsFromContentArray(ChatProcessContext ctx, JSONArray contentArray) {
        for (int j = 0; j < contentArray.size(); j++) {
            Map<String, Object> item = contentArray.getJSONObject(j);
            if (item == null) {
                continue;
            }
            String resourceIdStr = MapUtils.getString(item, "resourceId");
            if (StringUtils.isBlank(resourceIdStr)) {
                continue;
            }
            addResourceIdToContext(ctx, resourceIdStr);
        }
    }

    /**
     * 将resourceId字符串转换为Long并添加到上下文
     *
     * @param ctx 聊天流程上下文
     * @param resourceIdStr resourceId字符串
     */
    private void addResourceIdToContext(ChatProcessContext ctx, String resourceIdStr) {
        try {
            Long resourceId = Long.parseLong(resourceIdStr);
            ctx.getDatasetIds().add(resourceId);
            log.debug("提取到resourceId: {}", resourceId);
        }
        catch (NumberFormatException e) {
            log.error("resourceId格式错误，无法转换为Long: {}", resourceIdStr, e);
        }
    }

    public String handleDigitExecSessionId(String key, String value) {
        if (SseResponseEventEnum.answerDelta.equals(key) || SseResponseEventEnum.reasoningLogDelta.equals(key)) {
            AnswerDelta textObject = JSONObject.parseObject(value, AnswerDelta.class);
            if (MessageContentTypeEnum.DIGIT_EXEC.getCode().equals(textObject.getContentType())) {
                String content = textObject.getChoices().get(0).getDelta().getContent();
                JSONObject jsonObject = JSONObject.parseObject(content);
                AssistantChatDto assistantChatDto = new AssistantChatDto();
                assistantChatDto.setAgentId(jsonObject.getLong("agentId"));
                assistantChatDto.setChatContent(jsonObject.getJSONObject("args").getString("input"));
                assistantChatDto.setIsDebug(1);
                jsonObject.put("sessionId", assistantChatDto.getSessionId());
                textObject.getChoices().get(0).getDelta().setContent(JSON.toJSONString(jsonObject));
            }
            return JSON.toJSONString(textObject);
        }
        else {
            return value;
        }
    }

    /**
     * 处理Python异常
     */
    public void throwPythonException(String value) {
        JSONObject jsonObject = JSON.parseObject(value);
        String message = jsonObject.getString("message");
        Integer errorCode = jsonObject.getInteger("error_code");
        String traceback = jsonObject.getString("traceback");
        String path = jsonObject.getString("path");
        String timestamp = jsonObject.getString("timestamp");
        throw new PythonRuntimeException(message, errorCode, traceback, path, timestamp);
    }

    /**
     * 获取关联资源
     */
    public List<ChatRelatedResource> getRelateResource(String value) {
        try {
            List<ChatRelatedResource> resultList = Lists.newArrayList();
            JSONObject jsonObject = JSON.parseObject(value);
            String refKnowledgeChunks = jsonObject.getString("ref_knowledge_chunks");
            if (StringUtils.isNotEmpty(refKnowledgeChunks)) {
                resultList.addAll(JSONArray.parseArray(refKnowledgeChunks, ChatRelatedResource.class));
            }
            String relatedResources = jsonObject.getString("relatedResources");
            if (StringUtils.isNotEmpty(relatedResources)) {
                resultList.addAll(JSONArray.parseArray(relatedResources, ChatRelatedResource.class));
            }
            return resultList;
        }
        catch (Exception e) {
            log.error("获取关联资源错误：{}", e.getMessage());
        }
        return Lists.newArrayList();
    }

    /*
     * 子任务新增
     */
    private void addOrUpdateMenSubTask(String type, String value) {
        /*
         * event: taskCreate data: {"title": "规划时的任务标题", ""} data:
         * {"created":1746531973,"model":"","id":"304CAB814570419F972CB81956B84775","choices":[{"finish_reason":"",
         * "delta":{"role":"assistant","content":{ "title": "知识库检索", //${步骤名称} "content": "进行知识库知识库检索", // ${步骤描述}
         * "reciType": "TOOl", //HUMAN/AGENT/ASSITENT/TOOl/MCP/DIG_EMPLOYEE "reciObjId": "1231312",
         * //ss_resource.resource_code "taskExtId": "2323", //对应stepId "pTaskId": "2323", //对应父任务的taskId }
         * },"index":0}], "contentType":"1002" ,taskId="232323,父任务id" ,stepId="外部子任务id；taskExtId" ,"object":""} event:
         * taskUpdate data:
         * {"created":1746531973,"model":"","id":"304CAB814570419F972CB81956B84775","choices":[{"finish_reason":"",
         * "delta":{"role":"assistant","content":{ "taskExtId": "72031182_NewOperationalPurchaseDeliverFlow",
         * "statusCd": "Completed", "fileOut":["http://www.baidu.com/aa.txt"], "dealDesc": "已完成处理，输出文件见附件"
         * //men_task.deal_desc } },"index":0}], "contentType":"1002" taskId="232323,父任务id" ,"object":""}
         */
        logger.info("addOrUpdateMenSubTask算法返回的内容是:{},当前操作的类型是:{}", value, type);
        AnswerDelta answerDelta;
        try {
            answerDelta = JSONObject.parseObject(value, AnswerDelta.class);
            if (answerDelta == null || CollectionUtils.isEmpty(answerDelta.getChoices())
                || null == answerDelta.getChoices().get(0).getDelta()) {
                log.error("addOrUpdateMenSubTask 子任务获取不到对应的数据, 数据如下：{}", value);
                return;
            }
            String content = answerDelta.getChoices().get(0).getDelta().getContent();
            if (!JSON.isValid(content)) {
                log.error("addOrUpdateMenSubTask 子任务获取不到对应的数据结构有误, 数据如下：{}", value);
                return;
            }
            MenTaskVo menTaskVo = JSON.parseObject(content, MenTaskVo.class);
            menTaskVo.setTaskType(TaskTypeEnum.INPUT.getCode());
            menTaskVo.setSystemNo(SystemCodeEnum.BYAI.getCode());
            if ("add".equals(type)) {
                // 修复bug：子任务创建时需要设置sessionId
                if (menTaskVo.getPTaskId() != null) {
                    // 通过父任务ID获取父任务的sessionId
                    MenTask parentTask = menTaskService.getTaskById(menTaskVo.getPTaskId());
                    if (parentTask != null && parentTask.getSessionId() != null) {
                        menTaskVo.setSessionId(parentTask.getSessionId());
                    }
                }
                MenTaskRecObj menTaskRecObjDto = new MenTaskRecObj();
                menTaskRecObjDto.setReciObjId(menTaskVo.getReciObjId());
                menTaskRecObjDto.setReciType(menTaskVo.getReciType());
                menTaskVo.setStatusCd(MenTaskStatusEnum.INPUTREQUIRED.getCode());
                menTaskService.addMenTask(menTaskVo, menTaskRecObjDto);
                // 比较搓的代码 下面修改子任务的时候把父任务弄成完成了，应为子任务不是一下子全部生成的，当第一个子任务完成的时候就修改了父任务，创建的时候在修改父任务
                MenTaskVo pMenTaskVo = new MenTaskVo();
                pMenTaskVo.setStatusCd(MenTaskStatusEnum.SUBMITTED.getCode());
                pMenTaskVo.setTaskId(menTaskVo.getPTaskId());
                menTaskService.updateTask(pMenTaskVo);

            }
            else {
                ResponseUtil responseUpdateTask = menTaskService.updateTask(menTaskVo);
                if (null != responseUpdateTask && !responseUpdateTask.isSuccess()) {
                    log.error("addOrUpdateMenSubTask updateTask 返回结果：{}", JSON.toJSONString(responseUpdateTask));
                }
                else {
                    updatePTaskStep(menTaskVo);
                }
            }
        }
        catch (Exception e) {
            log.error("addOrUpdateMenSubTask error：{}, 数据如下：{}", e.getMessage(), value, e);
        }
    }

    /*
     * 遇到： 卡片的数据都保存到资源表 根据men_res_com的主键，更新men_message.resComId字段。 根据extParam.taskId 更新 men_message.taskId字段。
     */
    private String setMenResCom(AssistantChatDto assistantChatDto, MessageContext messageStruct, String line,
        String code) {
        // 判断是否存在contentType类型
        if (messageStruct != null) {
            if (MessageContentTypeEnum.UI_AGENT_CARD.getCode().equals(code)) {
                // 为了兼容动态卡片，现在把2010 类型的都是放在对话结束的时候返回
                // 规划思考返回的放这里
                List<AnswerDelta> allAnswers = new ArrayList<>();
                allAnswers.addAll(messageStruct.getAnswerMessageList());
                allAnswers.addAll(messageStruct.getReasonMessageList());
                if (CollectionUtils.isNotEmpty(allAnswers)) {
                    return addResCom(allAnswers, messageStruct, code);
                }
            }
            else {
                JSONObject jsonObject = JSON.parseObject(line);
                String key = jsonObject.getString("event");
                String value = jsonObject.getString("data");
                if (SseResponseEventEnum.answerDelta.equals(key)
                    || SseResponseEventEnum.reasoningLogDelta.equals(key)) {
                    AnswerDelta textObject;
                    try {
                        textObject = JSONObject.parseObject(value, AnswerDelta.class);
                    }
                    catch (Exception e) {
                        log.error(e.getMessage(), e);
                        return null;
                    }
                    if (null != textObject) {
                        // 筛选出所有满足条件的AnswerDelta，contentType 2008 或 2011 或者3013
                        return addResCom(List.of(textObject), messageStruct, code);
                    }
                }
            }

            Optional.ofNullable(assistantChatDto).map(AssistantChatDto::getExtParams)
                .filter(params -> params.containsKey("beyondTaskId"))
                .ifPresent(params -> messageStruct.setTaskId(MapParamUtil.getLongValue(params, "beyondTaskId")));
        }
        return null;
    }

    /*
     * 试飞抽离插入。应为规划的任务返回的内容AnswerDelta 不是同一个对象 code为2010的时候是动态卡片特殊判断，放在了循环外面在调用所以特殊判断一下只有这种类型我们才操作
     */
    private String addResCom(List<AnswerDelta> answerList, MessageContext messageStruct, String code) {

        Set<String> validTypes = MessageContentTypeEnum.UI_AGENT_CARD.getCode().equals(code)
            ? Set.of(MessageContentTypeEnum.UI_AGENT_CARD.getCode()) // UI_AGENT_CARD
            : Set.of(MessageContentTypeEnum.TASK.getCode(), MessageContentTypeEnum.BOT_CARD.getCode(),
                MessageContentTypeEnum.TASK_USER_INPUT.getCode());

        Optional<AnswerDelta> firstAnswer = answerList.stream().filter(answer -> answer.getContentType() != null)
            .filter(answer -> validTypes.contains(answer.getContentType()))
            .filter(answer -> CollectionUtils.isNotEmpty(answer.getChoices())).findFirst();

        if (firstAnswer.isPresent()) {
            AnswerDelta answer = firstAnswer.get();

            // 循环处理每个满足条件的AnswerDelta
            MenResCom resCom = new MenResCom();
            resCom.setResPage(answer.getChoices().get(0).getDelta().getContent());
            resCom.setResType(Integer.valueOf(answer.getContentType()));

            // 批量插入资源组件
            MenResCom menResCom = menResComService.insertResCom(resCom);
            if (null != menResCom) {
                // 构建JSON数组字符串 [{"resComId": "资源ID","name": "资源名称" ,"contentType": "资源类型"}]
                List<Map<String, Object>> resComInfoList = new ArrayList<>();
                Map<String, Object> resComInfo = new HashMap<>();
                resComInfo.put("resComId", menResCom.getResComId().toString());
                resComInfo.put("contentType", menResCom.getResType().toString());
                // 除了2008规划任务的开始。其他还得判断有没有stepId外部子任务id 修改子任务的resComId。 taskId是父任务
                if (!MessageContentTypeEnum.TASK.getCode().equals(answer.getContentType())) {
                    if (null != answer.getTaskId() && StringUtils.isNotEmpty(answer.getStepId())) {
                        MenTask taskDto = new MenTask();
                        taskDto.setResComId(menResCom.getResComId());
                        taskDto.setTaskExtId(answer.getStepId());
                        taskDto.setSystemNo(SystemCodeEnum.BYAI.getCode());
                        ResponseUtil respUtil = menTaskService.updateTask(taskDto);
                        resComInfo.put("subTaskId", respUtil.getData());
                    }
                }
                resComInfoList.add(resComInfo);
                // 将JSON数组转换为字符串并设置到messageStruct
                messageStruct.setResComIds(JSON.toJSONString(resComInfoList));
                return messageStruct.getResComIds();
            }

        }
        return null;
    }

    private void updatePTaskStep(MenTaskVo menTaskVo) {
        // 如果子任务完成了还得更新 父任务里面的每个步骤状态。前端要显示是图标。
        if (menTaskVo.getTaskExtId() == null || StringUtils.isEmpty(menTaskVo.getSystemNo())) {
            return;
        }

        try {
            MenResCom menResCom = menResComService.getParentResComBySubTaskExtId(menTaskVo);
            if (menResCom == null || StringUtils.isEmpty(menResCom.getResPage())) {
                return;
            }
            // 解析 JSON
            JSONObject root = JSONObject.parseObject(menResCom.getResPage());
            JSONArray jsonArray = root.getJSONArray("steps");
            // 遍历每个主对象
            for (int i = 0; i < jsonArray.size(); i++) {
                JSONObject mainObj = jsonArray.getJSONObject(i);
                JSONArray subSteps = mainObj.getJSONArray("sub_steps");
                // 遍历每个 sub_step
                for (int j = 0; j < subSteps.size(); j++) {
                    JSONObject step = subSteps.getJSONObject(j);
                    // 获取当前 step 的 id
                    String stepId = step.getString("id");
                    // 判断 id 是否匹配
                    if (stepId.equals(menTaskVo.getTaskExtId())) {
                        // 添加字段
                        step.put("step_status", "thingdone");
                    }
                }

            }
            // 将 JSONArray 转换为字符串
            String jsonStr = root.toJSONString();
            // 更新资源组件内容
            MenResCom resComDto = new MenResCom();
            resComDto.setResComId(menResCom.getResComId());
            resComDto.setResPage(jsonStr);
            menResComService.updateResCom(resComDto);
        }
        catch (Exception e) {
            log.error("updatePTaskStep 根据父任务查询步骤修改完成", e);
        }

    }

}
