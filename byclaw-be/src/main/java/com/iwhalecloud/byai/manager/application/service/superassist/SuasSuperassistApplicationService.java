package com.iwhalecloud.byai.manager.application.service.superassist;

import cn.hutool.core.bean.BeanUtil;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.constants.devloop.MemberRole;
import com.iwhalecloud.byai.common.constants.devloop.ProjectResourceType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.common.feign.client.FeignTokenSaverService;
import com.iwhalecloud.byai.common.feign.request.conversation.AgentPrologueDto;
import com.iwhalecloud.byai.common.feign.request.datacloud.SubmitWorkspaceTemplateReq;
import com.iwhalecloud.byai.common.feign.request.token.TokenSaveRequest;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.TemplateSubmitResp;
import com.iwhalecloud.byai.common.feign.response.datacloud.TemplateSubmitResult;
import com.iwhalecloud.byai.common.feign.response.token.TokenApiResponse;
import com.iwhalecloud.byai.common.feign.response.token.TokenDto;
import com.iwhalecloud.byai.common.feign.response.token.TokenKeyResult;
import com.iwhalecloud.byai.common.feign.response.token.TokenPageResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelOwnerType;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelProtocol;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelSourceType;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectResourceService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelQuota;
import com.iwhalecloud.byai.manager.dto.aimodel.TokenSaver;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeGroupMemberDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.dto.resource.SsResExtSkillDto;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.aimodel.DefaultAiModelQo;
import com.iwhalecloud.byai.manager.qo.aimodel.FindAiModelQo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;

import java.util.*;

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

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private ProjectResourceService projectResourceService;

    @Autowired
    private FeignDataCloudService feignDataCloudService;

    @Autowired
    private UserService userService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private ProjectApplicationService projectApplicationService;


    /**
     * 初始化用户超级助手和知识库
     *
     * @param loginInfo 用户登陆信息
     * @return SuasSuperassist
     */
    public SuasSuperassist createDatasetIfNotExists(LoginInfo loginInfo) {

        try {

            SuasSuperassist suasSuperassist = this.createDefaultResourcesIfNotExists(loginInfo);

            loginInfo.setSessionDatasetId(suasSuperassist.getSessionDatasetId());
            loginInfo.setDefaultDigEmployeeId(suasSuperassist.getDefaultDigEmployeeId());

            return suasSuperassist;

        } catch (Exception e) {
            logger.error("初始化超级助手知识库失败:{}", e.getMessage(), e);
            // 返回 null 让调用方知道需要从数据库重新查询
            return null;
        }

    }

    /**
     * 初始化用户超级助手、默认个人知识库和默认超级助手数字员工。
     *
     * @param loginInfo 用户登陆信息
     * @return 超级助手信息
     */
    public SuasSuperassist createDefaultResourcesIfNotExists(LoginInfo loginInfo) {

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
        } else {

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
     * 按模板初始化默认数字员工。
     *
     * @param loginInfo        登陆用户信息
     * @param defaultDatasetId 默认个人知识库 ID
     * @return 默认超级助手数字员工资源 ID
     */
    private Long initDigEmployeeByTemplate(LoginInfo loginInfo, Long defaultDatasetId) {
        Long userId = loginInfo.getUserId();
        Long defaultDigEmployeeId = loginInfo.getDefaultDigEmployeeId();

        // 获取初始化模板
        String paramCode = "INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE";
        JSONArray initTemplates = this.getInitTemplateArray(loginInfo, paramCode);

        if (ListUtil.isEmpty(initTemplates)) {
            return defaultDigEmployeeId;
        }

        // 解析模型中的数字员工
        Map<String, AgentPrologueDto.ModelInfo> modelInfoMap = new HashMap<>();
        for (int i = 0; i < initTemplates.size(); i++) {

            JSONObject jsonObject = initTemplates.getJSONObject(i);

            String resourceCode = jsonObject.getString("resourceCode");
            String modelProtocol = jsonObject.getString("modelProtocol");
            String relToolCodes = jsonObject.getString("relToolCodes");
            String relOntologyCodes = jsonObject.getString("relOntologyCodes");
            String relSkillCodes = jsonObject.getString("relSkillCodes");
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
            } else {
                digitalEmployeeDTO.setRelIds(new ArrayList<>());
                digitalEmployeeDTO.setPrologue(this.buildPrologue(prologue, modelInfo, null));
            }

            // 关联工具agent|tool|view|object
            this.handleRelResourceCodes(digitalEmployeeDTO, relToolCodes, userId);

            // 关联对象
            this.handleRelResourceCodes(digitalEmployeeDTO, relOntologyCodes, userId);

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
     * @param loginInfo  登陆信息
     */
    private ResourceExtDigEmployeeDto compareDigEmployee(SsResource ssResource, JSONObject jsonObject, LoginInfo loginInfo) {

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

            } else {

                ssResExtDigEmployee = new SsResExtDigEmployee();
                ssResExtDigEmployee.setResourceId(ssResource.getResourceId());

                this.compareExtDigEmployee(ssResExtDigEmployee, jsonObject, loginInfo);

                ssResExtDigEmployeeService.save(ssResExtDigEmployee);
            }

            digitalEmployeeApplicationService.syncExistingDigEmployeeConfigToRedisQuietly(ssResource.getResourceId());


            ResourceExtDigEmployeeDto resourceExtDigEmployeeDto = new ResourceExtDigEmployeeDto();
            BeanUtil.copyProperties(ssResource, resourceExtDigEmployeeDto);
            resourceExtDigEmployeeDto.setSsResExtDigEmployee(ssResExtDigEmployee);
            return resourceExtDigEmployeeDto;

        } catch (Exception e) {
            logger.error(e.getMessage(), e);
            return null;
        }
    }

    /**
     * 添加关联关系
     *
     * @param resourceId    资源
     * @param relResourceId 关联资源
     * @param userId        用户
     * @param comAcctId     企业标识
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
     * 对比并补齐数字员工扩展属性及关联技能/工具。
     *
     * @param ssResExtDigEmployee 数字员工扩展信息
     * @param jsonObject          当前模板数据
     * @param loginInfo           登陆信息
     * @return 是否发生变更
     */
    private boolean compareExtDigEmployee(SsResExtDigEmployee ssResExtDigEmployee, JSONObject jsonObject,
                                          LoginInfo loginInfo) {

        Long userId = loginInfo.getUserId();
        Long comAcctId = loginInfo.getComAcctId();
        Long resourceId = ssResExtDigEmployee.getResourceId();

        String prologue = jsonObject.getString("prologue");
        String relToolCodes = jsonObject.getString("relToolCodes");
        String relOntologyCodes = jsonObject.getString("relOntologyCodes");

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

        // 关联资源
        List<String> resourceCodes = new ArrayList<>();
        resourceCodes.addAll(StringUtil.splitStr(relToolCodes, ","));
        resourceCodes.addAll(StringUtil.splitStr(relOntologyCodes, ","));
        for (String resourceCode : resourceCodes) {
            SsResourceDTO ssResourceDTO = relResourceMap.get(resourceCode);
            if (ssResourceDTO == null) {
                SsResource relSsResource = ssResourceService.findByIdOrCode(null, resourceCode);

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
     * 解析并关联工具编码到数字员工。
     *
     * @param digitalEmployeeDTO 数字员工新增对象
     * @param relResourceCodes   资源编码,关联工具agent|tool|view|object
     * @param userId             用户标识
     */
    private void handleRelResourceCodes(DigitalEmployeeDTO digitalEmployeeDTO, String relResourceCodes, Long userId) {

        List<String> splitToolCodes = StringUtil.splitStr(relResourceCodes, ",");
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
     * @param relSkillCodes      关联技能编码
     * @param userId             用户标识
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
     * @param userId     用户标识
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
     * 组装数字员工开场白，写入模型信息及可选默认知识库。
     *
     * @param prologue         开场白 JSON
     * @param modelInfo        默认模型信息
     * @param defaultDatasetId 默认知识库 ID，可为 null
     * @return 组装后的开场白 JSON
     */
    private String buildPrologue(String prologue, AgentPrologueDto.ModelInfo modelInfo, Long defaultDatasetId) {
        if (StringUtil.isEmpty(prologue)) {
            return null;
        }

        AgentPrologueDto agentPrologueDto = JSON.parseObject(prologue, AgentPrologueDto.class);
        agentPrologueDto.setModelId(modelInfo.getModelId());
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
     * 按模型协议解析或创建默认模型信息。
     *
     * @param modelProtocol 模型协议
     * @return 模型信息，默认模型不存在时返回 null
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
            } else {
                byaiAimodel = this.createTokenSaverModel(tokenSaver, modelProtocol);
            }
        } else if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
            DefaultAiModelQo defaultAiModelQo = new DefaultAiModelQo();
            defaultAiModelQo.setModelProtocol(modelProtocol);
            defaultAiModelQo.setModelType(Constants.DEFAULT_MODEL_TYPE_LLM);
            defaultAiModelQo.setStatus(Constants.STATUS_ENABLED);
            byaiAimodel = byaiAimodelService.getDefaultAiModel(defaultAiModelQo);
        } else {
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
        modelInfo.setModel(byaiAimodel.getModelName());
        modelInfo.setHistory(6);
        return modelInfo;
    }

    /**
     * 创建 TokenSaver 个人模型。
     *
     * @param tokenSaver    TokenSaver 配置
     * @param modelProtocol 模型协议
     * @return 新建的模型实体
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
        } else {
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
     * @param apiKey        密钥
     * @return String
     */
    private String buildInParams(String modelProtocol, String apiKey) {
        Map<String, Object> inParams = new HashMap<>();
        // 基础字段
        if (ModelProtocol.ANTHROPIC.equalsIgnoreCase(modelProtocol)) {
            Map<String, String> keyMap = Map.of("key", "x-api-key", "value", apiKey);
            Map<String, String> contentTypeMap = Map.of("key", "Content-Type", "value", "application/json");
            inParams.put("headers", List.of(keyMap, contentTypeMap));
        } else {
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
     * 获取初始化模板，替换用户占位符，并按当前语言环境取对应数组。
     *
     * @param loginInfo 登陆信息
     * @param paramCode 系统配置参数编码
     * @return 模板 JSON 数组
     */
    private JSONArray getInitTemplateArray(LoginInfo loginInfo, String paramCode) {


        String initTemplateStr = byaiSystemConfigService.findByParamCode(paramCode);
        if (StringUtil.isEmpty(initTemplateStr)) {
            return new JSONArray();
        }

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
        } else {
            return jsonObjectTemplate.getJSONArray(I18nUtil.CHINSES);
        }

    }

    /**
     * 解析当前用户默认数字员工 ID；优先取登录态缓存，否则回退查超级助手表。
     *
     * @return 默认数字员工资源 ID，不存在则返回 null
     */
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

    /**
     * 初始化专家团
     *
     * @param loginInfo 登陆信息
     */
    public void initExpertTeams(LoginInfo loginInfo) {

        try {

            // 放置用户到当前线程
            CurrentUserHolder.setLoginInfo(loginInfo);

            // 获取初始化模板
            String paramCode = "INIT_DEFAULT_PROJECT_EXPERT_TEAMS_TEMPLATE";
            JSONArray initTemplates = this.getInitTemplateArray(loginInfo, paramCode);


            for (int i = 0; initTemplates != null && i < initTemplates.size(); i++) {
                JSONObject jsonObject = initTemplates.getJSONObject(i);

                //初始化项目
                Project project = this.initProject(jsonObject, loginInfo);
                logger.info("初始化项目成功:{}", JSON.toJSONString(project));

                //初始化专家团
                Map<String, AgentPrologueDto.ModelInfo> modelInfoMap = new HashMap<String, AgentPrologueDto.ModelInfo>();

                JSONArray expertTeams = jsonObject.getJSONArray("expertTeams");
                for (int j = 0; expertTeams != null && j < expertTeams.size(); j++) {

                    JSONObject expertTeamTemplate = expertTeams.getJSONObject(j);

                    //初始化数字员工
                    List<EmployeeGroupMemberDTO> employeeGroupMembers = new ArrayList<>();
                    JSONArray digitalEmployees = expertTeamTemplate.getJSONArray("digitalEmployees");
                    for (int k = 0; digitalEmployees != null && k < digitalEmployees.size(); k++) {

                        JSONObject relEmployeeTemplate = digitalEmployees.getJSONObject(k);
                        ResourceExtDigEmployeeDto relEmployee = this.createEmployeeByTemplate(relEmployeeTemplate, loginInfo, modelInfoMap, Collections.emptyList());
                        SsResExtDigEmployee ssResExtDigEmployee = relEmployee.getSsResExtDigEmployee();

                        EmployeeGroupMemberDTO employeeGroupMemberDTO = new EmployeeGroupMemberDTO();
                        employeeGroupMemberDTO.setResourceId(relEmployee.getResourceId());
                        employeeGroupMemberDTO.setResourceCode(relEmployee.getResourceCode());
                        employeeGroupMemberDTO.setName(relEmployee.getResourceName());
                        employeeGroupMemberDTO.setDescription(relEmployee.getResourceDesc());
                        employeeGroupMemberDTO.setAvatar(relEmployee.getAvatar());
                        employeeGroupMemberDTO.setTeamRole(relEmployeeTemplate.getString("teamRole"));
                        employeeGroupMemberDTO.setSortOrder(k);
                        employeeGroupMemberDTO.setWorkerAgentType(relEmployee.getWorkerAgentType());
                        employeeGroupMemberDTO.setCreateType(ssResExtDigEmployee.getCreateType());
                        employeeGroupMemberDTO.setIntegrationType(ssResExtDigEmployee.getIntegrationType());
                        employeeGroupMemberDTO.setAgentType(ssResExtDigEmployee.getAgentType());
                        employeeGroupMembers.add(employeeGroupMemberDTO);
                    }

                    //创建专家团
                    ResourceExtDigEmployeeDto expertTeamEmployee = this.createEmployeeByTemplate(expertTeamTemplate, loginInfo, modelInfoMap, employeeGroupMembers);
                    logger.info("初始化专家团成功:{}", JSON.toJSONString(expertTeamEmployee));

                }
            }
        } catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }


    /**
     * 模拟模板创建数字员工
     *
     * @param jsonObject   模板对象
     * @param loginInfo    登陆信息
     * @param modelInfoMap 模型缓存
     * @return SsResource
     */
    private ResourceExtDigEmployeeDto createEmployeeByTemplate(JSONObject jsonObject, LoginInfo loginInfo, Map<String, AgentPrologueDto.ModelInfo> modelInfoMap, List<EmployeeGroupMemberDTO> employeeGroupMembers) {

        Long userId = loginInfo.getUserId();
        Long defaultDatasetId = loginInfo.getSessionDatasetId();

        String resourceCode = jsonObject.getString("resourceCode");
        String modelProtocol = jsonObject.getString("modelProtocol");
        String relToolCodes = jsonObject.getString("relToolCodes");
        String relOntologyCodes = jsonObject.getString("relOntologyCodes");
        String relSkillCodes = jsonObject.getString("relSkillCodes");
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
            return this.compareDigEmployee(ssResource, jsonObject, loginInfo);
        }

        DigitalEmployeeDTO digitalEmployeeDTO = new DigitalEmployeeDTO();
        MapParamUtil.copyProperties(jsonObject, digitalEmployeeDTO);
        digitalEmployeeDTO.setRelIds(new ArrayList<>());
        digitalEmployeeDTO.setRelResourceInfoList(new ArrayList<>());
        digitalEmployeeDTO.setEmployeeGroupMembers(employeeGroupMembers);

        // 其他类型数字员工设置默认模型
        String prologue = digitalEmployeeDTO.getPrologue();

        // 是否关联默认知识库
        if (Constants.YES_VALUE_Y.equalsIgnoreCase(isRelDefaultDataset)) {
            digitalEmployeeDTO.setRelIds(List.of(defaultDatasetId));
            digitalEmployeeDTO.setPrologue(this.buildPrologue(prologue, modelInfo, defaultDatasetId));
        } else {
            digitalEmployeeDTO.setRelIds(new ArrayList<>());
            digitalEmployeeDTO.setPrologue(this.buildPrologue(prologue, modelInfo, null));
        }

        // 关联工具agent|tool|view|object
        this.handleRelResourceCodes(digitalEmployeeDTO, relToolCodes, userId);


        this.handleRelResourceCodes(digitalEmployeeDTO, relOntologyCodes, userId);


        // 处理关联技能
        this.handleRelSkillCodes(digitalEmployeeDTO, relSkillCodes, userId);

        // 保存数字员工
        ResourceExtDigEmployeeDto extDigEmployeeDto = digitalEmployeeApplicationService.saveDigitalEmployee(digitalEmployeeDTO);

        // 同步openClaw工作空间：透传原始入参，relTools / relPrompt 等不入 DB 的运行期字段需要从入参直接进 JSON。
        digitalEmployeeApplicationService.synOpenClawWorkSpace(extDigEmployeeDto.getResourceId(), digitalEmployeeDTO);

        return extDigEmployeeDto;
    }


    /**
     * 按模板初始化项目；同名项目已存在则直接返回。
     *
     * @param jsonObject 项目模板配置
     * @return 项目实体
     */
    private Project initProject(JSONObject jsonObject, LoginInfo loginInfo) {

        String projectName = jsonObject.getString("projectName");
        String projectType = jsonObject.getString("projectType");
        String description = jsonObject.getString("description");
        String isShare = jsonObject.getString("isShare");

        //不存在则创建
        Project project = projectService.findByProjectName(projectName);
        if (project == null) {
            project = new Project();
            project.setProjectId(sequenceService.nextVal());
            project.setProjectName(projectName);
            project.setProjectType(projectType);
            project.setDescription(description);
            project.setIsShare(isShare);
            project.setCreateTime(new Date());
            project.setCreateBy(loginInfo.getUserId());

            //初始化云盘
            SsResource cloudResource = projectApplicationService.createCloudResource(project);
            project.setCloudResourceId(cloudResource.getResourceId());

            projectService.save(project);

        } else {

            // 初始化项目云盘
            Long cloudResourceId = project.getCloudResourceId();
            if (cloudResourceId == null) {
                SsResource cloudResource = projectApplicationService.createCloudResource(project);
                project.setCloudResourceId(cloudResource.getResourceId());
                projectService.update(project);
            }
        }

        // 将用户加入项目
        boolean isMember = projectMemberService.isMember(project.getProjectId(), loginInfo.getUserId());
        if (!isMember) {
            projectMemberService.addMember(project.getProjectId(), loginInfo.getUserId(), MemberRole.OWNER);
        }

        return project;
    }


    /**
     * 调用 DataCloud 提交工作区模板，初始化本体。
     *
     * @return 首个模板提交结果中的对象编码列表，无结果时返回空列表
     */
    private List<String> initSubmitWorkspaceTemplate() {

        Users users = userService.findByUserCode("adminvip");

        Map<String, String> headers = new HashMap<>();
        headers.put("X-User-Code", users.getUserCode());

        LoginInfo loginInfo = loginApplicationService.getLoginInfo(users.getUserCode());
        headers.put("Beyond-Token", jwtService.createJwt(loginInfo));
        headers.put("Content-Type", "application/json");

        SubmitWorkspaceTemplateReq submitTemplateReq = new SubmitWorkspaceTemplateReq();
        submitTemplateReq.setPersonal(false);
        submitTemplateReq.setSqlite(false);
        submitTemplateReq.setReuseTargetTables(true);
        submitTemplateReq.setConfirmDropTargetTables(false);
        logger.info("初始化DataCloud本体请求:{}", JSON.toJSONString(submitTemplateReq));
        DataCloudResponse<TemplateSubmitResp> dataCloudResponse = feignDataCloudService.submitWorkspaceTemplates(submitTemplateReq, headers);
        logger.info("初始化DataCloud本体返回:{}", JSON.toJSONString(dataCloudResponse));

        TemplateSubmitResp templateSubmitResp = dataCloudResponse.getData();
        List<TemplateSubmitResult> results = templateSubmitResp.getResults();

        return ListUtil.isNotEmpty(results) ? results.getFirst().getObjectCodes() : Collections.emptyList();
    }

}
