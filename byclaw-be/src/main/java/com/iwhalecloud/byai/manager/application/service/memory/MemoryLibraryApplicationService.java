package com.iwhalecloud.byai.manager.application.service.memory;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.manager.domain.memory.service.MemoryLibraryService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.memory.MemoryLibrary;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * 记忆库应用服务
 *
 * @author system &#064;date 2025-01-XX
 */
@Service
public class MemoryLibraryApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(MemoryLibraryApplicationService.class);

    @Autowired
    private MemoryLibraryService memoryLibraryService;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 创建或获取记忆库（数字员工）
     *
     * @param agentId 数字员工ID
     * @param agentName 数字员工名称
     * @param agentDesc 数字员工描述
     * @return 记忆库ID
     */
    public Long createOrGetMemoryLibraryForDigitalEmployee(Long agentId, Long userId, String libraryType,
        String agentName, String agentDesc) {

        // 查询是否已存在记忆库
        MemoryLibrary existingLibrary = memoryLibraryService.findByUserIdAndAgentId(agentId, libraryType);
        if (existingLibrary != null) {
            logger.info("记忆库已存在，返回已有记忆库ID: {}", existingLibrary.getMemLibraryId());
            return existingLibrary.getMemLibraryId();
        }

        // 创建记忆库
        String libraryName = agentName + "的记忆库";
        String description = StringUtils.isNotBlank(agentDesc) ? agentDesc : "";

        Map<String, Object> params = new HashMap<>();
        params.put("libraryName", libraryName);
        params.put("description", description);

        try {
            KnowledgeResponse<?> response = null;
            if (response == null || !"0".equals(response.getResultCode())) {
                logger.error("创建记忆库失败，返回结果: {}", JSON.toJSONString(response));
                throw new RuntimeException(
                    I18nUtil.get("memory.library.create.failed", response != null ? response.getResultMsg() : "响应为空"));
            }

            // 解析返回的libraryId
            Long memLibraryId = parseLibraryIdFromResponse(response.getResultObject());
            if (memLibraryId == null) {
                throw new RuntimeException(I18nUtil.get("memory.library.parse.library.id.failed"));
            }

            // 保存到数据库
            MemoryLibrary memoryLibrary = new MemoryLibrary();
            memoryLibrary.setLibraryId(SequenceService.nextVal());
            memoryLibrary.setMemLibraryId(memLibraryId);
            memoryLibrary.setAgentId(agentId);
            memoryLibrary.setUserId(userId);
            memoryLibrary.setLibraryType(libraryType);
            memoryLibrary.setIsEnabled(1); // 默认启用
            memoryLibrary.setCreateTime(new Date());

            memoryLibraryService.save(memoryLibrary);

            logger.info("成功创建数字员工记忆库，agentId: {}, memLibraryId: {}", agentId, memLibraryId);
            return memLibraryId;

        }
        catch (Exception e) {
            logger.error("创建数字员工记忆库失败，agentId: {}, error: {}", agentId, e.getMessage(), e);
            throw new RuntimeException(I18nUtil.get("memory.library.create.digital.employee.failed", e.getMessage()),
                e);
        }
    }

    /**
     * 保存场景信息到记忆引擎
     *
     * @param libraryId 记忆库ID
     * @param sceneName 场景名称
     * @param sceneDesc 场景描述
     * @param ruleString 规则字符串
     * @return 场景ID
     */
    public String saveMemoryScene(Long libraryId, String sceneName, String sceneDesc, String ruleString) {
        return saveMemoryScene(libraryId, sceneName, sceneDesc, ruleString, null);
    }

    /**
     * 保存或更新场景信息
     *
     * @param libraryId 记忆库ID
     * @param sceneName 场景名称
     * @param sceneDesc 场景描述
     * @param ruleString 规则字符串
     * @param sceneId 场景ID（如果传入则更新，否则创建）
     * @return 场景ID
     */
    public String saveMemoryScene(Long libraryId, String sceneName, String sceneDesc, String ruleString,
        String sceneId) {
        // 构建请求参数
        Map<String, Object> params = buildSceneParams(libraryId, sceneName, sceneDesc, ruleString, sceneId);

        // 调用记忆引擎接口保存场景
        KnowledgeResponse<?> response = callSaveMemorySceneApi(params);

        // 解析并返回场景ID
        String resultSceneId = parseSceneIdFromResponse(response);

        logger.info("成功保存场景信息，libraryId: {}, sceneName: {}, sceneId: {}", libraryId, sceneName, resultSceneId);
        return resultSceneId;
    }

    /**
     * 构建保存场景的请求参数
     *
     * @param libraryId 记忆库ID
     * @param sceneName 场景名称
     * @param sceneDesc 场景描述
     * @param ruleString 规则字符串
     * @param sceneId 场景ID（可选，如果传入则更新）
     * @return 请求参数Map
     */
    private Map<String, Object> buildSceneParams(Long libraryId, String sceneName, String sceneDesc, String ruleString,
        String sceneId) {
        // 构建额外的规则字符串
        String additionalRules = buildAdditionalRules();

        // 将额外规则追加到现有规则字符串中
        String finalRuleString = StringUtils.isNotBlank(ruleString) ? ruleString + "\n" + additionalRules
            : additionalRules;

        Map<String, Object> params = new HashMap<>();
        params.put("libraryId", libraryId);
        params.put("sceneName", sceneName);
        params.put("scope", "11");
        params.put("sceneDesc", StringUtils.isNotBlank(sceneDesc) ? sceneDesc : "");
        params.put("ruleString", finalRuleString);
        // 如果传入 sceneId，则添加到参数中（用于更新场景）
        if (StringUtils.isNotBlank(sceneId)) {
            params.put("sceneId", sceneId);
        }
        return params;
    }

    /**
     * 调用保存场景的Feign接口
     *
     * @param params 请求参数
     * @return 响应结果
     */
    private KnowledgeResponse<?> callSaveMemorySceneApi(Map<String, Object> params) {
        return KnowledgeResponse.success(null);
    }

    /**
     * 从响应中解析场景ID
     *
     * @param response 响应对象
     * @return 场景ID
     */
    private String parseSceneIdFromResponse(KnowledgeResponse<?> response) {
        Object resultObject = response.getResultObject();
        if (resultObject == null) {
            logger.error("保存场景信息返回结果为空");
            throw new RuntimeException(I18nUtil.get("memory.library.save.scene.result.empty"));
        }

        String sceneId = extractSceneIdFromResult(resultObject);
        if (sceneId == null) {
            logger.error("无法从返回结果中解析sceneId，返回结果: {}", JSON.toJSONString(resultObject));
            throw new RuntimeException(I18nUtil.get("memory.library.parse.scene.id.failed"));
        }
        return sceneId;
    }

    /**
     * 从结果对象中提取场景ID
     *
     * @param resultObject 结果对象
     * @return 场景ID，如果提取失败返回null
     */
    @SuppressWarnings("unchecked")
    private String extractSceneIdFromResult(Object resultObject) {
        if (!(resultObject instanceof Map)) {
            return null;
        }

        Map<String, Object> resultMap = (Map<String, Object>) resultObject;
        Object sceneIdObj = resultMap.get("sceneId");
        return sceneIdObj != null ? sceneIdObj.toString() : null;
    }

    /**
     * 构建额外的规则字符串
     *
     * @return 额外的规则字符串
     */
    private String buildAdditionalRules() {
        StringBuilder rules = new StringBuilder();
        rules.append("1. Extract facts ONLY from USER messages, NEVER from assistant or system messages\n");
        rules.append("2. Extract ANY meaningful information that could be useful for future conversations\n");
        rules.append("3. Be more lenient - if there's any personal information, preference, or fact, extract it\n");
        rules.append("4. Even if information seems incomplete, extract it if it's about the user\n");
        rules.append("5. Detect and preserve the language of the user input");
        return rules.toString();
    }

    /**
     * 从响应中解析libraryId
     *
     * @param resultObject 响应结果对象
     * @return libraryId，解析失败返回null
     */
    private Long parseLibraryIdFromResponse(Object resultObject) {
        if (resultObject == null) {
            logger.error("创建记忆库返回结果为空");
            return null;
        }

        if (resultObject instanceof Map) {
            Map<String, Object> resultMap = (Map<String, Object>) resultObject;
            Object libraryIdObj = resultMap.get("libraryId");
            if (libraryIdObj != null) {
                if (libraryIdObj instanceof Number) {
                    return ((Number) libraryIdObj).longValue();
                }
                else {
                    try {
                        return Long.parseLong(libraryIdObj.toString());
                    }
                    catch (NumberFormatException e) {
                        logger.error("解析libraryId失败: {}", libraryIdObj);
                        return null;
                    }
                }
            }
        }

        logger.error("无法从返回结果中解析libraryId，返回结果: {}", JSON.toJSONString(resultObject));
        return null;
    }
}
