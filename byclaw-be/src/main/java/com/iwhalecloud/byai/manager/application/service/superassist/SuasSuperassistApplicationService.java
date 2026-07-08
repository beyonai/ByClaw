package com.iwhalecloud.byai.manager.application.service.superassist;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.feign.client.FeignTokenSaverService;
import com.iwhalecloud.byai.common.feign.request.conversation.AgentPrologueDto;
import com.iwhalecloud.byai.common.feign.request.token.TokenSaveRequest;
import com.iwhalecloud.byai.common.feign.response.token.TokenApiResponse;
import com.iwhalecloud.byai.common.feign.response.token.TokenDto;
import com.iwhalecloud.byai.common.feign.response.token.TokenKeyResult;
import com.iwhalecloud.byai.common.feign.response.token.TokenPageResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelOwnerType;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelProtocol;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelSourceType;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelQuota;
import com.iwhalecloud.byai.manager.dto.aimodel.TokenSaver;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.resource.SsResExtSkillDto;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.qo.aimodel.DefaultAiModelQo;
import com.iwhalecloud.byai.manager.qo.aimodel.FindAiModelQo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
    private SsResExtSkillService ssResExtSkillService;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelService;

    @Autowired
    private FeignTokenSaverService feignTokenSaverService;

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private DatasetApplicationService datasetApplicationService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

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
            // 返回 null 让调用方知道需要从数据库重新查询
            return null;
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
        Long userId = loginInfo.getUserId();
        Long defaultDigEmployeeId = loginInfo.getDefaultDigEmployeeId();

        // 获取初始化模板
        JSONArray initTemplates = this.getInitTemplateArray(loginInfo);

        if (ListUtil.isEmpty(initTemplates)) {
            return defaultDigEmployeeId;
        }

        // 解析模型中的数字员工
        Map<String, AgentPrologueDto.ModelInfo> modelInfoMap = new HashMap<>();
        for (int i = 0; i < initTemplates.size(); i++) {

            JSONObject jsonObject = initTemplates.getJSONObject(i);

            String resourceCode = jsonObject.getString("resourceCode");
            String modelProtocol = jsonObject.getString("modelProtocol");
            String relSkillCodes = jsonObject.getString("relSkillCodes");
            String relToolCodes = jsonObject.getString("relToolCodes");
            String isRelDefaultDataset = jsonObject.getString("isRelDefaultDataset");

            // 先从当前map获取，没有再查或者创建，不用重复查询
            AgentPrologueDto.ModelInfo modelInfo = modelInfoMap.get(modelProtocol);
            if (modelInfo == null) {
                modelInfo = this.buildDefaultModelInfo(modelProtocol);
                modelInfoMap.put(modelProtocol, modelInfo);
            }

            // 如果已经存在了，不再进行初始化
            SsResource ssResource = ssResourceService.findByIdOrCode(null, resourceCode);
            if (ssResource != null) {
                // 对技能进行对比
                this.compareDigEmployee(ssResource, jsonObject, loginInfo);

                continue;
            }

            DigitalEmployeeDTO digitalEmployeeDTO = new DigitalEmployeeDTO();
            MapParamUtil.copyProperties(jsonObject, digitalEmployeeDTO);
            digitalEmployeeDTO.setRelIds(new ArrayList<>());
            digitalEmployeeDTO.setRelResourceInfoList(new ArrayList<>());

            // 其他类型数字员工设置默认模型
            String prologue = digitalEmployeeDTO.getPrologue();

            // 是否关联默认知识库
            if (Constants.YES_VALUE_Y.equalsIgnoreCase(isRelDefaultDataset)) {
                digitalEmployeeDTO.setRelIds(List.of(defaultDatasetId));
                digitalEmployeeDTO.setPrologue(this.buildPrologue(prologue, modelInfo, defaultDatasetId));
            }
            else {
                digitalEmployeeDTO.setRelIds(new ArrayList<>());
                digitalEmployeeDTO.setPrologue(this.buildPrologue(prologue, modelInfo, null));
            }

            // 关联工具agent|tool|view
            this.handleRelToolCodes(digitalEmployeeDTO, relToolCodes, userId);

            // 处理关联技能
            this.handleRelSkillCodes(digitalEmployeeDTO, relSkillCodes, userId);

            // 保存数字员工
            ssResource = digitalEmployeeApplicationService.saveDigitalEmployee(digitalEmployeeDTO);

            // 如果是超级助手
            if (Constants.YES_VALUE_T.equalsIgnoreCase(digitalEmployeeDTO.getOpenSuperHelper())) {
                defaultDigEmployeeId = ssResource.getResourceId();
            }

            // 同步openClaw工作空间：透传原始入参，relTools / relPrompt 等不入 DB 的运行期字段需要从入参直接进 JSON。
            digitalEmployeeApplicationService.synOpenClawWorkSpace(ssResource.getResourceId(), digitalEmployeeDTO);
        }

        return defaultDigEmployeeId;
    }

    /**
     * 对比初始化的数字员工
     *
     * @param ssResource 资源信息
     * @param jsonObject 模板资源配置
     * @param loginInfo 登陆信息
     */
    private void compareDigEmployee(SsResource ssResource, JSONObject jsonObject, LoginInfo loginInfo) {

        try {
            String resourceDesc = jsonObject.getString("resourceDesc");
            if (StringUtil.isNotEmpty(resourceDesc) && StringUtil.isEmpty(ssResource.getResourceDesc())) {
                ssResourceService.update(ssResource);
            }

            SsResExtDigEmployee ssResExtDigEmployee = ssResExtDigEmployeeService.findById(ssResource.getResourceId());
            // 如果不为空，则更新
            if (ssResExtDigEmployee != null) {

                boolean isChange = this.compareExtDigEmployee(ssResExtDigEmployee, jsonObject, loginInfo);

                if (isChange) {
                    ssResExtDigEmployeeService.update(ssResExtDigEmployee);
                }

            }
            else {

                ssResExtDigEmployee = new SsResExtDigEmployee();
                ssResExtDigEmployee.setResourceId(ssResource.getResourceId());

                this.compareExtDigEmployee(ssResExtDigEmployee, jsonObject, loginInfo);

                ssResExtDigEmployeeService.save(ssResExtDigEmployee);
            }

            digitalEmployeeApplicationService.syncExistingDigEmployeeConfigToRedisQuietly(ssResource.getResourceId());
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 添加关联关系
     *
     * @param resourceId 资源
     * @param relResourceId 关联资源
     * @param userId 用户
     * @param comAcctId 企业标识
     */
    private void saveSsResourceRelDetail(Long resourceId, Long relResourceId, Long userId, Long comAcctId) {
        SsResourceRelDetail ssResourceRelDetail = new SsResourceRelDetail();
        ssResourceRelDetail.setResourceRelDetailId(sequenceService.nextVal());
        ssResourceRelDetail.setResourceId(resourceId);
        ssResourceRelDetail.setRelResourceId(relResourceId);
        ssResourceRelDetail.setRelStatus(1);
        ssResourceRelDetail.setCreateTime(new Date());
        ssResourceRelDetail.setCreateBy(userId);
        ssResourceRelDetail.setComAcctId(comAcctId);
        ssResourceRelDetailService.save(ssResourceRelDetail);
    }

    /**
     * 对比数字员工扩展属性
     *
     * @param ssResExtDigEmployee 数据员工扩展信息
     * @param jsonObject 当前模板数据
     * @return boolean
     */
    private boolean compareExtDigEmployee(SsResExtDigEmployee ssResExtDigEmployee, JSONObject jsonObject,
        LoginInfo loginInfo) {

        Long userId = loginInfo.getUserId();
        Long comAcctId = loginInfo.getComAcctId();
        Long resourceId = ssResExtDigEmployee.getResourceId();

        String prologue = jsonObject.getString("prologue");
        String relToolCodes = jsonObject.getString("relToolCodes");
        String coreCompetencies = jsonObject.getString("coreCompetencies");
        String corePersonaDefinition = jsonObject.getString("corePersonaDefinition");

        boolean isChange = false;
        if (StringUtil.isNotEmpty(prologue) && StringUtil.isEmpty(ssResExtDigEmployee.getPrologue())) {
            ssResExtDigEmployee.setPrologue(prologue);
            isChange = true;
        }
        if (StringUtil.isNotEmpty(coreCompetencies) && StringUtil.isEmpty(ssResExtDigEmployee.getCoreCompetencies())) {
            ssResExtDigEmployee.setCoreCompetencies(coreCompetencies);
            isChange = true;
        }

        if (StringUtil.isNotEmpty(corePersonaDefinition)
            && StringUtil.isEmpty(ssResExtDigEmployee.getCorePersonaDefinition())) {
            ssResExtDigEmployee.setCorePersonaDefinition(corePersonaDefinition);
            isChange = true;
        }

        Map<String, SsResourceDTO> relResourceMap = new HashMap<>(10);
        List<SsResourceDTO> relResources = ssResourceService.findRelResource(resourceId);
        for (SsResourceDTO ssResourceDTO : relResources) {
            relResourceMap.put(ssResourceDTO.getResourceCode(), ssResourceDTO);
        }

        // 关联技能
        String relSkillCodes = jsonObject.getString("relSkillCodes");
        List<String> splitSkillCodes = StringUtil.splitStr(relSkillCodes, ",");
        List<SsResExtSkillDto> ssResExtSkillDtos = ssResExtSkillService.findBySkillCodes(splitSkillCodes);
        for (SsResExtSkillDto ssResExtSkillDto : ssResExtSkillDtos) {
            String resourceCode = ssResExtSkillDto.getResourceCode();

            // 如果存在关联表不存在的技能，授权添加关联关系
            SsResourceDTO ssResourceDTO = relResourceMap.get(resourceCode);
            if (ssResourceDTO == null) {

                // 授权技能
                this.authResource(ssResExtSkillDto, userId);

                // 关联技能
                this.saveSsResourceRelDetail(resourceId, ssResExtSkillDto.getResourceId(), userId, comAcctId);

                isChange = true;
            }

        }
        // 设置关联技能的json信息
        ssResExtDigEmployee.setSkills(this.buildJsonBySkillDto(ssResExtSkillDtos));

        // 关联工具
        List<String> splitToolCodes = StringUtil.splitStr(relToolCodes, ",");
        for (String toolCode : splitToolCodes) {
            SsResourceDTO ssResourceDTO = relResourceMap.get(toolCode);
            if (ssResourceDTO == null) {
                SsResource relSsResource = ssResourceService.findByIdOrCode(null, toolCode);

                if (relSsResource == null) {
                    continue;
                }

                // 授权工具
                this.authResource(relSsResource, userId);

                // 关联工具
                this.saveSsResourceRelDetail(resourceId, relSsResource.getResourceId(), userId, comAcctId);

                isChange = true;
            }
        }

        return isChange;
    }

    /**
     * 构奸关联工具编码
     *
     * @param digitalEmployeeDTO 数字员工新增对象
     * @param relToolCodes 工具编码
     */
    private void handleRelToolCodes(DigitalEmployeeDTO digitalEmployeeDTO, String relToolCodes, Long userId) {

        List<String> splitToolCodes = StringUtil.splitStr(relToolCodes, ",");
        if (ListUtil.isEmpty(splitToolCodes)) {
            return;
        }

        for (String resourceCode : splitToolCodes) {

            SsResource ssResource = ssResourceService.findByIdOrCode(null, resourceCode);
            if (ssResource == null) {
                continue;
            }

            // 授权资源
            this.authResource(ssResource, userId);

            // 关联资源标识
            Long resourceId = ssResource.getResourceId();
            digitalEmployeeDTO.getRelIds().add(resourceId);

            // 视图类型关联子选项相关
            if (ResourceBizType.VIEW.getCode().equalsIgnoreCase(ssResource.getResourceBizType())) {
                List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.findByResourceId(resourceId);
                RelResourceInfo relResourceInfo = new RelResourceInfo();
                relResourceInfo.setRelId(String.valueOf(ssResource.getResourceId()));

                List<String> activeResourceIds = new ArrayList<>();
                for (SsResourceRelDetail resourceRelDetail : resourceRelDetails) {
                    activeResourceIds.add(String.valueOf(resourceRelDetail.getRelResourceId()));
                }
                relResourceInfo.setActiveResourceIds(activeResourceIds);
                digitalEmployeeDTO.getRelResourceInfoList().add(relResourceInfo);
            }
        }

    }

    /**
     * 处理关联技能
     *
     * @param digitalEmployeeDTO 保存入参
     * @param relSkillCodes 关联技能编码
     * @param userId 用户标识
     */
    private void handleRelSkillCodes(DigitalEmployeeDTO digitalEmployeeDTO, String relSkillCodes, Long userId) {

        // 关联技能
        List<String> splitSkillCodes = StringUtil.splitStr(relSkillCodes, ",");
        List<SsResExtSkillDto> ssResExtSkills = ssResExtSkillService.findBySkillCodes(splitSkillCodes);
        if (ListUtil.isEmpty(ssResExtSkills)) {
            return;
        }

        // 授权资源
        for (SsResExtSkillDto ssResExtSkillDto : ssResExtSkills) {
            this.authResource(ssResExtSkillDto, userId);
        }

        // 写入技能
        digitalEmployeeDTO.setSkills(this.buildJsonBySkillDto(ssResExtSkills));
    }

    /**
     * 授权资源
     *
     * @param ssResource 资源
     * @param userId 用户标识
     */
    private void authResource(SsResource ssResource, Long userId) {

        PrivilegeGrant privilegeGrant = new PrivilegeGrant();
        privilegeGrant.setPrivilegeGrantId(sequenceService.nextVal());
        privilegeGrant.setGrantType(GrantType.AVAILABLE_USE);
        privilegeGrant.setGrantObjType(ssResource.getResourceBizType());
        privilegeGrant.setGrantObjId(ssResource.getResourceId());
        privilegeGrant.setGrantToObjId(userId);
        privilegeGrant.setGrantToObjType(GrantToObjType.USER);
        privilegeGrant.setGrantToType(Color.RED);
        privilegeGrant.setOperType(OperType.READ);
        privilegeGrant.setStatusCd("A");
        privilegeGrant.setCreateDate(new Date());
        privilegeGrantService.save(privilegeGrant);

        // 2.还要redis中插入一条红名单数据
        String key = "DATASET:AUTHORITY:1_RED_READ_PERSON_" + privilegeGrant.getGrantToObjId();
        String value = ssResource.getResourceBizType() + "_" + ssResource.getResourceId();
        RedisUtil.addSet(key, value);
    }

    /**
     * 构建关联技能
     *
     * @param ssResExtSkills 关联技能
     * @return String
     */
    private String buildJsonBySkillDto(List<SsResExtSkillDto> ssResExtSkills) {
        if (ListUtil.isEmpty(ssResExtSkills)) {
            return null;
        }

        List<Map<String, Object>> skillsList = new ArrayList<>();
        for (SsResExtSkillDto ssResExtSkillDto : ssResExtSkills) {
            Map<String, Object> objectMap = new HashMap<>();
            skillsList.add(objectMap);

            objectMap.put("resourceId", ssResExtSkillDto.getResourceId());
            objectMap.put("skillCode", ssResExtSkillDto.getResourceCode());
            SsResExtSkill ssResExtSkill = ssResExtSkillDto.getSsResExtSkill();
            if (ssResExtSkill == null) {
                continue;
            }

            objectMap.put("skillType", ssResExtSkill.getSkillType());
            objectMap.put("skillUrl", ssResExtSkill.getSkillUrl());
            objectMap.put("versionUrl", "/byaiService/tool/getSkillVersion?skillId=" + ssResExtSkill.getResourceId());
        }

        return JSON.toJSONString(skillsList);
    }

    /**
     * 设置其他初始化数字员工模型信息
     *
     * @param prologue 描述
     * @param modelInfo 默认模型协议
     * @return String
     */
    private String buildPrologue(String prologue, AgentPrologueDto.ModelInfo modelInfo, Long defaultDatasetId) {
        if (StringUtil.isEmpty(prologue)) {
            return null;
        }

        AgentPrologueDto agentPrologueDto = JSON.parseObject(prologue, AgentPrologueDto.class);

        agentPrologueDto.setModelInfo(modelInfo);

        // 添加默认知识库
        if (defaultDatasetId != null) {
            AgentPrologueDto.DatasetSearchConfig datasetSearchConfig = new AgentPrologueDto.DatasetSearchConfig();
            datasetSearchConfig.setSearchMode("embedding");
            datasetSearchConfig.setSimilarity(0.6);
            datasetSearchConfig.setLimit(5);
            agentPrologueDto.setDatasetSearchConfig(datasetSearchConfig);
            agentPrologueDto.setDefaultDatasetId(defaultDatasetId);
        }

        return JSON.toJSONString(agentPrologueDto);
    }

    /**
     * 初始化模型信息
     *
     * @return AgentPrologueDto
     */
    private AgentPrologueDto.ModelInfo buildDefaultModelInfo(String modelProtocol) {

        String modelQuotaJson = byaiSystemConfigService.findByParamCode("MODEL_QUOTA");

        ModelQuota modelQuota = JSON.parseObject(modelQuotaJson, ModelQuota.class);
        TokenSaver tokenSaver = modelQuota.getTokenSaver();

        ByaiAimodel byaiAimodel = null;
        if (tokenSaver != null && tokenSaver.getEnabled()) {
            FindAiModelQo findAiModelQo = new FindAiModelQo();
            findAiModelQo.setModelType(Constants.DEFAULT_MODEL_TYPE_LLM);
            findAiModelQo.setModelProtocol(modelProtocol);
            findAiModelQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
            findAiModelQo.setOwnerType(ModelOwnerType.PERSONAL);
            findAiModelQo.setSourceType(ModelSourceType.TOKEN_SAVER);
            List<ByaiAimodel> tokenSaverModels = byaiAimodelService.findAiModelByQo(findAiModelQo);

            // 如果没有初始化过，则调用接口创建
            if (ListUtil.isNotEmpty(tokenSaverModels)) {
                byaiAimodel = tokenSaverModels.getFirst();
            }
            else {
                byaiAimodel = this.createTokenSaverModel(tokenSaver, modelProtocol);
            }
        }
        else if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
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
        modelInfo.setModel(byaiAimodel.getModelNo());
        modelInfo.setHistory(6);
        return modelInfo;
    }

    /**
     * 创建TokenSaver模型
     *
     * @return ByaiAimodel
     */
    private ByaiAimodel createTokenSaverModel(TokenSaver tokenSaver, String modelProtocol) {

        String tokenName = "ByClaw_".concat(CurrentUserHolder.getCurrentUserCode());

        if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
            tokenName = tokenName + "_" + modelProtocol;
        }

        // 创建tokenSaver
        TokenSaveRequest tokenSaveRequest = new TokenSaveRequest();
        tokenSaveRequest.setName(tokenName);
        tokenSaveRequest.setUnlimitedQuota(true);
        tokenSaveRequest.setExpiredTime(-1L);
        TokenApiResponse<Void> token = feignTokenSaverService.createToken(tokenSaveRequest);
        logger.info("创建tokenSaver模型:{}", JSON.toJSONString(token));

        // 获取tokenSaver标识
        TokenApiResponse<TokenPageResult> tokenApiResponse = feignTokenSaverService.searchTokens(tokenName, null, 1, 1);
        TokenPageResult tokenPageResult = tokenApiResponse.getData();
        logger.info("获取模型标识tokenPageResult:{}", JSON.toJSONString(tokenPageResult));
        List<TokenDto> items = tokenPageResult.getItems();
        TokenDto tokenDto = items.getFirst();

        // 获取tokenSaver的apiKey
        TokenApiResponse<TokenKeyResult> tokenKeyResult = feignTokenSaverService.getTokenKey(tokenDto.getId());
        TokenKeyResult data = tokenKeyResult.getData();
        logger.info("获取模型apiKey:{}", JSON.toJSONString(tokenKeyResult));

        // 创建对应的模型
        ByaiAimodel newByaiAimodel = new ByaiAimodel();
        newByaiAimodel.setModelName(tokenName);
        if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
            newByaiAimodel.setUrl(tokenSaver.getAnthropicApiUrl());
        }
        else {
            newByaiAimodel.setUrl(tokenSaver.getApiUrl());
        }
        newByaiAimodel.setModelProtocol(modelProtocol);
        newByaiAimodel.setOwnerType(ModelOwnerType.PERSONAL);
        newByaiAimodel.setSourceType(ModelSourceType.TOKEN_SAVER);
        newByaiAimodel.setModelType(Constants.DEFAULT_MODEL_TYPE_LLM);
        newByaiAimodel.setModelNo(tokenSaver.getModelCode());
        newByaiAimodel.setAuthToken(Sm4Util.encrypt(data.getKey()));
        newByaiAimodel.setCreateTime(new Date());
        newByaiAimodel.setCreateBy(CurrentUserHolder.getCurrentUserId());
        newByaiAimodel.setStatus("OOA");
        newByaiAimodel.setMaxContentToken(200000);
        newByaiAimodel.setInParams(this.buildInParams(modelProtocol, data.getKey()));
        byaiAimodelService.upsert(newByaiAimodel);
        return newByaiAimodel;
    }

    /**
     * 模型内置参数
     *
     * @param modelProtocol 模型端点
     * @param apiKey 密钥
     * @return String
     */
    private String buildInParams(String modelProtocol, String apiKey) {
        Map<String, Object> inParams = new HashMap<>();
        // 基础字段
        if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
            Map<String, String> keyMap = Map.of("key", "x-api-key", "value", apiKey);
            Map<String, String> contentTypeMap = Map.of("key", "Content-Type", "value", "application/json");
            inParams.put("headers", List.of(keyMap, contentTypeMap));
        }
        else {
            inParams.put("headers", List.of(Map.of("key", "", "value", "")));
        }
        inParams.put("connectTimeoutSec", 32);
        inParams.put("modelProtocol", modelProtocol);
        inParams.put("readTimeoutSec", 60);
        inParams.put("topP", 0.9);
        inParams.put("abilities", List.of("3"));
        inParams.put("presencePenalty", 0.0);
        inParams.put("maxRetries", 3);
        inParams.put("systems", List.of("BYAI"));
        inParams.put("temperature", 0.7);
        inParams.put("maxTokens", 2000000);

        // 嵌套 reasoningConfig
        Map<String, Object> reasoningConfig = new HashMap<>();
        reasoningConfig.put("capability", "unsupported");
        reasoningConfig.put("compatFormat", "auto");
        reasoningConfig.put("defaultLevel", "off");
        reasoningConfig.put("enabled", false);
        inParams.put("reasoningConfig", reasoningConfig);
        inParams.put("retryIntervalSec", 1);
        inParams.put("frequencyPenalty", 0.0);
        inParams.put("providerName", "OpenAI");

        return JSON.toJSONString(inParams);
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
