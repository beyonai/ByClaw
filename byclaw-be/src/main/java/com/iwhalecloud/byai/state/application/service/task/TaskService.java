package com.iwhalecloud.byai.state.application.service.task;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.google.common.collect.ImmutableMap;
import com.google.common.collect.Sets;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageFormSubmitDto;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageTaskDto;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageTaskValidResultDto;
import com.iwhalecloud.byai.state.domain.chat.dto.TaskValidationContext;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.men.PromptConstants;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@Service
@Slf4j
public class TaskService {

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /**
     * 消息表单提交
     *
     * @param messageFormSubmitDto 提交的表单内容
     * @return ResponseUtil
     */
    public ResponseUtil submitForm(MessageFormSubmitDto messageFormSubmitDto) {
        Long messageId = messageFormSubmitDto.getMessageId();

        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(messageId);
        Map<String, Object> resultObject = null;
        Object result = null;
        if (StringUtils.isBlank(messageFormSubmitDto.getPluginMachineId())) {
            resultObject = ImmutableMap.of("result", "{\"code\": 0}");
            result = resultObject.get("result");
        }

        // 更新消息表单内容
        JSONObject pluginResult = JSON.parseObject(result.toString());
        // 不会存在回答里和思考过程里同时存在的情况
        // 回答里的
        List<AnswerDelta> answerDeltas = updateFormMessage(messageFormSubmitDto, byaiMessageHotDto.getMessageStruct(),
            pluginResult);
        if (answerDeltas != null) {
            byaiMessageHotDto.setMessageStruct(JSON.toJSONString(answerDeltas));
            byaiMessageHotService.updateSelective(byaiMessageHotDto);
            return ResponseUtil.successResponse(resultObject);
        }
        // 思考过程里的
        answerDeltas = updateFormMessage(messageFormSubmitDto, byaiMessageHotDto.getInferLog(), pluginResult);
        if (answerDeltas != null) {
            byaiMessageHotDto.setInferLog(JSON.toJSONString(answerDeltas));
            byaiMessageHotService.updateSelective(byaiMessageHotDto);
        }
        return ResponseUtil.successResponse(resultObject);

    }

    private List<AnswerDelta> updateFormMessage(MessageFormSubmitDto messageFormSubmitDto, String messages,
        JSONObject pluginResult) {
        if (StringUtils.isBlank(messages)) {
            return null;
        }
        List<AnswerDelta> answerDeltas = JSON.parseArray(messages, AnswerDelta.class);
        if (CollectionUtils.isEmpty(answerDeltas)) {
            return null;
        }
        boolean hasUpdateForm = false;
        // 从后遍历获取第一个表单修改表单状态
        for (int i = answerDeltas.size() - 1; i >= 0; i--) {
            AnswerDelta answerDelta = answerDeltas.get(i);
            if (MessageContentTypeEnum.FORM.getCode().equals(answerDelta.getContentType())
                || MessageContentTypeEnum.TASK_USER_INPUT.getCode().equals(answerDelta.getContentType())) {
                // String content = answerDelta.getChoices().get(0).getDelta().getContent();
                JSONObject contentJson = JSON.parseObject(JSON.toJSONString(messageFormSubmitDto));
                // JSONObject contentJson = JSON.parseObject(content);
                contentJson.put("result", pluginResult);
                int formStatus = Optional.of(pluginResult.getIntValue("code")).orElse(-1) == 0 ? 2 : 1;
                contentJson.put("formStatus", formStatus);
                answerDelta.getChoices().get(0).getDelta().setContent(JSON.toJSONString(contentJson));
                hasUpdateForm = true;
                break;
            }
        }
        return hasUpdateForm ? answerDeltas : null;
    }

    private String getTaskValidPrompt() {
        String language = I18nUtil.CHINSES;
        try {
            // 获取当前登录语言，没有则使用系统参数默认
            language = ApplicationContextUtil.getRequest().getAttribute(I18nUtil.LANGUAGE).toString();
        }
        catch (Exception e) {
            log.warn("Get language error, default set to Chinese");
        }
        if (I18nUtil.CHINSES.equals(language)) {
            return PromptConstants.VALIDATE_TASK_PROMPT_ZH;
        }
        return PromptConstants.VALIDATE_TASK_PROMPT_EN;
    }

    /**
     * 验证任务的有效性 1. 代码校验：步骤完整性、依赖关系、文件路径匹配 2. AI校验：步骤描述中的文件操作一致性 3. 合并校验结果
     *
     * @param messageTaskDto 待验证的任务
     * @return 验证结果
     */
    public MessageTaskValidResultDto validateTask(MessageTaskDto messageTaskDto) {
        // TODO zht 国际化兼容
        // 补充任务ID和名称
        completeTaskInfo(messageTaskDto);

        // 代码校验
        MessageTaskValidResultDto codeValidResult = validateWithCode(messageTaskDto);

        // AI校验
        MessageTaskValidResultDto aiValidResult = null;

        // 合并校验结果
        MessageTaskValidResultDto messageTaskValidResultDto = mergeValidationResults(codeValidResult, aiValidResult);

        // 处理结果
        handleResult(messageTaskValidResultDto, messageTaskDto);

        // 如果验证通过，更新任务
        if (PromptConstants.VALIDATE_TASK_PROMPT_PASS_RESULT.equals(messageTaskValidResultDto.getResult())) {
            manualTask(messageTaskDto);
        }
        return messageTaskValidResultDto;
    }

    /**
     * 补充任务的ID和名称信息
     */
    private void completeTaskInfo(MessageTaskDto messageTaskDto) {
        messageTaskDto.getSteps().forEach(step -> {
            step.getSubSteps().forEach(subStep -> {
                if (StringUtils.isBlank(subStep.getId())) {
                    subStep.setId(UUID.randomUUID().toString());
                }
                if (StringUtils.isBlank(subStep.getStepName())) {
                    subStep.setStepName(subStep.getStepDescription());
                }
            });
        });
    }

    /**
     * 代码校验任务 1. 步骤描述完整性 2. 步骤依赖有效性 3. 输入文件有效性 4. 文件关系一致性
     */
    private MessageTaskValidResultDto validateWithCode(MessageTaskDto messageTaskDto) {
        MessageTaskValidResultDto result = new MessageTaskValidResultDto();
        List<MessageTaskValidResultDto.InvalidSteps> invalidSteps = new ArrayList<>();
        result.setInvalidSteps(invalidSteps);

        // 创建步骤映射和顺序列表
        Map<String, TaskValidationContext> validationContext = buildValidationContext(messageTaskDto);

        List<String> userFilesNames = Optional.ofNullable(messageTaskDto.getFiles()).orElse(new ArrayList<>()).stream()
            .map(MessageFileDto::getFileName).distinct().toList();

        // 验证每个步骤
        for (MessageTaskDto.Step step : messageTaskDto.getSteps()) {
            for (MessageTaskDto.TaskSubStep subStep : step.getSubSteps()) {
                validateSubStep(userFilesNames, subStep, validationContext, invalidSteps);
            }
        }

        // 设置验证结果
        result.setResult(invalidSteps.isEmpty() ? PromptConstants.VALIDATE_TASK_PROMPT_PASS_RESULT
            : PromptConstants.VALIDATE_TASK_PROMPT_FAIL_RESULT);

        if (!invalidSteps.isEmpty()) {
            result.setUpdateDesc("任务中存在步骤依赖或文件路径不匹配的问题，请根据具体步骤的错误描述进行修正。");
        }

        return result;
    }

    /**
     * 构建验证上下文 包含步骤映射、步骤顺序和可用文件列表
     */
    private Map<String, TaskValidationContext> buildValidationContext(MessageTaskDto messageTaskDto) {
        Map<String, TaskValidationContext> contextMap = new HashMap<>();
        List<String> stepOrder = new ArrayList<>();
        Set<String> availableFiles = new HashSet<>();

        // 添加初始文件
        if (messageTaskDto.getFiles() != null) {
            messageTaskDto.getFiles().forEach(file -> availableFiles.add(file.getFileName()));
        }

        // 构建步骤上下文
        messageTaskDto.getSteps().forEach(step -> {
            step.getSubSteps().forEach(subStep -> {
                TaskValidationContext context = new TaskValidationContext();
                context.setSubStep(subStep);
                context.setStepOrder(stepOrder);
                context.setAvailableFiles(new HashSet<>(availableFiles));
                contextMap.put(subStep.getStepName(), context);
                stepOrder.add(subStep.getStepName());

                // 添加当前步骤的输出文件到可用文件集合
                if (StringUtils.isNotBlank(subStep.getOutputPath())) {
                    availableFiles.add(subStep.getOutputPath());
                }
            });
        });

        return contextMap;
    }

    /**
     * 验证单个子步骤
     */
    private void validateSubStep(List<String> fileNames, MessageTaskDto.TaskSubStep subStep,
        Map<String, TaskValidationContext> contextMap, List<MessageTaskValidResultDto.InvalidSteps> invalidSteps) {
        // 1. 验证步骤描述完整性
        if (StringUtils.isBlank(subStep.getStepDescription())) {
            addInvalidStep(invalidSteps, subStep.getId(), "步骤描述不能为空，请补充步骤描述。");
            return;
        }

        // 2. 验证步骤依赖和顺序
        if (!validateStepDependencies(subStep, contextMap, invalidSteps)) {
            return;
        }

        // 3. 验证文件关系
        validateFileRelations(fileNames, subStep, contextMap, invalidSteps);
    }

    /**
     * 验证步骤依赖和顺序
     *
     * @return 如果验证通过返回true，否则返回false
     */
    private boolean validateStepDependencies(MessageTaskDto.TaskSubStep subStep,
        Map<String, TaskValidationContext> contextMap, List<MessageTaskValidResultDto.InvalidSteps> invalidSteps) {
        if (CollectionUtils.isEmpty(subStep.getReferenceSteps())) {
            return true;
        }

        TaskValidationContext currentContext = contextMap.get(subStep.getStepName());
        int currentStepIndex = currentContext.getStepOrder().indexOf(subStep.getStepName());

        for (String refStepName : subStep.getReferenceSteps()) {
            // 检查依赖步骤是否存在
            TaskValidationContext refContext = contextMap.get(refStepName);
            if (refContext == null) {
                addInvalidStep(invalidSteps, subStep.getId(), String.format("依赖的步骤'%s'不存在，请检查步骤名称。", refStepName));
                return false;
            }

            // 检查依赖步骤的顺序
            int refStepIndex = currentContext.getStepOrder().indexOf(refStepName);
            if (refStepIndex >= currentStepIndex) {
                addInvalidStep(invalidSteps, subStep.getId(), String.format("依赖的步骤%d必须在当前步骤之前。", refStepIndex + 1));
                return false;
            }
        }

        return true;
    }

    /**
     * 验证文件关系
     */
    private void validateFileRelations(List<String> fileNames, MessageTaskDto.TaskSubStep subStep,
        Map<String, TaskValidationContext> contextMap, List<MessageTaskValidResultDto.InvalidSteps> invalidSteps) {
        // 验证依赖步骤的输出文件
        if (!CollectionUtils.isEmpty(subStep.getReferenceSteps())) {
            for (String refStepName : subStep.getReferenceSteps()) {
                TaskValidationContext refContext = contextMap.get(refStepName);
                int refStepIndex = refContext.getStepOrder().indexOf(refStepName);
                int currentStepIndex = refContext.getStepOrder().indexOf(subStep.getStepName());

                String refOutputPath = refContext.getSubStep().getOutputPath();

                if (StringUtils.isNotBlank(refOutputPath) && (CollectionUtils.isEmpty(subStep.getInputFiles())
                    || !subStep.getInputFiles().contains(refOutputPath))) {
                    addInvalidStep(invalidSteps, subStep.getId(), String.format("步骤%d的输入文件中缺少依赖步骤%d的输出文件'%s'。",
                        currentStepIndex + 1, refStepIndex + 1, refOutputPath));
                }
            }
        }

        // 验证输入文件的来源
        if (!CollectionUtils.isEmpty(subStep.getInputFiles())) {
            TaskValidationContext currentContext = contextMap.get(subStep.getStepName());
            Set<String> availableFiles = new HashSet<>(
                Optional.ofNullable(currentContext.getAvailableFiles()).orElse(Sets.newHashSet()));
            availableFiles.addAll(fileNames);
            for (String inputFile : subStep.getInputFiles()) {
                if (!availableFiles.contains(inputFile)) {
                    addInvalidStep(invalidSteps, subStep.getId(),
                        String.format("输入文件'%s'不是任何前置步骤的输出文件，也不是任务提供的初始文件。", inputFile));
                }
            }
        }
    }

    /**
     * 合并代码校验和AI校验的结果
     */
    private MessageTaskValidResultDto mergeValidationResults(MessageTaskValidResultDto codeResult,
        MessageTaskValidResultDto aiResult) {
        MessageTaskValidResultDto finalResult = new MessageTaskValidResultDto();
        List<MessageTaskValidResultDto.InvalidSteps> mergedInvalidSteps = new ArrayList<>();

        // 添加代码校验的错误步骤
        if (codeResult.getInvalidSteps() != null) {
            mergedInvalidSteps.addAll(codeResult.getInvalidSteps());
        }

        // 添加AI校验的错误步骤
        if (aiResult.getInvalidSteps() != null) {
            mergedInvalidSteps.addAll(aiResult.getInvalidSteps());
        }

        finalResult.setInvalidSteps(mergedInvalidSteps);
        finalResult.setResult(mergedInvalidSteps.isEmpty() ? PromptConstants.VALIDATE_TASK_PROMPT_PASS_RESULT
            : PromptConstants.VALIDATE_TASK_PROMPT_FAIL_RESULT);

        // 合并更新描述
        StringBuilder updateDesc = new StringBuilder();
        if (StringUtils.isNotBlank(codeResult.getUpdateDesc())) {
            updateDesc.append(codeResult.getUpdateDesc());
        }
        if (StringUtils.isNotBlank(aiResult.getUpdateDesc())) {
            if (!updateDesc.isEmpty()) {
                updateDesc.append(" ");
            }
            updateDesc.append(aiResult.getUpdateDesc());
        }
        finalResult.setUpdateDesc(updateDesc.toString());

        return finalResult;
    }

    private void addInvalidStep(List<MessageTaskValidResultDto.InvalidSteps> invalidSteps, String stepId,
        String updateDesc) {
        MessageTaskValidResultDto.InvalidSteps invalidStep = new MessageTaskValidResultDto.InvalidSteps();
        invalidStep.setId(stepId);
        invalidStep.setUpdateDesc(updateDesc);
        invalidSteps.add(invalidStep);
    }

    private void handleResult(MessageTaskValidResultDto result, MessageTaskDto messageTaskDto) {
        List<MessageTaskValidResultDto.InvalidSteps> invalidSteps = result.getInvalidSteps();
        if (CollectionUtils.isEmpty(invalidSteps)) {
            return;
        }
        Map<String, List<MessageTaskValidResultDto.InvalidSteps>> collect = invalidSteps.stream()
            .collect(Collectors.groupingBy(MessageTaskValidResultDto.InvalidSteps::getId));
        messageTaskDto.getSteps().stream().flatMap(item -> item.getSubSteps().stream()).forEach(item -> {

            List<MessageTaskValidResultDto.InvalidSteps> errors = collect.get(item.getId());
            if (CollectionUtils.isEmpty(errors)) {
                return;
            }
            List<String> errorDescList = errors.stream().map(MessageTaskValidResultDto.InvalidSteps::getUpdateDesc)
                .toList();
            item.setInvalidErrors(errorDescList);
        });
        result.setTask(messageTaskDto);
    }

    public ByaiMessageHotDto manualTask(MessageTaskDto messageTaskDto) {

        // 判断消息id是否为空
        if (StringUtils.isBlank(messageTaskDto.getMessageId())) {
            throw new BdpRuntimeException(I18nUtil.get("task.service.message.id.is.empty"));
        }
        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(Long.parseLong(messageTaskDto.getMessageId()));
        String messageStruct = byaiMessageHotDto.getMessageStruct();
        if (StringUtils.isBlank(messageStruct)) {
            throw new BdpRuntimeException(
                I18nUtil.get("task.service.message.id.data.error", messageTaskDto.getMessageId()));
        }
        List<AnswerDelta> answerDeltas = JSON.parseArray(messageStruct, AnswerDelta.class);
        // 从后遍历获取第一个任务修改任务
        for (int i = answerDeltas.size() - 1; i >= 0; i--) {
            AnswerDelta answerDelta = answerDeltas.get(i);
            if (MessageContentTypeEnum.TASK.getCode().equals(answerDelta.getContentType())) {
                answerDelta.getChoices().get(0).getDelta().setContent(JSON.toJSONString(messageTaskDto));
                break;
            }
        }

        // 设置完整的最终答案
        StringBuilder content = new StringBuilder();
        for (AnswerDelta answerDelta : answerDeltas) {
            String sseContext = CompletionsUtils.getSseContext(answerDelta);
            if (StringUtils.isNotBlank(sseContext)) {
                content.append(sseContext);
            }
        }
        byaiMessageHotDto.setMessageContent(content.toString());
        byaiMessageHotDto.setMessageStruct(JSON.toJSONString(answerDeltas));

        byaiMessageHotService.updateSelective(byaiMessageHotDto);
        return byaiMessageHotDto;
    }
}
