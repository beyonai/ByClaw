package com.iwhalecloud.byai.manager.application.service.superassist;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.resource.ImplType;
import com.iwhalecloud.byai.common.feign.request.conversation.AgentPrologueDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelProtocol;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.qo.aimodel.DefaultAiModelQo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import java.util.Date;
import java.util.List;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-06-05 15:23:36
 * @description TODO
 */
@Service
public class SuasSuperassistApplicationService {

    private final Logger logger = LoggerFactory.getLogger(SuasSuperassistApplicationService.class);

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelService;

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    /**
     * 初始化用户超级助手和知识库
     *
     * @param loginInfo 用户登陆信息
     * @return SuasSuperassist
     */
    public SuasSuperassist createDatasetIfNotExists(LoginInfo loginInfo) {

        try {

            SuasSuperassist suasSuperassist = this.createDefaultResourcesIfNotExists(loginInfo, false);

            loginInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
            loginInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());

            return suasSuperassist;

        }
        catch (Exception e) {
            logger.error("初始化超级助手知识库失败:{}", e.getMessage(), e);
            return new SuasSuperassist();
        }

    }

    /**
     * 初始化用户超级助手、默认个人知识库和默认超级助手数字员工。
     */
    public SuasSuperassist createDefaultResourcesIfNotExists(LoginInfo loginInfo, boolean throwExceptions) {

        CurrentUserHolder.setLoginInfo(loginInfo);

        Long assistantId = loginInfo.getAssistantId();
        Long userId = loginInfo.getUserId();
        String userCode = loginInfo.getUserCode();
        String userName = loginInfo.getUserName();

        SuasSuperassist suasSuperassist = suasSuperassistService.findById(assistantId);

        if (suasSuperassist != null) {

            // 如果知识库不存在，创建
            Long sessionDatasetId = suasSuperassist.getSessionDatasetId();
            if (sessionDatasetId == null) {
                SsResource ssResource = datasetApplicationService.createDefaultPersonalDataset(userId, userCode,
                    userName);
                sessionDatasetId = ssResource.getResourceId();
            }
            suasSuperassist.setSessionDatasetId(sessionDatasetId);

            // 根据模板初始化数字员工
            Long defaultDigEmployeeId = this.initDigEmployeeByTemplate(loginInfo, sessionDatasetId);
            suasSuperassist.setDefaultDigEmployeeId(defaultDigEmployeeId);

            // 更新超级助手
            suasSuperassistService.updateById(suasSuperassist);
        }
        else {

            suasSuperassist = new SuasSuperassist();
            suasSuperassist.setSuperassistId(sequenceService.nextVal());
            suasSuperassist.setName(loginInfo.getUserName());
            suasSuperassist.setIntro(loginInfo.getUserName());
            suasSuperassist.setStatus("00");
            suasSuperassist.setCreateTime(new Date());
            suasSuperassist.setCreateUser(CurrentUserHolder.getCurrentUserId());
            suasSuperassist.setComAcctId(CurrentUserHolder.getEnterpriseId());

            // 初始化默认知识库
            SsResource defDataset = datasetApplicationService.createDefaultPersonalDataset(userId, userCode, userName);
            suasSuperassist.setSessionDatasetId(defDataset.getResourceId());

            // 根据模板初始化数字员工
            Long defaultDigEmployeeId = this.initDigEmployeeByTemplate(loginInfo, defDataset.getResourceId());
            suasSuperassist.setDefaultDigEmployeeId(defaultDigEmployeeId);

            // 保存超级助手
            suasSuperassistService.save(suasSuperassist);
        }

        return suasSuperassist;

    }

    /**
     * 初始化默认数字员工
     *
     * @param loginInfo 登陆用户信息
     */
    private Long initDigEmployeeByTemplate(LoginInfo loginInfo, Long defaultDatasetId) {

        Long defaultDigEmployeeId = loginInfo.getDefaultDigEmployeeId();

        // 获取初始化模板
        JSONArray initTemplates = this.getInitTemplateArray(loginInfo);

        if (ListUtil.isEmpty(initTemplates)) {
            return defaultDigEmployeeId;
        }

        for (int i = 0; i < initTemplates.size(); i++) {
            JSONObject jsonObject = initTemplates.getJSONObject(i);

            String resourceCode = jsonObject.getString("resourceCode");
            String modelProtocol = jsonObject.getString("modelProtocol");

            // 如果已经存在了，不再进行初始化
            SsResource ssResource = ssResourceService.findByIdOrCode(null, resourceCode);
            if (ssResource != null) {
                continue;
            }

            DigitalEmployeeDTO digitalEmployeeDTO = new DigitalEmployeeDTO();
            MapParamUtil.copyProperties(jsonObject, digitalEmployeeDTO);

            // 如果是超级助手，设置超级助手关联默认初始化知识库
            if (Constants.YES_VALUE_T.equalsIgnoreCase(digitalEmployeeDTO.getOpenSuperHelper())) {

                digitalEmployeeDTO.setImplType(ImplType.ASK_AGENT.getCode());
                digitalEmployeeDTO.setRelIds(List.of(defaultDatasetId));

                // 超级助手要关联默认知识库
                String resourceDesc = digitalEmployeeDTO.getResourceDesc();
                digitalEmployeeDTO
                    .setPrologue(this.buildAssistantPrologue(resourceDesc, modelProtocol, defaultDatasetId));

                // 保存数字员工
                SsResource retSsResource = digitalEmployeeApplicationService.saveDigitalEmployee(digitalEmployeeDTO);

                defaultDigEmployeeId = retSsResource.getResourceId();
            }
            else {

                // 其他类型数字员工设置默认模型
                String resourceDesc = digitalEmployeeDTO.getResourceDesc();
                digitalEmployeeDTO.setPrologue(this.buildPrologue(resourceDesc, modelProtocol));

                // 保存数字员工
                digitalEmployeeApplicationService.saveDigitalEmployee(digitalEmployeeDTO);
            }
        }

        return defaultDigEmployeeId;
    }

    /**
     * 设置其他初始化数字员工模型信息
     *
     * @param resourceDesc 描述
     * @param modelProtocol 默认模型协议
     * @return String
     */
    private String buildPrologue(String resourceDesc, String modelProtocol) {
        AgentPrologueDto prologue = new AgentPrologueDto();
        prologue.setDescText(resourceDesc);
        prologue.setRole(resourceDesc);
        prologue.setBackground(resourceDesc);
        prologue.setModelInfo(this.buildDefaultModelInfo(modelProtocol));
        return JSON.toJSONString(prologue);
    }

    /**
     * 设置超级助手模型信息
     *
     * @param resourceDesc 描述信息
     * @param modelProtocol 模型协议
     * @param defaultDatasetId 默认知识库标识
     * @return String
     */
    private String buildAssistantPrologue(String resourceDesc, String modelProtocol, Long defaultDatasetId) {

        AgentPrologueDto prologue = new AgentPrologueDto();
        prologue.setDescText(resourceDesc);
        prologue.setRole(resourceDesc);
        prologue.setBackground(resourceDesc);

        prologue.setOpeningQuestion(
            JSON.toJSONString(List.of(I18nUtil.get("digemployee.default.super.assistant.opening.question.intro"),
                I18nUtil.get("digemployee.default.super.assistant.opening.question.summary"))));
        AgentPrologueDto.DatasetSearchConfig datasetSearchConfig = new AgentPrologueDto.DatasetSearchConfig();
        datasetSearchConfig.setSearchMode("embedding");
        datasetSearchConfig.setSimilarity(0.6);
        datasetSearchConfig.setLimit(5);
        prologue.setDatasetSearchConfig(datasetSearchConfig);

        prologue.setDefaultDatasetId(defaultDatasetId);

        prologue.setModelInfo(this.buildDefaultModelInfo(modelProtocol));

        return JSON.toJSONString(prologue);
    }

    /**
     * 初始化模型信息
     *
     * @return AgentPrologueDto
     */
    private AgentPrologueDto.ModelInfo buildDefaultModelInfo(String modelProtocol) {

        ByaiAimodel byaiAimodel = null;
        if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
            DefaultAiModelQo defaultAiModelQo = new DefaultAiModelQo();
            defaultAiModelQo.setModelProtocol(modelProtocol);
            defaultAiModelQo.setModelType(Constants.DEFAULT_MODEL_TYPE_LLM);
            defaultAiModelQo.setStatus(Constants.STATUS_ENABLED);
            byaiAimodel = byaiAimodelService.getDefaultAiModel(defaultAiModelQo);
        }
        else {
            DefaultAiModelQo defaultAiModelQo = new DefaultAiModelQo();
            defaultAiModelQo.setModelProtocol(modelProtocol);
            defaultAiModelQo.setModelType(Constants.DEFAULT_MODEL_TYPE_LLM);
            defaultAiModelQo.setStatus(Constants.STATUS_ENABLED);
            defaultAiModelQo.setTagId(Constants.DEFAULT_MODEL_TAG_ID);
            byaiAimodel = byaiAimodelService.getDefaultAiModel(defaultAiModelQo);
        }

        if (byaiAimodel == null) {
            logger.error("当前默认模型不存在，默认个人助理将使用空模型配置初始化");
            return null;
        }

        AgentPrologueDto.ModelInfo modelInfo = new AgentPrologueDto.ModelInfo();
        modelInfo.setMaxToken(byaiAimodel.getMaxContentToken());
        modelInfo.setModelId(byaiAimodel.getModelId());
        modelInfo.setTemperature(byaiAimodel.getInparamTemplate());
        modelInfo.setModel(byaiAimodel.getModelNo());
        modelInfo.setHistory(6);
        return modelInfo;
    }

    /**
     * 获取初始化模板信息，替换好用户信息，根据当前语言环境获取
     *
     * @param loginInfo 登陆信息
     * @return String
     */
    private JSONArray getInitTemplateArray(LoginInfo loginInfo) {

        String paramCode = "INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE";

        String initTemplateStr = byaiSystemConfigService.findByParamCode(paramCode);

        Long userId = loginInfo.getUserId();
        String userCode = loginInfo.getUserCode();
        String userName = loginInfo.getUserName();

        // 使用 replace 纯文本替换，规避正则$符号异常
        initTemplateStr = initTemplateStr.replace("${userId}", userId == null ? "" : String.valueOf(userId));
        initTemplateStr = initTemplateStr.replace("${userCode}", userCode == null ? "" : userCode);
        initTemplateStr = initTemplateStr.replace("${userName}", userName == null ? "" : userName);

        JSONObject jsonObjectTemplate = JSON.parseObject(initTemplateStr);

        // 选择中英文模板进行切换
        if (I18nUtil.ENGLISH.equalsIgnoreCase(loginInfo.getLanguage())) {
            return jsonObjectTemplate.getJSONArray(I18nUtil.ENGLISH);
        }
        else {
            return jsonObjectTemplate.getJSONArray(I18nUtil.CHINSES);
        }

    }

    public Long resolveCurrentUserDefaultDigitalEmployeeId() {
        Long defaultDigEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        if (defaultDigEmployeeId != null) {
            return defaultDigEmployeeId;
        }
        Long assistantId = CurrentUserHolder.getAssistantId();
        if (assistantId == null || assistantId <= 0) {
            assistantId = CurrentUserHolder.getCurrentUserId();
        }
        if (assistantId == null) {
            return null;
        }
        SuasSuperassist suasSuperassist = suasSuperassistService.findById(assistantId);
        return suasSuperassist == null ? null : suasSuperassist.getDefaultDigEmployeeId();
    }

}
