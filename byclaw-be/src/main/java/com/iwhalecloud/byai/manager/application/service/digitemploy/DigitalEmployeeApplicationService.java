package com.iwhalecloud.byai.manager.application.service.digitemploy;

import cn.hutool.core.bean.BeanUtil;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.common.constants.resource.*;
import com.iwhalecloud.byai.common.message.qo.MessageHotDelQo;
import com.iwhalecloud.byai.gateway.channels.service.robot.RobotChannelRegistryCoordinator;
import com.iwhalecloud.byai.common.constants.auth.GrantToObjType;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.application.service.memory.MemoryLibraryApplicationService;
import com.iwhalecloud.byai.manager.application.service.ontology.OntologyResourceValidityService;
import com.iwhalecloud.byai.manager.application.service.template.TemplateRuleInfoApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiPromptService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.OperationLogService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceEventService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtAgentService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtObjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolKitService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtViewService;
import com.iwhalecloud.byai.manager.domain.resource.util.DigEmployeeRedisKeys;
import com.iwhalecloud.byai.manager.domain.session.service.ByaiSessionService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.vo.digitemploy.DebugSessionCleanupVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeInstallResourceDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo;
import com.iwhalecloud.byai.manager.dto.digitemploy.SetDefaultDigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.template.MemoryConfigDTO;
import com.iwhalecloud.byai.manager.entity.aimodel.AiPrompt;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAgent;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.index.OrgFilterQo;
import com.iwhalecloud.byai.manager.qo.resource.AgentListQo;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.request.conversation.AgentPrologueDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.digitemploy.DebugSessionVo;
import com.iwhalecloud.byai.manager.vo.digitemploy.SetDefaultDigitalEmployeeResultVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.util.RedisUtil;
import jakarta.servlet.http.HttpSession;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.common.feign.client.FeignPythonToolService;
import com.iwhalecloud.byai.common.feign.request.python.CoreCompetency;
import com.iwhalecloud.byai.common.feign.request.python.DigEmployeeExtCore;
import com.iwhalecloud.byai.common.feign.request.python.EmployeeAudit;
import com.iwhalecloud.byai.common.feign.response.PythonToolResponse;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.feign.response.python.EmployeeAuditResult;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.collections4.MapUtils;
import org.apache.commons.lang3.math.NumberUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * @author he.duming &#064;date 2025-10-29 00:21:39 &#064;description TODO
 */
@Service
public class DigitalEmployeeApplicationService {

    public static final Logger logger = LoggerFactory.getLogger(DigitalEmployeeApplicationService.class);

    private static final String RESOURCE_BIZ_TYPE_SKILL = "SKILL";

    private static final String BELONG_COMPANY = "COMPANY";

    private static final String DEFAULT_SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX = "_main";

    private static final int DIG_EMPLOYEE_TEXT_FIELD_MAX_LENGTH = 4000;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private OntologyResourceValidityService ontologyResourceValidityService;

    @Autowired
    private ResourceRuntimeInfoResolver resourceRuntimeInfoResolver;

    @Autowired
    private FeignPythonToolService feignPythonService;

    @Autowired
    private OperationLogService operationLogService;

    @Autowired
    private ResourceEventService resourceEventService;

    @Autowired
    private AiModelService aiModelService;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private SsResExtToolKitService ssResExtToolKitService;

    @Autowired
    private SsResExtMcpService ssResExtMcpService;

    @Autowired
    private SsResExtAgentService ssResExtAgentService;

    @Autowired
    private SsResExtDocService ssResExtDocService;

    @Autowired
    private SsResExtViewService ssResExtViewService;

    @Autowired
    private SsResExtObjectService ssResExtObjectService;

    @Autowired
    private SsResExtSkillService ssResExtSkillService;

    @Autowired
    private TemplateRuleInfoApplicationService templateRuleInfoApplicationService;

    @Autowired
    private MemoryLibraryApplicationService memoryLibraryApplicationService;

    @Autowired
    private ResourceAuthContextService resourceAuthContextService;

    @Autowired
    private IndexService indexService;

    @Autowired
    private ResourceArtifactStorageService resourceArtifactStorageService;

    @Autowired
    private SsResourceArtifactService ssResourceArtifactService;

    @Autowired
    private ByaiSessionService byaiSessionService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private AIService aiService;

    @Autowired
    private AiPromptService aiPromptService;

    @Autowired
    private ByaiSystemConfigListService byaiSystemConfigListService;

    @Value("${file.storage.type:minio}")
    private String storageType;

    /**
     * 知识库/数字员工系统来源配置；配置为 WHALE_AGENT 时表示接入老智能体商业版本， 部分数字员工类型不允许在本系统创建。
     */
    @Value("${dataset.system:}")
    private String datasetSystem;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    @Autowired
    private UserService userService;

    @Autowired
    private RobotChannelRegistryCoordinator robotChannelRegistryCoordinator;

    @Autowired
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;

    @Autowired
    private DigEmployeeRedisSyncProperties digEmployeeRedisSyncProperties;

    /**
     * 查询列表
     *
     * @param digitalEmployeeQo 查询对象
     * @return SsResource
     */
    public PageInfo<DigitalEmployeePageVo> selectDigitalEmployeeByQo(DigitalEmployeeQo digitalEmployeeQo) {

        // 设置用户上下文信息
        resourceAuthContextService.setCurrentUserAuthQo(digitalEmployeeQo);
        fillCatalogIds(digitalEmployeeQo);

        PageInfo<DigitalEmployeePageVo> pageInfo = ssResExtDigEmployeeService
            .selectDigitalEmployeeByQo(digitalEmployeeQo);
        return pageInfo;
    }

    /**
     * 给知识前端使用的通用数字员工列表查询。 规则说明： 1. 不限定 ownerType，也不限定 owner/authorize/manager 视角，默认按“全部”查询； 2. 若前端未传 publishType，则默认查询
     * publish； 3. 若前端未传 publishStatus，则默认查询有效状态 2（LIST）； 4. 当前数字员工列表仍使用 ss_resource.resource_status 做状态过滤，因此
     * publishStatus 会收口到 resourceStatus。
     */
    public PageInfo<DigitalEmployeeVo> queryAllDigitalEmployeeList(DigitalEmployeeQo digitalEmployeeQo) {
        if (digitalEmployeeQo == null) {
            digitalEmployeeQo = new DigitalEmployeeQo();
        }
        if (StringUtils.isBlank(digitalEmployeeQo.getPublishType())) {
            digitalEmployeeQo.setPublishType("publish");
        }
        boolean includeAllResourceStatus = Boolean.TRUE.equals(digitalEmployeeQo.getIncludeAllResourceStatus());
        if (!includeAllResourceStatus && digitalEmployeeQo.getPublishStatus() == null) {
            digitalEmployeeQo.setPublishStatus(ResourceStatus.LIST.getNum());
        }
        if (!includeAllResourceStatus && digitalEmployeeQo.getResourceStatus() == null) {
            digitalEmployeeQo.setResourceStatus(Long.valueOf(digitalEmployeeQo.getPublishStatus()));
        }
        // 填充当前用户上下文，仅用于黑名单、权限筛选和待审核/申请中状态判断，不收窄企业全量查询范围。
        resourceAuthContextService.setCurrentUserAuthQo(digitalEmployeeQo);
        fillPublishOrgIds(digitalEmployeeQo);
        fillCatalogIds(digitalEmployeeQo);
        // 显式清空旧版视角类型，确保这里始终以企业资源全量为基础。
        digitalEmployeeQo.setType(null);
        PageInfo<DigitalEmployeeVo> pageInfo = ssResExtDigEmployeeService
            .selectAllDigitalEmployeeByQo(digitalEmployeeQo);
        fillRuntimeDigitalEmployeeTags(pageInfo);
        return pageInfo;
    }

    /**
     * 查询个人归属数字员工列表。 规则说明： 1. 仅查询 ownerType = personal； 2. 查询范围覆盖我创建、我管理、我使用； 3. 若前端未传 publishType，则默认查询 publish； 4.
     * 若前端未传 publishStatus，则默认查询有效状态 2（LIST）； 5. 关键字支持匹配数字员工名称、数字员工描述。
     */
    public PageInfo<DigitalEmployeeVo> queryPersonalDigitalEmployeeList(DigitalEmployeeQo digitalEmployeeQo) {
        resourceAuthContextService.setCurrentUserAuthQo(digitalEmployeeQo);
        digitalEmployeeQo.setDefaultDigEmployeeId(CurrentUserHolder.getDefaultDigEmployeeId());
        // 默认超级助手在被其它个人助理替换为当前默认后，仍保持 personal_default，
        // 个人助理列表需要继续按稳定 resourceCode={userCode}_main 展示它。
        digitalEmployeeQo.setDefaultSuperAssistantResourceCode(buildDefaultSuperAssistantResourceCode(
            CurrentUserHolder.getCurrentUserCode(), CurrentUserHolder.getCurrentUserId()));
        fillCatalogIds(digitalEmployeeQo);
        PageInfo<DigitalEmployeeVo> pageInfo = ssResExtDigEmployeeService
            .selectPersonalDigitalEmployeeByQo(digitalEmployeeQo);
        fillRuntimeDigitalEmployeeTags(pageInfo);
        return pageInfo;
    }

    /**
     * 数字员工标签不再依赖 ss_res_ext_dig_employee.tag_name 落库值，列表返回前按当前资源归属实时计算： personal + resourceCode 后缀 _main 为超级助手，其他
     * personal 为个人助理，enterprise 按 agentType 显示类型。
     */
    private void fillRuntimeDigitalEmployeeTags(PageInfo<DigitalEmployeeVo> pageInfo) {
        if (pageInfo == null || CollectionUtils.isEmpty(pageInfo.getList())) {
            return;
        }
        for (DigitalEmployeeVo digitalEmployeeVo : pageInfo.getList()) {
            if (digitalEmployeeVo == null) {
                continue;
            }
            digitalEmployeeVo.setTagName(buildDigitalEmployeeTagName(digitalEmployeeVo.getOwnerType(),
                digitalEmployeeVo.getResourceCode(), digitalEmployeeVo.getAgentType()));
        }
    }

    private void fillPublishOrgIds(DigitalEmployeeQo digitalEmployeeQo) {
        if (digitalEmployeeQo == null) {
            return;
        }
        if (StringUtils.equals(digitalEmployeeQo.getBelong(), BELONG_COMPANY)) {
            digitalEmployeeQo.setPublishOrgIds(indexService.findTopOrgId());
            return;
        }
        if (CollectionUtils.isEmpty(digitalEmployeeQo.getOrgFilters())) {
            return;
        }
        List<Long> publishOrgIds = new ArrayList<>();
        for (OrgFilterQo orgFilter : digitalEmployeeQo.getOrgFilters()) {
            if (orgFilter != null && orgFilter.getObjectId() != null) {
                publishOrgIds.add(orgFilter.getObjectId());
            }
        }
        digitalEmployeeQo.setPublishOrgIds(publishOrgIds);
    }

    private void fillCatalogIds(DigitalEmployeeQo digitalEmployeeQo) {
        if (digitalEmployeeQo == null || digitalEmployeeQo.getCatalogId() == null) {
            return;
        }
        digitalEmployeeQo
            .setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(digitalEmployeeQo.getCatalogId()));
    }

    private void validateDigitalEmployeeTextFieldLengths(DigitalEmployeeDTO digitalEmployeeDTO) {
        if (digitalEmployeeDTO == null) {
            return;
        }
        validateDigitalEmployeeTextFieldLength("digemployee.field.ability", digitalEmployeeDTO.getAbility());
        validateDigitalEmployeeTextFieldLength("digemployee.field.constraints", digitalEmployeeDTO.getConstraints());
        validateDigitalEmployeeTextFieldLength("digemployee.field.faqs", digitalEmployeeDTO.getFaqs());
        validateDigitalEmployeeTextFieldLength("digemployee.field.roleAttributes", digitalEmployeeDTO.getRoleAttributes());
        validateDigitalEmployeeTextFieldLength("digemployee.field.processingFlow", digitalEmployeeDTO.getProcessingFlow());
        validateDigitalEmployeeTextFieldLength("digemployee.field.personalityDimensions",
            digitalEmployeeDTO.getPersonalityDimensions());
        validateDigitalEmployeeTextFieldLength("digemployee.field.wordPreferences", digitalEmployeeDTO.getWordPreferences());
        validateDigitalEmployeeTextFieldLength("digemployee.field.sentenceAndTone", digitalEmployeeDTO.getSentenceAndTone());
        validateDigitalEmployeeTextFieldLength("digemployee.field.corePersonaDefinition",
            digitalEmployeeDTO.getCorePersonaDefinition());
        validateDigitalEmployeeTextFieldLength("digemployee.field.coreCompetencies", digitalEmployeeDTO.getCoreCompetencies());
        validateDigitalEmployeeTextFieldLength("digemployee.field.advancedSettings", digitalEmployeeDTO.getAdvancedSettings());
    }

    private void validateDigitalEmployeeTextFieldLength(String fieldLabelKey, String value) {
        if (StringUtils.isEmpty(value)) {
            return;
        }
        int length = value.codePointCount(0, value.length());
        if (length > DIG_EMPLOYEE_TEXT_FIELD_MAX_LENGTH) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.field.length.exceed", I18nUtil.get(fieldLabelKey),
                    DIG_EMPLOYEE_TEXT_FIELD_MAX_LENGTH, length));
        }
    }

    /**
     * 创建数字员工
     *
     * @param digitalEmployeeDTO 数字员工
     * @return ResponseUtil
     */
    @Transactional(rollbackFor = Exception.class)
    public SsResource saveDigitalEmployee(DigitalEmployeeDTO digitalEmployeeDTO) {

        boolean isFrontAccess = digitalEmployeeDTO.isFrontAccess();
        normalizeRelSkillsForSave(digitalEmployeeDTO);
        validateDigitalEmployeeTextFieldLengths(digitalEmployeeDTO);
        // 商业版本（dataset.system=WHALE_AGENT）下，企业 tab 不允许创建编码型（011）/ 调试型（010）数字员工
        validateCommercialEditionDigitalEmployeeCreation(digitalEmployeeDTO);
        String resourceName = digitalEmployeeDTO.getResourceName();
        long count = ssResourceService.countResource(resourceName, ResourceBizTypeEnum.DIG_EMPLOYEE.name(), null);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("digemployee.name.duplicate"));
        }

        // 保存资源表
        SsResource ssResource = new SsResource();
        BeanUtil.copyProperties(digitalEmployeeDTO, ssResource);
        ssResource.setResourceId(sequenceService.nextVal());
        if (StringUtils.isNotEmpty(digitalEmployeeDTO.getSystemCode())) {
            ssResource.setSystemCode(digitalEmployeeDTO.getSystemCode());
        }
        else {
            ssResource.setSystemCode(SystemCode.BYAI.getCode());
        }
        ssResource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        if (StringUtils.isNotEmpty(digitalEmployeeDTO.getResourceCode())) {
            ssResource.setResourceCode(digitalEmployeeDTO.getResourceCode());
        }
        ssResource.setCreateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResource.setCreateTime(new Date());
        ssResource.setResourceStatus(ResourceStatus.LIST.getNum());
        ssResource.setResourceType("COMBIN");
        Set<Long> userOrgIds = CurrentUserHolder.getUserOrgIds();
        ssResource.setManOrgId(CollectionUtils.isEmpty(userOrgIds) ? null : userOrgIds.iterator().next());
        ssResource.setManUserId(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        // 数字员工 personal / enterprise 归属口径统一落到资源主表，供个人视角查询等场景直接过滤使用。
        ssResource.setOwnerType(StringUtils.trimToNull(digitalEmployeeDTO.getOwnerType()));
        ssResource.setResourceDVerid(1L);
        ssResource.setResourceRVerid(0L);
        fillDigitalEmployeeImplInfo(ssResource, digitalEmployeeDTO.getAgentType());
        ssResourceService.saveResource(ssResource);

        // 保存扩展表
        SsResExtDigEmployee ssResExtDigEmployee = new SsResExtDigEmployee();
        BeanUtil.copyProperties(digitalEmployeeDTO, ssResExtDigEmployee);
        ssResExtDigEmployee.setResourceId(ssResource.getResourceId());
        ssResExtDigEmployee.setAgentSseUrl(ssResExtDigEmployee.getAgentSseUrlOri());
        ssResExtDigEmployee.setAgentWebUrl(ssResExtDigEmployee.getAgentWebUrlOri());
        ssResExtDigEmployee.setAgentAdminUrlList(ssResExtDigEmployee.getAgentAdminUrlOriList());
        ssResExtDigEmployeeService.save(ssResExtDigEmployee);

        // 保存关联关系
        List<Long> relIds = mergeRelSkillIds(digitalEmployeeDTO.getRelIds(), digitalEmployeeDTO.getRelSkills());
        this.compareSsResourceRelDetail(ssResource, relIds, Collections.emptyList(),
            digitalEmployeeDTO.getRelResourceInfoList());
        this.rebuildAndSaveDigitalEmployeeRelSkills(ssResource.getResourceId());

        // 暂停生成 RESOURCE_DIG_EMPLOYEE_{resourceId} 旧技能缓存，当前运行时改读 DIG_EMPLOYEE_{resourceId}。
        // this.syncDigEmployeeSkillsToRedisQuietly(ssResource.getResourceId());

        // 前台的直接上架给予使用权限
        if (isFrontAccess) {
            resourceEventService.sendResourceShelfEvent(ssResource);
        }

        authApplicationService.ensureCreatorDefaultPrivileges(ssResource);

        // 记录操作日志
        operationLogService.recordOperationLog(ssResource, OperationTypeEnum.CREATE);
        // 保存模版关联关系（记忆配置）
        // 优先使用 memoryConfigList
        List<MemoryConfigDTO> memoryConfigList = digitalEmployeeDTO.getMemoryConfigList();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (!CollectionUtils.isEmpty(memoryConfigList)) {
            // 创建记忆库
            Long memoryLibraryId = null;
            try {
                memoryLibraryId = memoryLibraryApplicationService.createOrGetMemoryLibraryForDigitalEmployee(
                    ssResource.getResourceId(), currentUserId, "DIGITAL_EMPLOYEE", ssResource.getResourceName(),
                    ssResource.getResourceDesc());
            }
            catch (Exception e) {
                // 记录日志但不影响主流程
                logger.error("创建数字员工记忆库失败，resourceId: {}, error: {}", ssResource.getResourceId(), e.getMessage(), e);
            }
            // 使用新的 memoryConfigList 方式保存（带用户ID条件删除）
            templateRuleInfoApplicationService.saveResourceTemplateRelationsByMemoryConfig(ssResource.getResourceId(),
                memoryConfigList, currentUserId, memoryLibraryId);
        }

        robotChannelRegistryCoordinator.registerForResource(ssResource.getResourceId());

        digEmployeeChangeEventPublisher.publishAfterCommitOrNow(DigEmployeeChangeEventType.DIG_EMPLOYEE_CREATED,
            ssResource.getResourceId());

        return ssResource;
    }

    /**
     * 创建用户默认超级助手，资源保存仍复用 saveDigitalEmployee 主链路。 默认超级助手本质上仍是真实 DIG_EMPLOYEE 资源，固定 resourceCode={userCode}_main，
     * 前后端都按数字员工处理，避免再出现 HUMAN_ASSISTANT / DIG_EMPLOYEE 两套表达。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     * @param userId 用户ID
     * @param userCode 用户编码
     * @param userName 用户名称
     * @param dataset 默认个人知识库
     * @return 默认超级助手资源
     */
    public SsResource saveDefaultSuperAssistant(Long userId, String userCode, String userName, SsResource dataset) {
        String safeUserCode = StringUtils.defaultIfBlank(userCode, String.valueOf(userId));
        String safeUserName = StringUtils.defaultIfBlank(userName, safeUserCode);
        String resourceName = I18nUtil.get("digemployee.default.super.assistant.resource.name", safeUserName);

        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceName(resourceName);
        dto.setResourceCode(buildDefaultSuperAssistantResourceCode(safeUserCode, userId));
        dto.setResourceDesc(resourceName);
        dto.setOwnerType(OwnerType.PERSONAL);
        dto.setAvatar("default");
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        dto.setAgentDevType("byai");
        dto.setCreateType("FROM_MANUALLY");
        dto.setTerminal("ALL");
        dto.setHomeType("default");
        dto.setIntegrationType("NONE");
        dto.setOpenSuperHelper("T");
        dto.setAbility(I18nUtil.get("digemployee.default.super.assistant.ability"));
        dto.setConstraints(I18nUtil.get("digemployee.default.super.assistant.constraints"));
        dto.setFaqs(I18nUtil.get("digemployee.default.super.assistant.faqs"));
        dto.setCorePersonaDefinition(resourceName);
        dto.setPrologue(this.buildDefaultPersonalAssistantPrologue(resourceName, dataset));
        dto.setImplType(ImplType.ASK_AGENT.getCode());
        // dto.setWorkerAgentType(WorkerAgentType.BYCLAW_EXE.getCode());
        if (dataset != null && dataset.getResourceId() != null) {
            dto.setRelIds(List.of(dataset.getResourceId()));
        }
        return this.saveDigitalEmployee(dto);
    }

    /**
     * 生成默认超级助手资源编码。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     * @param userCode 用户编码
     * @param userId 用户ID
     * @return 默认超级助手资源编码
     */
    public static String buildDefaultSuperAssistantResourceCode(String userCode, Long userId) {
        String safeUserCode = StringUtils.defaultIfBlank(userCode, String.valueOf(userId));
        return safeUserCode + DEFAULT_SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX;
    }

    /**
     * 数字员工展示标签统一运行时生成，不再写入扩展表 tag_name。
     */
    private String buildDigitalEmployeeTagName(String ownerType, String resourceCode, String agentType) {
        if (OwnerType.PERSONAL.equals(ownerType) || OwnerType.PERSONAL_DEFAULT.equals(ownerType)) {
            return StringUtils.endsWith(resourceCode, DEFAULT_SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX)
                ? I18nUtil.get("digemployee.tag.super.assistant")
                : I18nUtil.get("digemployee.tag.personal.assistant");
        }
        if (OwnerType.ENTERPRISE.equals(ownerType)) {
            DigitalEmployType digitalEmployType = DigitalEmployType.getByCode(agentType);
            return digitalEmployType == null ? null
                : I18nUtil.get(getEnterpriseDigitalEmployeeTagNameKey(digitalEmployType));
        }
        return null;
    }

    private String getEnterpriseDigitalEmployeeTagNameKey(DigitalEmployType digitalEmployType) {
        return switch (digitalEmployType) {
            case AGENT_TYPE_ASSISTANT -> "digemployee.tag.agent.assistant";
            case AGENT_TYPE_DATA -> "digemployee.tag.agent.data";
            case AGENT_TYPE_QA -> "digemployee.tag.agent.qa";
            case AGENT_TYPE_DEBUG -> "digemployee.tag.agent.debug";
            case AGENT_TYPE_CODE -> "digemployee.tag.agent.code";
        };
    }

    private String buildDefaultPersonalAssistantPrologue(String resourceDesc, SsResource dataset) {
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
        if (dataset != null) {
            prologue.setDefaultDatasetId(dataset.getResourceId());
        }
        prologue.setModelInfo(this.buildDefaultModelInfo());
        return JSON.toJSONString(prologue);
    }

    private AgentPrologueDto.ModelInfo buildDefaultModelInfo() {
        ModelDto modelDto = aiModelService.getDefaultChatModel();
        if (modelDto == null) {
            logger.error("当前默认模型不存在，默认个人助理将使用空模型配置初始化");
            return null;
        }

        AgentPrologueDto.ModelInfo modelInfo = new AgentPrologueDto.ModelInfo();
        modelInfo.setMaxToken(NumberUtils.toInt(modelDto.getMaxContentToken(), 0));
        modelInfo.setModelId(NumberUtils.toLong(modelDto.getInstanceId(), 0L));
        modelInfo.setTemperature("0.1");
        modelInfo.setModel(modelDto.getModelCode());
        modelInfo.setHistory(6);
        return modelInfo;
    }

    /**
     * 根据数字员工类型回填 ss_resource 的实现方式与 Worker 注册类型。
     *
     * @author qin.guoquan
     * @date 2026-04-25 15:42:00
     */
    private void fillDigitalEmployeeImplInfo(SsResource ssResource, String agentType) {
        resourceRuntimeInfoResolver.fillResource(ssResource,
            resourceRuntimeInfoResolver.resolveDigitalEmployee(agentType, ssResource.getResourceId()));
    }

    /**
     * 更新数字员工
     *
     * @param digitalEmployeeDTO 修改对象
     * @return SsResource
     */
    @Transactional(rollbackFor = Exception.class)
    public SsResource updateDigitalEmployee(DigitalEmployeeDTO digitalEmployeeDTO) {

        boolean isFrontAccess = digitalEmployeeDTO.isFrontAccess();
        normalizeRelSkillsForSave(digitalEmployeeDTO);
        validateDigitalEmployeeTextFieldLengths(digitalEmployeeDTO);

        Long resourceId = digitalEmployeeDTO.getResourceId();
        String resourceName = digitalEmployeeDTO.getResourceName();
        long count = ssResourceService.countResource(resourceName, ResourceBizTypeEnum.DIG_EMPLOYEE.name(), resourceId);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("digemployee.name.duplicate"));
        }

        // 更新资源表
        SsResource ssResource = ssResourceService.findById(resourceId);
        validateDigitalEmployeeUpdatePermission(ssResource);
        if (isDefaultPersonalResource(ssResource)) {
            // 默认个人助理始终按助手型运行，避免前端旧参数把 worker_agent_type 覆盖成编码型等其他类型。
            digitalEmployeeDTO.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        }
        BeanUtil.copyProperties(digitalEmployeeDTO, ssResource);
        ssResource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setUpdateTime(new Date());
        ssResource.setResourceStatus(ResourceStatus.LIST.getNum());
        // 更新时允许前端同步调整资源归属类型，避免个人资源仍保留旧的 owner_type。
        ssResource.setOwnerType(StringUtils.trimToNull(digitalEmployeeDTO.getOwnerType()));
        fillDigitalEmployeeImplInfo(ssResource, digitalEmployeeDTO.getAgentType());
        ssResourceService.updateResourceEntity(ssResource);

        // 更新扩展表
        SsResExtDigEmployee ssResExtDigEmployee = ssResExtDigEmployeeService.findById(resourceId);
        BeanUtil.copyProperties(digitalEmployeeDTO, ssResExtDigEmployee);
        ssResExtDigEmployee.setAgentSseUrl(ssResExtDigEmployee.getAgentSseUrlOri());
        ssResExtDigEmployee.setAgentWebUrl(ssResExtDigEmployee.getAgentWebUrlOri());
        ssResExtDigEmployee.setAgentAdminUrlList(ssResExtDigEmployee.getAgentAdminUrlOriList());
        // tagName 统一由查询接口运行时计算，避免前端回传旧标签又写回扩展表。
        ssResExtDigEmployee.setTagName(null);
        ssResExtDigEmployeeService.update(ssResExtDigEmployee);

        // 关联资源对比
        List<Long> relIds = mergeRelSkillIds(digitalEmployeeDTO.getRelIds(), digitalEmployeeDTO.getRelSkills());
        List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.findByResourceId(resourceId);
        this.compareSsResourceRelDetail(ssResource, relIds, resourceRelDetails,
            digitalEmployeeDTO.getRelResourceInfoList());
        this.rebuildAndSaveDigitalEmployeeRelSkills(resourceId);
        // 暂停生成 RESOURCE_DIG_EMPLOYEE_{resourceId} 旧技能缓存，当前运行时改读 DIG_EMPLOYEE_{resourceId}。
        // this.syncDigEmployeeSkillsToRedisQuietly(resourceId);

        // 前台的直接上架
        if (isFrontAccess) {
            resourceEventService.sendResourceShelfEvent(ssResource);
        }

        // 记录操作日志
        operationLogService.recordOperationLog(ssResource, OperationTypeEnum.UPDATE);
        // 保存模版关联关系（记忆配置）
        List<MemoryConfigDTO> memoryConfigList = digitalEmployeeDTO.getMemoryConfigList();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        Long memoryLibraryId = null;

        if (!CollectionUtils.isEmpty(memoryConfigList)) {
            // 创建或获取记忆库
            try {
                memoryLibraryId = memoryLibraryApplicationService.createOrGetMemoryLibraryForDigitalEmployee(resourceId,
                    currentUserId, "DIGITAL_EMPLOYEE", ssResource.getResourceName(), ssResource.getResourceDesc());
            }
            catch (Exception e) {
                // 记录日志但不影响主流程
                logger.error("创建数字员工记忆库失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
            }
            // 使用新的 memoryConfigList 方式保存（带用户ID条件删除）
            templateRuleInfoApplicationService.saveResourceTemplateRelationsByMemoryConfig(resourceId, memoryConfigList,
                currentUserId, memoryLibraryId);
        }

        robotChannelRegistryCoordinator.refreshForResource(resourceId);

        digEmployeeChangeEventPublisher.publishAfterCommitOrNow(DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED,
            resourceId);

        return ssResource;
    }

    /**
     * 增量安装知识或资源到数字员工，保留已有关联关系。
     *
     * @param installResourceDTO 安装入参
     * @return 数字员工详情
     */
    @Transactional(rollbackFor = Exception.class)
    public DigitalEmployeeDetailsDTO installDigitalEmployeeRelResources(
        DigitalEmployeeInstallResourceDTO installResourceDTO) {
        Long digitalEmployeeId = installResourceDTO == null ? null : installResourceDTO.getDigitalEmployeeId();
        List<Long> installRelIds = installResourceDTO == null ? null : installResourceDTO.getRelIds();
        if (digitalEmployeeId == null || CollectionUtils.isEmpty(installRelIds)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.processor.param.notnull"));
        }

        SsResource ssResource = ssResourceService.findById(digitalEmployeeId);
        List<SsResource> installRelResources = findInstallRelResources(installRelIds);
        if (containsSkillResource(installRelResources)) {
            validateSkillInstallPermission(ssResource, installRelResources);
        }
        else {
            validateDigitalEmployeeUpdatePermission(ssResource);
        }

        List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.findByResourceId(digitalEmployeeId);
        LinkedHashSet<Long> mergedRelIds = new LinkedHashSet<>();
        if (CollectionUtils.isNotEmpty(resourceRelDetails)) {
            mergedRelIds.addAll(
                resourceRelDetails.stream().map(SsResourceRelDetail::getRelResourceId).collect(Collectors.toList()));
        }
        mergedRelIds.addAll(installRelIds);

        this.compareSsResourceRelDetail(ssResource, new ArrayList<>(mergedRelIds), resourceRelDetails, null);
        this.rebuildAndSaveDigitalEmployeeRelSkills(digitalEmployeeId);
        // 暂停生成 RESOURCE_DIG_EMPLOYEE_{resourceId} 旧技能缓存，当前运行时改读 DIG_EMPLOYEE_{resourceId}。
        // this.syncDigEmployeeSkillsToRedisQuietly(digitalEmployeeId);
        this.synOpenClawWorkSpace(digitalEmployeeId);
        operationLogService.recordOperationLog(ssResource, OperationTypeEnum.UPDATE);

        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(digitalEmployeeId);
        return this.findDetailsById(employeeIdDTO);
    }

    /**
     * 从数字员工卸载知识或资源，仅解除关联关系，不删除资源本身。
     *
     * @param uninstallResourceDTO 卸载入参
     * @return 数字员工详情
     */
    @Transactional(rollbackFor = Exception.class)
    public DigitalEmployeeDetailsDTO uninstallDigitalEmployeeRelResources(
        DigitalEmployeeInstallResourceDTO uninstallResourceDTO) {
        Long digitalEmployeeId = uninstallResourceDTO == null ? null : uninstallResourceDTO.getDigitalEmployeeId();
        List<Long> uninstallRelIds = uninstallResourceDTO == null ? null : uninstallResourceDTO.getRelIds();
        if (digitalEmployeeId == null || CollectionUtils.isEmpty(uninstallRelIds)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.processor.param.notnull"));
        }

        SsResource ssResource = ssResourceService.findById(digitalEmployeeId);
        List<SsResource> uninstallRelResources = findInstallRelResources(uninstallRelIds);
        if (containsSkillResource(uninstallRelResources)) {
            validateSkillUninstallPermission(ssResource);
        }
        else {
            validateDigitalEmployeeUpdatePermission(ssResource);
        }

        List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.findByResourceId(digitalEmployeeId);
        Set<Long> uninstallRelIdSet = uninstallRelIds.stream().filter(Objects::nonNull).collect(Collectors.toSet());
        List<Long> remainingRelIds = CollectionUtils.isEmpty(resourceRelDetails) ? Collections.emptyList()
            : resourceRelDetails.stream().map(SsResourceRelDetail::getRelResourceId).filter(Objects::nonNull)
                .filter(relResourceId -> !uninstallRelIdSet.contains(relResourceId)).distinct()
                .collect(Collectors.toList());

        this.compareSsResourceRelDetail(ssResource, remainingRelIds, resourceRelDetails, null);
        this.rebuildAndSaveDigitalEmployeeRelSkills(digitalEmployeeId);
        this.synOpenClawWorkSpace(digitalEmployeeId);
        operationLogService.recordOperationLog(ssResource, OperationTypeEnum.UPDATE);

        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(digitalEmployeeId);
        return this.findDetailsById(employeeIdDTO);
    }

    /**
     * 以给定的全量目标 relIds 覆盖式同步数字员工的关联资源明细，并触发运行期重同步。
     * 供本体绑定等场景复用：调用方自行计算好目标集合（多退少补），本方法只做落库 + 同步。
     *
     * @param digitalEmployeeId 数字员工资源 ID
     * @param targetRelIds 目标全量关联资源 ID（为空表示清空全部关联）
     */
    @Transactional(rollbackFor = Exception.class)
    public void syncRelResourcesByTargetIds(Long digitalEmployeeId, List<Long> targetRelIds) {
        if (digitalEmployeeId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.processor.param.notnull"));
        }
        SsResource ssResource = ssResourceService.findById(digitalEmployeeId);
        List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.findByResourceId(digitalEmployeeId);
        List<Long> safeTarget = targetRelIds == null ? Collections.emptyList()
            : targetRelIds.stream().filter(Objects::nonNull).distinct().collect(Collectors.toList());
        this.compareSsResourceRelDetail(ssResource, safeTarget, resourceRelDetails, null);
        this.rebuildAndSaveDigitalEmployeeRelSkills(digitalEmployeeId);
        this.synOpenClawWorkSpace(digitalEmployeeId);
        operationLogService.recordOperationLog(ssResource, OperationTypeEnum.UPDATE);
    }

    private List<SsResource> findInstallRelResources(List<Long> installRelIds) {
        List<Long> distinctRelIds = installRelIds.stream().filter(Objects::nonNull).distinct()
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(distinctRelIds)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.processor.param.notnull"));
        }
        List<SsResource> resources = ssResourceService.findByIdList(distinctRelIds);
        if (CollectionUtils.isEmpty(resources) || resources.size() != distinctRelIds.size()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }
        return resources;
    }

    private boolean containsSkillResource(List<SsResource> resources) {
        return resources != null && resources.stream().anyMatch(
            resource -> resource != null && StringUtils.equals(RESOURCE_BIZ_TYPE_SKILL, resource.getResourceBizType()));
    }

    private void validateSkillInstallPermission(SsResource digitalEmployee, List<SsResource> installRelResources) {
        if (digitalEmployee == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }
        // 技能安装目标是前端当前选中的数字员工：显式 @ 的数字员工优先，没有 @ 时才回退默认数字员工。
        // 因此这里按目标数字员工的管理权限校验，不再强制要求它必须等于 defaultDigEmployeeId。
        if (!authApplicationService.hasResourceManagePermission(digitalEmployee)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.skill.install.no.manage.permission", digitalEmployee.getResourceName()));
        }
        for (SsResource resource : installRelResources) {
            if (resource != null && StringUtils.equals(RESOURCE_BIZ_TYPE_SKILL, resource.getResourceBizType())
                && !authApplicationService.hasResourceUsePermission(resource)) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("digemployee.skill.install.no.use.permission", resource.getResourceName()));
            }
        }
    }

    /**
     * 校验当前用户对指定数字员工是否有管理权限（删除/卸载工作空间技能前置校验）。
     * 与绑定技能卸载使用同一套校验，避免漂移。
     *
     * @param digitalEmployeeId 数字员工资源 ID
     */
    public void assertSkillUninstallPermission(Long digitalEmployeeId) {
        SsResource digitalEmployee = ssResourceService.findById(digitalEmployeeId);
        validateSkillUninstallPermission(digitalEmployee);
    }

    private void validateSkillUninstallPermission(SsResource digitalEmployee) {
        if (digitalEmployee == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }
        // 技能卸载同安装一样，按请求里的当前数字员工校验管理权限。
        if (!authApplicationService.hasResourceManagePermission(digitalEmployee)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.skill.uninstall.no.manage.permission", digitalEmployee.getResourceName()));
        }
    }

    /**
     * 设置当前用户默认数字员工。 默认关系只维护在 suas_superassist.default_dig_employee_id 上，不再修改资源 owner_type 或扩展表 tag_name。
     * 这样超级助手、个人助理、企业数字员工都保持自身资源归属，默认身份只作为当前用户会话兜底 @ 对象。
     *
     * @param dto 请求参数
     * @return 默认数字员工切换结果
     */
    @Transactional(rollbackFor = Exception.class)
    public SetDefaultDigitalEmployeeResultVo setDefaultDigitalEmployee(SetDefaultDigitalEmployeeDTO dto) {
        validateSetDefaultRequest(dto);
        Long currentUserId = requireCurrentUserId();
        SsResource targetResource = loadAndValidateDigitalEmployee(dto.getResourceId(), currentUserId);
        SuasSuperassist superassist = loadCurrentUserSuperassist();
        Long newDefaultResourceId = targetResource.getResourceId();
        Long oldDefaultResourceId = superassist.getDefaultDigEmployeeId();
        if (Objects.equals(oldDefaultResourceId, newDefaultResourceId)) {
            refreshCurrentDefaultDigitalEmployeeSession(newDefaultResourceId);
            return buildSetDefaultDigitalEmployeeResult(newDefaultResourceId, oldDefaultResourceId);
        }
        updateUserDefaultDigitalEmployee(superassist, newDefaultResourceId);
        refreshCurrentDefaultDigitalEmployeeSession(newDefaultResourceId);
        operationLogService.recordOperationLog(targetResource, OperationTypeEnum.UPDATE);
        return buildSetDefaultDigitalEmployeeResult(newDefaultResourceId, oldDefaultResourceId);
    }

    private SetDefaultDigitalEmployeeResultVo buildSetDefaultDigitalEmployeeResult(Long newDefaultResourceId,
        Long oldDefaultResourceId) {
        SetDefaultDigitalEmployeeResultVo result = new SetDefaultDigitalEmployeeResultVo();
        result.setNewResourceId(newDefaultResourceId);
        result.setNewOwnerType(loadDigitalEmployeeOwnerType(newDefaultResourceId));
        result.setOldResourceId(oldDefaultResourceId);
        result.setOldOwnerType(loadDigitalEmployeeOwnerType(oldDefaultResourceId));
        return result;
    }

    private String loadDigitalEmployeeOwnerType(Long resourceId) {
        if (resourceId == null) {
            return null;
        }
        SsResource resource = ssResourceService.findById(resourceId);
        return resource == null ? null : resource.getOwnerType();
    }

    /***
     * 删除数字员工
     *
     * @param employeeIdDTO 删除标识
     * @return ResponseUtil
     */
    public void deleteDigitalEmployee(EmployeeIdDTO employeeIdDTO) {

        Long resourceId = employeeIdDTO.getResourceId();
        SsResource ssResource = ssResourceService.findById(resourceId);
        validateDigitalEmployeeManagePermission(ssResource);
        // 软删除：把 ss_resource.resource_status 置为 REMOVED(3)，保留主表与扩展表数据，
        // 让前端"已注销"筛选项可以查询到这些记录；运行期副作用（缓存/注册等）继续清理。
        ssResource.setResourceStatus(ResourceStatus.REMOVED.getNum());
        ssResource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setUpdateTime(new Date());
        ssResourceService.updateResourceEntity(ssResource);

        // 该数字员工若被其它用户设为默认助理，回退他们的默认助理为自己的超级助手，避免出现“默认指向已注销资源”。
        resetDefaultForAffectedUsers(resourceId);

        // 注销后不再可被会话调用：清理技能缓存/产物/外部注册
        removeDigEmployeeFromRedisQuietly(resourceId);
        removeDigEmployeeJsonFromResourceStorageQuietly(resourceId);

        digEmployeeChangeEventPublisher.publishAfterCommitOrNow(DigEmployeeChangeEventType.DIG_EMPLOYEE_DELETED,
            resourceId);

        robotChannelRegistryCoordinator.unregisterForResource(resourceId);
    }

    private void validateDigitalEmployeeManagePermission(SsResource ssResource) {
        if (ssResource == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }
        if (StringUtils.equals(ssResource.getOwnerType(), OwnerType.PERSONAL_DEFAULT)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
        }
        if (authApplicationService.hasResourceManagePermission(ssResource)) {
            return;
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
    }

    /**
     * 数字员工注销/删除后，把所有把它设为默认助理的用户回退到各自的超级助手；找不到超级助手时清空。 同时若当前登录用户在受影响列表里，需要刷新 session 中的 defaultDigEmployeeId。 暴露为 public
     * 以便其他注销链路（如 ToolManService.deleteManagedResource）复用。
     */
    public void resetDefaultForAffectedUsers(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        List<SuasSuperassist> affected = suasSuperassistService.findByDefaultDigEmployeeId(resourceId);
        if (affected == null || affected.isEmpty()) {
            return;
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        for (SuasSuperassist suasSuperassist : affected) {
            Long userId = suasSuperassist.getSuperassistId();
            Long fallbackResourceId = resolveSuperAssistantResourceId(userId);
            suasSuperassist.setDefaultDigEmployeeId(fallbackResourceId);
            try {
                suasSuperassistService.updateById(suasSuperassist);
            }
            catch (Exception e) {
                logger.warn("回退默认数字员工失败，userId={}, fallback={}", userId, fallbackResourceId, e);
                continue;
            }
            if (Objects.equals(userId, currentUserId)) {
                refreshCurrentDefaultDigitalEmployeeSession(fallbackResourceId);
            }
        }
    }

    /**
     * 按 resource_code={userCode}_main 反查指定用户的超级助手资源ID，找不到返回 null。
     */
    private Long resolveSuperAssistantResourceId(Long userId) {
        if (userId == null) {
            return null;
        }
        Users user = userService.findById(userId);
        if (user == null) {
            return null;
        }
        String resourceCode = buildDefaultSuperAssistantResourceCode(user.getUserCode(), userId);
        if (StringUtils.isBlank(resourceCode)) {
            return null;
        }
        SsResource superAssistant = ssResourceService.findByIdOrCode(null, resourceCode);
        return superAssistant == null ? null : superAssistant.getResourceId();
    }

    private void validateDigitalEmployeeUpdatePermission(SsResource ssResource) {
        if (ssResource == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }
        if (isCurrentUserBoundDefaultDigitalEmployee(ssResource)
            || isCurrentUserOwnDefaultSuperAssistantResource(ssResource)) {
            return;
        }
        validateDigitalEmployeeManagePermission(ssResource);
    }

    private boolean isCurrentUserBoundDefaultDigitalEmployee(SsResource ssResource) {
        if (!isDefaultPersonalResource(ssResource) || ssResource.getResourceId() == null) {
            return false;
        }
        Long defaultDigEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        return ssResource.getResourceId().equals(defaultDigEmployeeId);
    }

    /**
     * 当前用户自己的超级助手资源使用稳定编码 {userCode}_main；即使用户把其他个人助理设为默认数字员工，
     * 也应允许用户继续编辑自己的超级助手配置。
     */
    private boolean isCurrentUserOwnDefaultSuperAssistantResource(SsResource ssResource) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        String currentUserCode = CurrentUserHolder.getCurrentUserCode();
        if (!isDefaultPersonalResource(ssResource) || currentUserId == null || ssResource.getResourceId() == null) {
            return false;
        }
        if (!StringUtils.equals(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), ssResource.getResourceBizType())) {
            return false;
        }
        if (!Objects.equals(currentUserId, ssResource.getCreateBy())) {
            return false;
        }
        String expectedResourceCode = buildDefaultSuperAssistantResourceCode(currentUserCode, currentUserId);
        return StringUtils.equals(expectedResourceCode, ssResource.getResourceCode());
    }

    private boolean isDefaultPersonalResource(SsResource ssResource) {
        return ssResource != null && StringUtils.equals(ssResource.getOwnerType(), OwnerType.PERSONAL_DEFAULT);
    }

    private void validateSetDefaultRequest(SetDefaultDigitalEmployeeDTO dto) {
        if (dto == null || dto.getResourceId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.resource.id.null"));
        }
    }

    private Long requireCurrentUserId() {
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        Long currentUserId = loginInfo == null ? null : loginInfo.getUserId();
        if (currentUserId == null || currentUserId <= 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.user.not.login"));
        }
        return currentUserId;
    }

    private SsResource loadAndValidateDigitalEmployee(Long resourceId, Long currentUserId) {
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.resource.not.exists"));
        }
        if (!StringUtils.equals(resource.getResourceBizType(), ResourceBizTypeEnum.DIG_EMPLOYEE.name())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.resource.not.digital"));
        }
        if (!canCurrentUserSetAsDefault(resource, currentUserId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.resource.permission.invalid"));
        }
        return resource;
    }

    /**
     * 左侧“全部列表项”中可见的数字员工才允许设为默认： 我创建的、我有使用授权的、或我有 ALLOW_MANAGE 管理授权的资源均可。
     */
    private boolean canCurrentUserSetAsDefault(SsResource resource, Long currentUserId) {
        if (resource == null || currentUserId == null) {
            return false;
        }
        if (Objects.equals(resource.getCreateBy(), currentUserId)) {
            return true;
        }
        List<Long> resourceIds = List.of(resource.getResourceId());
        List<String> resourceBizTypes = List.of(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        if (authApplicationService.queryCurrentUserUsePermittedResourceIds(resourceIds, resourceBizTypes)
            .contains(resource.getResourceId())) {
            return true;
        }
        return authApplicationService.hasCurrentUserAllowManagePrivilege(resource);
    }

    private SuasSuperassist loadCurrentUserSuperassist() {
        Long assistantId = CurrentUserHolder.getAssistantId();
        if (assistantId == null || assistantId <= 0) {
            assistantId = CurrentUserHolder.getCurrentUserId();
        }
        if (assistantId == null || assistantId <= 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.superassist.not.exists"));
        }
        SuasSuperassist superassist = suasSuperassistService.findById(assistantId);
        if (superassist == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digemployee.default.set.superassist.not.exists"));
        }
        return superassist;
    }

    private void updateUserDefaultDigitalEmployee(SuasSuperassist superassist, Long resourceId) {
        if (superassist == null || resourceId == null) {
            return;
        }
        if (Objects.equals(superassist.getDefaultDigEmployeeId(), resourceId)) {
            return;
        }
        superassist.setDefaultDigEmployeeId(resourceId);
        suasSuperassistService.updateById(superassist);
    }

    private void refreshCurrentDefaultDigitalEmployeeSession(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo != null) {
            loginInfo.setDefaultDigEmployeeId(resourceId);
        }
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) {
            return;
        }
        HttpSession session = attributes.getRequest().getSession(false);
        if (session != null) {
            session.setAttribute("defaultDigEmployeeId", resourceId);
        }
    }

    /**
     * 同步数字员工到openClaw
     *
     * @param resourceId 标识
     */
    public void synOpenClawWorkSpace(Long resourceId) {
        synOpenClawWorkSpace(resourceId, null);
    }

    /**
     * 同步数字员工到 openClaw（带原始入参版本）。 之所以单独承接 inputDto，是因为 relTools 不入 DB，重新 findDetailsById 拿不回， 需要从前端原始入参直接透传到 JSON 与
     * target_content。
     *
     * @param resourceId 标识
     * @param inputDto 前端 save/update 时传入的原始 DTO；为 null 时退化为纯 DB 拼装
     */
    public void synOpenClawWorkSpace(Long resourceId, DigitalEmployeeDTO inputDto) {
        try {
            doSyncOpenClawWorkSpace(resourceId, inputDto);
        }
        catch (Exception e) {
            logger.error("同步数字员工资源文件失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
        }
    }

    /**
     * 将已有数字员工及其关联资源的标准 JSON 同步至 Redis（供启动全量初始化等场景调用）。 优先使用扩展表 {@code target_content}，缺失时再组装详情 JSON。
     */
    public void syncExistingDigEmployeeConfigToRedisQuietly(Long resourceId) {
        try {
            syncExistingDigEmployeeConfigToRedis(resourceId);
        }
        catch (Exception e) {
            logger.error("同步已有数字员工配置到Redis失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
        }
    }

    private void syncExistingDigEmployeeConfigToRedis(Long resourceId) {
        if (resourceId == null || digEmployeeRedisSyncProperties == null
            || !digEmployeeRedisSyncProperties.isJsonRedisSyncEnabled()) {
            return;
        }
        String jsonContent = resolveDigEmployeeJsonForRedisSync(resourceId);
        if (StringUtils.isNotBlank(jsonContent)) {
            syncResourceConfigJsonToRedis(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), resourceId, jsonContent);
        }
        syncRelatedResourceConfigJsonsToRedisQuietly(resourceId);
    }

    private String resolveDigEmployeeJsonForRedisSync(Long resourceId) {
        SsResExtDigEmployee ext = ssResExtDigEmployeeService.findById(resourceId);
        if (ext != null && StringUtils.isNotBlank(ext.getTargetContent())) {
            return ext.getTargetContent();
        }
        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(resourceId);
        DigitalEmployeeDetailsDTO details = findDetailsById(employeeIdDTO);
        if (details == null) {
            logger.warn("数字员工详情不存在，无法组装Redis配置JSON, resourceId={}", resourceId);
            return null;
        }
        fillDigitalEmployeeSyncRuntimeFields(details, resourceId);
        // target_content 只是上一次同步快照，不能再作为当前标准 JSON 的一个字段递归写回。
        details.setTargetContent(null);
        return com.alibaba.fastjson.JSON.toJSONString(details);
    }

    private void doSyncOpenClawWorkSpace(Long resourceId, DigitalEmployeeDTO inputDto) {
        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(resourceId);
        DigitalEmployeeDetailsDTO details = this.findDetailsById(employeeIdDTO);
        fillDigitalEmployeeSyncRuntimeFields(details, resourceId);
        // 用前端原始入参覆盖运行期字段：
        // - relTools 不入库，必须从入参直接透传，否则首次保存的 JSON 中 relTools 会丢；
        // - relPrompt 与 corePersonaDefinition 同源，入参更"新"则优先用入参，避免编辑场景被旧库值覆盖。
        applyInputRuntimeFields(details, inputDto);
        // target_content 只是镜像快照，不能参与本次 JSON 序列化，否则会出现 JSON 套 JSON 的递归膨胀。
        details.setTargetContent(null);

        String jsonContent = com.alibaba.fastjson.JSON.toJSONString(details);
        String fileName = buildDigEmployeeJsonFileName(resourceId);
        String effectiveStorageType = StringUtils.defaultIfBlank(storageType, "minio");
        String resourceDir = ResourceBizTypeEnum.DIG_EMPLOYEE.name().toLowerCase();

        logger.info("数字员工同步开始, storageType={}, resourceId={}, resourcePath={}/{}", effectiveStorageType, resourceId,
            resourceDir, fileName);

        // 先把同步到 MinIO 的 JSON 串镜像写入 ss_res_ext_dig_employee.target_content。
        // 这样：1) 即便后续 MinIO 推送失败，DB 也保留了上一次成功生成的 JSON；
        // 2) 前端编辑回显时（findDetailsById）可以从这里反序列化 relTools 等不入库的运行期字段。
        persistTargetContent(resourceId, jsonContent);

        resourceArtifactStorageService.syncResourceJsonByBizType(jsonContent, ResourceBizTypeEnum.DIG_EMPLOYEE.name(),
            resourceId);
        ssResourceArtifactService.upsertStandardJsonArtifact(resourceId, ResourceBizTypeEnum.DIG_EMPLOYEE.name(),
            "dig-employee-sync");

        syncDigEmployeeConfigJsonToRedisQuietly(resourceId, jsonContent);

        // 数字员工自己的 JSON 同步完成后，再检查并补齐其关联资源的标准 JSON 产物。
        // 这样可以确保前端保存/更新数字员工后，关联的 toolkit / mcp / agent / kg_* / view / object
        // 也都能在开放资源目录中按标准命名被下游读取到。
        syncMissingRelatedResourceJsons(resourceId);
        syncRelatedResourceConfigJsonsToRedisQuietly(resourceId);

        logger.info("数字员工已同步至开放资源目录, storageType={}, resourceId={}, resourcePath={}/{}", effectiveStorageType,
            resourceId, resourceDir, fileName);
    }

    /**
     * 数字员工同步到开放资源目录前，统一补齐实现方式与 Worker 注册类型。
     *
     * @author qin.guoquan
     * @date 2026-04-26 11:30:00
     */
    private void fillDigitalEmployeeSyncRuntimeFields(DigitalEmployeeDetailsDTO details, Long resourceId) {
        if (details == null || resourceId == null) {
            return;
        }
        SsResource ssResource = ssResourceService.findById(resourceId);
        if (ssResource == null) {
            return;
        }
        details.setImplType(StringUtils.trimToEmpty(ssResource.getImplType()));
        details.setWorkerAgentType(StringUtils.trimToEmpty(ssResource.getWorkerAgentType()));
    }

    /**
     * 检查数字员工关联资源对应的标准 JSON 是否存在；若缺失，则按原 targetContent 补发回开放资源目录。 设计说明： 1. 不重新走资源导入流程，而是直接复用各扩展表中已经生成好的 targetContent；
     * 2. 只处理下游明确依赖的资源类型：TOOLKIT / MCP / AGENT / KG_* / VIEW / OBJECT； 3. 某个关联资源补发失败时，仅记录日志，不影响数字员工自身同步主流程。
     */
    private void syncMissingRelatedResourceJsons(Long digEmployeeResourceId) {
        if (digEmployeeResourceId == null) {
            return;
        }
        List<SsResourceRelDetail> relDetails = ssResourceRelDetailService.findByResourceId(digEmployeeResourceId);
        if (CollectionUtils.isEmpty(relDetails)) {
            logger.debug("数字员工无关联资源，无需补齐资源JSON, digEmployeeResourceId={}", digEmployeeResourceId);
            return;
        }

        List<Long> relResourceIds = relDetails.stream().map(SsResourceRelDetail::getRelResourceId)
            .filter(java.util.Objects::nonNull).distinct().collect(Collectors.toList());
        if (CollectionUtils.isEmpty(relResourceIds)) {
            logger.debug("数字员工关联资源ID为空，无需补齐资源JSON, digEmployeeResourceId={}", digEmployeeResourceId);
            return;
        }

        List<SsResource> relResources = ssResourceService.findByIdList(relResourceIds);
        if (CollectionUtils.isEmpty(relResources)) {
            logger.debug("数字员工关联资源不存在，无需补齐资源JSON, digEmployeeResourceId={}, relResourceIds={}", digEmployeeResourceId,
                relResourceIds);
            return;
        }

        logger.debug("数字员工关联资源JSON补齐开始, digEmployeeResourceId={}, relResourceIds={}", digEmployeeResourceId,
            relResourceIds);
        for (SsResource relResource : relResources) {
            syncSingleRelatedResourceJsonIfMissing(digEmployeeResourceId, relResource);
        }
    }

    /**
     * 将数字员工关联资源的标准 JSON 同步至 Redis（与 MinIO 产物同内容，键名为 {@code {BIZTYPE}_{resourceId}}）。 每次数字员工开放目录同步后执行，不依赖 MinIO 是否缺失。
     */
    public void syncRelatedResourceConfigJsonsToRedisQuietly(Long digEmployeeResourceId) {
        if (digEmployeeResourceId == null) {
            return;
        }
        List<SsResourceRelDetail> relDetails = ssResourceRelDetailService.findByResourceId(digEmployeeResourceId);
        if (CollectionUtils.isEmpty(relDetails)) {
            return;
        }
        List<Long> relResourceIds = relDetails.stream().map(SsResourceRelDetail::getRelResourceId)
            .filter(java.util.Objects::nonNull).distinct().collect(Collectors.toList());
        if (CollectionUtils.isEmpty(relResourceIds)) {
            return;
        }
        List<SsResource> relResources = ssResourceService.findByIdList(relResourceIds);
        if (CollectionUtils.isEmpty(relResources)) {
            return;
        }
        logger.debug("数字员工关联资源Redis同步开始, digEmployeeResourceId={}, relResourceIds={}", digEmployeeResourceId,
            relResourceIds);
        for (SsResource relResource : relResources) {
            syncSingleRelatedResourceConfigJsonToRedisQuietly(digEmployeeResourceId, relResource);
        }
    }

    private void syncSingleRelatedResourceConfigJsonToRedisQuietly(Long digEmployeeResourceId, SsResource relResource) {
        try {
            syncSingleRelatedResourceConfigJsonToRedis(digEmployeeResourceId, relResource);
        }
        catch (Exception e) {
            logger.error(
                "同步数字员工关联资源配置到Redis失败，不影响主流程, digEmployeeResourceId={}, relResourceId={}, resourceBizType={}, reason={}",
                digEmployeeResourceId, relResource == null ? null : relResource.getResourceId(),
                relResource == null ? null : relResource.getResourceBizType(), e.getMessage(), e);
        }
    }

    private void syncSingleRelatedResourceConfigJsonToRedis(Long digEmployeeResourceId, SsResource relResource) {
        if (relResource == null || relResource.getResourceId() == null) {
            return;
        }
        String resourceBizType = StringUtils.trimToEmpty(relResource.getResourceBizType());
        if (!isSupportedRelatedResourceBizType(resourceBizType)) {
            return;
        }
        Long relResourceId = relResource.getResourceId();
        String targetContent = loadRelatedResourceTargetContent(resourceBizType, relResourceId);
        if (StringUtils.isBlank(targetContent)) {
            logger.warn(
                "数字员工关联资源targetContent为空，跳过Redis同步, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}",
                digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType);
            return;
        }
        syncResourceConfigJsonToRedis(resourceBizType, relResourceId, targetContent);
        logger.debug(
            "数字员工关联资源配置已同步至Redis, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}, redisKey={}",
            digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType,
            DigEmployeeRedisKeys.resourceConfigJsonKey(resourceBizType, relResourceId));
    }

    private void syncSingleRelatedResourceJsonIfMissing(Long digEmployeeResourceId, SsResource relResource) {
        if (relResource == null || relResource.getResourceId() == null) {
            return;
        }
        String resourceBizType = StringUtils.trimToEmpty(relResource.getResourceBizType());
        if (!isSupportedRelatedResourceBizType(resourceBizType)) {
            logger.debug("数字员工关联资源类型不在补齐范围内，跳过, digEmployeeResourceId={}, relResourceId={}, resourceBizType={}",
                digEmployeeResourceId, relResource.getResourceId(), resourceBizType);
            return;
        }

        Long relResourceId = relResource.getResourceId();
        boolean exists = resourceArtifactStorageService.existsResourceJsonByBizType(resourceBizType, relResourceId);
        logger.debug(
            "数字员工关联资源JSON存在性检查完成, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}, exists={}",
            digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType, exists);
        if (exists) {
            logger.debug(
                "数字员工关联资源JSON已存在，跳过补发, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}",
                digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType);
            return;
        }

        String targetContent = loadRelatedResourceTargetContent(resourceBizType, relResourceId);
        if (StringUtils.isBlank(targetContent)) {
            logger.warn(
                "数字员工关联资源targetContent为空，无法补发JSON, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}",
                digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType);
            return;
        }

        try {
            logger.debug(
                "数字员工关联资源JSON缺失，开始补发, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}",
                digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType);
            resourceArtifactStorageService.syncResourceJsonByBizType(targetContent, resourceBizType, relResourceId);
            ssResourceArtifactService.upsertStandardJsonArtifact(relResourceId, resourceBizType,
                "dig-employee-related-sync");
            logger.debug(
                "数字员工关联资源JSON补发成功, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}",
                digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType);
        }
        catch (Exception e) {
            logger.error(
                "数字员工关联资源JSON补发失败，不影响主流程, digEmployeeResourceId={}, relResourceId={}, resourceCode={}, resourceBizType={}, reason={}",
                digEmployeeResourceId, relResourceId, relResource.getResourceCode(), resourceBizType, e.getMessage(),
                e);
        }
    }

    private boolean isSupportedRelatedResourceBizType(String resourceBizType) {
        return StringUtils.equalsAny(resourceBizType, ResourceBizTypeEnum.TOOLKIT.name(),
            ResourceBizTypeEnum.MCP.name(), ResourceBizTypeEnum.AGENT.name(), ResourceBizTypeEnum.VIEW.name(),
            ResourceBizTypeEnum.OBJECT.name(), ResourceBizTypeEnum.SKILL.name())
            || StringUtils.startsWithIgnoreCase(resourceBizType, "KG_");
    }

    private String loadRelatedResourceTargetContent(String resourceBizType, Long resourceId) {
        if (StringUtils.equals(resourceBizType, ResourceBizTypeEnum.TOOLKIT.name())) {
            SsResExtToolKit ext = ssResExtToolKitService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizTypeEnum.MCP.name())) {
            SsResExtMcp ext = ssResExtMcpService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizTypeEnum.AGENT.name())) {
            SsResExtAgent ext = ssResExtAgentService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.startsWithIgnoreCase(resourceBizType, "KG_")) {
            SsResExtDoc ext = ssResExtDocService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizTypeEnum.VIEW.name())) {
            SsResExtView ext = ssResExtViewService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizTypeEnum.OBJECT.name())) {
            SsResExtObject ext = ssResExtObjectService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.equals(resourceBizType, ResourceBizTypeEnum.SKILL.name())) {
            SsResExtSkill ext = ssResExtSkillService.findById(resourceId);
            return ext == null ? null : ext.getTargetContent();
        }
        return null;
    }

    private void syncDigEmployeeSkillsToRedisQuietly(Long resourceId) {
        // RESOURCE_DIG_EMPLOYEE_{resourceId} 为历史技能列表缓存，当前下游已切到 DIG_EMPLOYEE_{resourceId}
        // + KG_DOC_{resourceId} 读取完整配置，先屏蔽写 Redis，避免继续产出旧口径缓存。
        // try {
        //     syncDigEmployeeSkillsToRedis(resourceId);
        // }
        // catch (Exception e) {
        //     logger.error("同步数字员工技能信息到Redis失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
        // }
    }

    private void syncDigEmployeeSkillsToRedis(Long resourceId) {
        // RESOURCE_DIG_EMPLOYEE_{resourceId} 旧技能缓存写入已暂停；保留原逻辑注释便于需要时回滚。
        // if (resourceId == null) {
        //     return;
        // }
        // List<SsResourceRelDetailDTO> skills = ssResourceRelDetailService.querySkillsForOpenApi(resourceId);
        // RedisUtil.setString(DigEmployeeRedisKeys.skillCacheKey(resourceId),
        //     JSON.toJSONString(skills == null ? Collections.emptyList() : skills));
    }

    /**
     * 按数字员工当前资源关联关系重建技能运行时配置，并写回 ss_res_ext_dig_employee.skills。
     *
     * 安装技能、对话框 #技能 上传/解绑都以 ss_resource_rel_detail 作为事实来源；这里统一补齐 relSkills 的
     * skillType、skillUrl、versionUrl 等运行时字段，避免授权/安装和数字员工 JSON 之间出现口径漂移。
     */
    public void rebuildAndSaveDigitalEmployeeRelSkills(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        SsResExtDigEmployee extDigEmployee = ssResExtDigEmployeeService.findById(resourceId);
        if (extDigEmployee == null) {
            logger.warn("重建数字员工技能列表失败：扩展表记录不存在, resourceId={}", resourceId);
            return;
        }

        List<Map<String, Object>> rawRelSkills = buildRelSkillsFromRelations(resourceId);
        extDigEmployee.setSkills(JSON.toJSONString(rawRelSkills));
        ssResExtDigEmployeeService.update(extDigEmployee);
    }

    private List<Map<String, Object>> buildRelSkillsFromRelations(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.findByResourceId(resourceId);
        if (CollectionUtils.isEmpty(resourceRelDetails)) {
            return Collections.emptyList();
        }

        List<Long> relResourceIds = resourceRelDetails.stream()
            .map(SsResourceRelDetail::getRelResourceId)
            .filter(Objects::nonNull)
            .distinct()
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(relResourceIds)) {
            return Collections.emptyList();
        }

        List<SsResource> relResources = ssResourceService.findByIdList(relResourceIds);
        if (CollectionUtils.isEmpty(relResources)) {
            return Collections.emptyList();
        }

        Map<Long, SsResource> skillResourceMap = relResources.stream()
            .filter(item -> item != null && item.getResourceId() != null
                && ResourceBizTypeEnum.SKILL.name().equals(item.getResourceBizType()))
            .collect(Collectors.toMap(SsResource::getResourceId, item -> item, (left, right) -> left));
        if (MapUtils.isEmpty(skillResourceMap)) {
            return Collections.emptyList();
        }

        return resourceRelDetails.stream()
            .map(SsResourceRelDetail::getRelResourceId)
            .filter(skillResourceMap::containsKey)
            .distinct()
            .map(relResourceId -> buildRelSkillFromResource(skillResourceMap.get(relResourceId)))
            .collect(Collectors.toList());
    }

    private Map<String, Object> buildRelSkillFromResource(SsResource skillResource) {
        SsResExtSkill extSkill = skillResource == null || skillResource.getResourceId() == null
            || ssResExtSkillService == null ? null : ssResExtSkillService.findById(skillResource.getResourceId());
        String skillType = firstNotBlank(
            extSkill == null ? null : extSkill.getSkillType(),
            SsResExtSkillService.DEFAULT_SKILL_TYPE);
        boolean innerSkill = StringUtils.equalsIgnoreCase(skillType, SsResExtSkillService.INNER_SKILL_TYPE);

        Map<String, Object> relSkill = new LinkedHashMap<>();
        if (skillResource != null && skillResource.getResourceId() != null) {
            relSkill.put("resourceId", skillResource.getResourceId());
        }
        relSkill.put("skillCode", skillResource == null ? null : skillResource.getResourceCode());
        relSkill.put("skillType", skillType);
        relSkill.put("skillUrl", innerSkill ? "" : buildSkillDownloadUrl(
            skillResource == null ? null : skillResource.getResourceId(), null));
        relSkill.put("versionUrl", buildSkillVersionUrl(skillResource == null ? null : skillResource.getResourceId(), null));
        return relSkill;
    }

    private void syncDigEmployeeConfigJsonToRedisQuietly(Long resourceId, String jsonContent) {
        try {
            syncDigEmployeeConfigJsonToRedis(resourceId, jsonContent);
        }
        catch (Exception e) {
            logger.error("同步数字员工完整配置到Redis失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
        }
    }

    private void syncDigEmployeeConfigJsonToRedis(Long resourceId, String jsonContent) {
        syncResourceConfigJsonToRedis(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), resourceId, jsonContent);
    }

    private void syncResourceConfigJsonToRedis(String resourceBizType, Long resourceId, String jsonContent) {
        if (resourceId == null || digEmployeeRedisSyncProperties == null
            || !digEmployeeRedisSyncProperties.isJsonRedisSyncEnabled()) {
            return;
        }
        if (StringUtils.isBlank(jsonContent)) {
            logger.warn("资源完整配置JSON为空，跳过Redis同步, resourceBizType={}, resourceId={}", resourceBizType, resourceId);
            return;
        }
        String redisKey = DigEmployeeRedisKeys.resourceConfigJsonKey(resourceBizType, resourceId);
        RedisUtil.setString(redisKey, jsonContent);
        logger.debug("资源完整配置已同步至Redis, resourceBizType={}, resourceId={}, redisKey={}", resourceBizType, resourceId,
            redisKey);
    }

    private void removeDigEmployeeFromRedisQuietly(Long resourceId) {
        try {
            removeDigEmployeeFromRedis(resourceId);
        }
        catch (Exception e) {
            logger.error("删除数字员工技能Redis缓存失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
        }
    }

    private void removeDigEmployeeFromRedis(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        // RESOURCE_DIG_EMPLOYEE_{resourceId} 旧技能缓存已暂停维护，这里不再主动触碰该 key。
        // RedisUtil.removeKey(DigEmployeeRedisKeys.skillCacheKey(resourceId));
        removeDigEmployeeConfigJsonFromRedis(resourceId);
    }

    private void removeDigEmployeeConfigJsonFromRedis(Long resourceId) {
        if (resourceId == null || digEmployeeRedisSyncProperties == null
            || !digEmployeeRedisSyncProperties.isJsonRedisSyncEnabled()) {
            return;
        }
        RedisUtil.removeKey(DigEmployeeRedisKeys.configJsonKey(resourceId));
    }

    private void removeDigEmployeeJsonFromResourceStorageQuietly(Long resourceId) {
        try {
            removeDigEmployeeJsonFromResourceStorage(resourceId);
        }
        catch (Exception e) {
            logger.error("删除数字员工开放资源目录文件失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
        }
    }

    private void removeDigEmployeeJsonFromResourceStorage(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        String effectiveStorageType = StringUtils.defaultIfBlank(storageType, "minio");
        String resourceDir = ResourceBizTypeEnum.DIG_EMPLOYEE.name().toLowerCase();
        String fileName = buildDigEmployeeJsonFileName(resourceId);
        logger.info("删除数字员工开放资源目录文件开始, storageType={}, resourceId={}, resourcePath={}/{}", effectiveStorageType,
            resourceId, resourceDir, fileName);
        resourceArtifactStorageService.deleteResourceJsonByBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), resourceId);
        logger.info("删除数字员工开放资源目录文件完成, storageType={}, resourceId={}, resourcePath={}/{}", effectiveStorageType,
            resourceId, resourceDir, fileName);
    }

    private String buildDigEmployeeJsonFileName(Long resourceId) {
        return ResourceBizTypeEnum.DIG_EMPLOYEE.name() + "_" + resourceId + ".json";
    }

    /**
     * 当前关联资源和已关联资源对象进行对比，决定修改或者删除
     *
     * @param ssResource 资源对象
     * @param relIds 当前最新关联资源标识
     * @param resourceRelDetails 已关联资源标识
     */
    private void compareSsResourceRelDetail(SsResource ssResource, List<Long> relIds,
        List<SsResourceRelDetail> resourceRelDetails, List<RelResourceInfo> relResourceInfoList) {
        Map<String, List<String>> relResourceInfoListMap = new HashMap<>(10);
        if (CollectionUtils.isNotEmpty(relResourceInfoList)) {
            relResourceInfoListMap = relResourceInfoList.stream().collect(
                Collectors.toMap(RelResourceInfo::getRelId, RelResourceInfo::getActiveResourceIds, (v1, v2) -> v2 // 键重复时的合并规则：覆盖
                ));
        }

        // 集合转换
        Map<Long, SsResourceRelDetail> resourceRelDetailMap = new HashMap<>(10);
        for (int i = 0; resourceRelDetails != null && i < resourceRelDetails.size(); i++) {
            SsResourceRelDetail ssResourceRelDetail = resourceRelDetails.get(i);
            resourceRelDetailMap.put(ssResourceRelDetail.getRelResourceId(), ssResourceRelDetail);
        }

        // 对比，存在的修改，不存在的新增
        for (int i = 0; relIds != null && i < relIds.size(); i++) {
            Long relResourceId = relIds.get(i);
            // 关联子资源的信息（可用状态）
            List<String> relActiveChildResourceIds = relResourceInfoListMap.get(String.valueOf(relResourceId));
            SsResourceRelDetail ssResourceRelDetail = resourceRelDetailMap.remove(relResourceId);

            if (ssResourceRelDetail != null) {
                ssResourceRelDetail.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                ssResourceRelDetail.setUpdateTime(new Date());
                // 关联子资源的信息（可用状态）
                if (CollectionUtils.isNotEmpty(relActiveChildResourceIds)) {
                    RelResourceInfo relResourceInfo = new RelResourceInfo();
                    relResourceInfo.setRelId(String.valueOf(relResourceId));
                    relResourceInfo.setActiveResourceIds(relActiveChildResourceIds);
                    ssResourceRelDetail.setRelResourceInfo(JSON.toJSONString(relResourceInfo));
                }
                ssResourceRelDetailService.updateById(ssResourceRelDetail);
            }
            else {
                ssResourceRelDetail = new SsResourceRelDetail();
                // 关联子资源的信息（可用状态）
                if (CollectionUtils.isNotEmpty(relActiveChildResourceIds)) {
                    RelResourceInfo relResourceInfo = new RelResourceInfo();
                    relResourceInfo.setRelId(String.valueOf(relResourceId));
                    relResourceInfo.setActiveResourceIds(relActiveChildResourceIds);
                    ssResourceRelDetail.setRelResourceInfo(JSON.toJSONString(relResourceInfo));
                }
                ssResourceRelDetail.setResourceRelDetailId(sequenceService.nextVal());
                ssResourceRelDetail.setResourceId(ssResource.getResourceId());
                ssResourceRelDetail.setRelResourceId(relResourceId);
                ssResourceRelDetail.setCreateTime(new Date());
                ssResourceRelDetail.setCreateBy(CurrentUserHolder.getCurrentUserId());
                ssResourceRelDetail.setComAcctId(CurrentUserHolder.getEnterpriseId());
                ssResourceRelDetailService.save(ssResourceRelDetail);
            }
        }

        // 删除当前没有关联对象
        for (SsResourceRelDetail ssResourceRelDetail : resourceRelDetailMap.values()) {
            ssResourceRelDetailService.removeById(ssResourceRelDetail.getResourceRelDetailId());
        }
    }

    /**
     * 检查数字员工
     *
     * @return List<EmployeeAuditResult>
     */
    public List<EmployeeAuditResult> checkEmployeeAudit(DigitalEmployeeDTO digitalEmployeeDTO) {

        // 如果开了开关，就不检查
        String isCheckEmployeeAudit = systemConfigService.getStringParamValueByCode("IS_CHECK_EMPLOYEE_AUDIT");
        if (Constants.NO_VALUE_FALSE.equalsIgnoreCase(isCheckEmployeeAudit)) {
            return Collections.emptyList();
        }

        SsResource ssResource = new SsResource();
        BeanUtil.copyProperties(digitalEmployeeDTO, ssResource);
        ssResource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());

        SsResExtDigEmployee ssResExtDigEmployee = new SsResExtDigEmployee();
        BeanUtil.copyProperties(digitalEmployeeDTO, ssResExtDigEmployee);

        EmployeeAudit employeeAuditInfo = new EmployeeAudit();
        employeeAuditInfo.setName(ssResource.getResourceName());
        // 核心能力转数组
        String coreCompetencies = digitalEmployeeDTO.getCoreCompetencies();
        if (StringUtil.isNotEmpty(coreCompetencies)) {
            employeeAuditInfo.setCoreCompetencies(JSON.parseArray(coreCompetencies, CoreCompetency.class));
        }

        // 数字员工扩展信息设置
        List<Long> relIds = digitalEmployeeDTO.getRelIds();
        this.buildDigEmployeeExtCore(relIds, employeeAuditInfo);

        logger.info("检查数字员工入参:{}", JSON.toJSONString(employeeAuditInfo));
        PythonToolResponse<List<EmployeeAuditResult>> resp = feignPythonService.digitalEmployeeAudit(employeeAuditInfo);
        return resp.getData();
    }

    /**
     * 查询详情
     *
     * @param employeeIdDTO 查询对象
     * @return SsResource
     */
    public DigitalEmployeeDetailsDTO findDetailsById(EmployeeIdDTO employeeIdDTO) {
        Long resourceId = employeeIdDTO.getResourceId();

        DigitalEmployeeDetailsDTO digitalEmployeeDetailsDTO = ssResExtDigEmployeeService.findDetailsById(resourceId);

        // 防止模型名称还是旧的
        updateModelName(digitalEmployeeDetailsDTO);

        // 关联资源表
        List<SsResourceDTO> relResourceList = ssResourceService.findRelResource(resourceId);
        relResourceList = ontologyResourceValidityService.filterValidOntologyResources(relResourceList);

        List<Long> relIds = new ArrayList<>(10);
        if (CollectionUtils.isNotEmpty(relResourceList)) {
            relIds = relResourceList.stream().map(SsResource::getResourceId).collect(Collectors.toList());
            for (SsResourceDTO ssResourceDTO : relResourceList) {
                String relResourceInfo = ssResourceDTO.getRelResourceInfo();
                if (StringUtils.isNotBlank(relResourceInfo)) {
                    // 计算关联可用资源数量
                    RelResourceInfo relResourceInfoObj = JSON.parseObject(relResourceInfo, RelResourceInfo.class);
                    ssResourceDTO.setActiveResourceNum(relResourceInfoObj.getActiveResourceIds().size());
                }
            }
        }

        // 本体类关联资源：注入 ontologyBaseCode，并重建 relOntology 明细
        enrichOntologyRelResources(relResourceList, digitalEmployeeDetailsDTO);

        digitalEmployeeDetailsDTO.setRelIds(relIds);
        digitalEmployeeDetailsDTO.setRelResourceList(relResourceList);
        List<Map<String, Object>> relSkills = buildRelSkillsFromRelations(resourceId);
        digitalEmployeeDetailsDTO.setSkills(JSON.toJSONString(relSkills));
        digitalEmployeeDetailsDTO.setRelSkills(toRelSkillObjects(relSkills));
        // relTools 不入库，直接从最近一次 sync 写入的 target_content 镜像里反序列化回填，保证编辑回显不丢数据。
        digitalEmployeeDetailsDTO
            .setRelTools(parseRelToolsFromTargetContent(digitalEmployeeDetailsDTO.getTargetContent()));
        // relPrompt 优先取保存时写入 target_content 的运行期值；
        // 历史数据若没有该字段，再兜底到 corePersonaDefinition，兼容旧数据。
        String relPrompt = parseRelPromptFromTargetContent(digitalEmployeeDetailsDTO.getTargetContent());
        if (StringUtils.isBlank(relPrompt)) {
            relPrompt = digitalEmployeeDetailsDTO.getCorePersonaDefinition();
        }
        digitalEmployeeDetailsDTO.setRelPrompt(relPrompt);

        // 查询记忆配置列表（根据数字员工ID和用户ID查询）
        Long userId = CurrentUserHolder.getCurrentUserId();
        List<MemoryConfigDTO> memoryConfigList = templateRuleInfoApplicationService
            .findMemoryConfigsByResourceIdAndUserId(resourceId, userId);
        digitalEmployeeDetailsDTO.setMemoryConfigList(memoryConfigList);
        // target_content 仅供后端内部回填运行期字段使用，不对前端详情接口暴露。
        digitalEmployeeDetailsDTO.setTargetContent(null);

        return digitalEmployeeDetailsDTO;
    }

    /**
     * 为本体类关联资源(ONTOLOGY_BASE/SCENE/VIEW/OBJECT)注入 ontologyBaseCode，并重建 relOntology 扁平明细。
     * ontologyBaseCode 取自各自扩展表；relOntology 的路径(sceneId/viewCode/objectCode 等)
     * 由资源树本身重建：resource_code 即各级编码、resource_name 即名称、parent_resource_id 即层级，
     * 不依赖 ext.target_content 格式（快照对象的 ext 为 datacloud 原始格式，缺 sceneId，会导致回显对不上）。
     */
    private void enrichOntologyRelResources(List<SsResourceDTO> relResourceList, DigitalEmployeeDetailsDTO details) {
        if (CollectionUtils.isEmpty(relResourceList)) {
            return;
        }
        Set<String> ontologyBizTypes = Set.of("ONTOLOGY_BASE", "SCENE", "VIEW", "OBJECT");
        List<SsResourceDTO> ontologyResources = relResourceList.stream()
            .filter(r -> r != null && ontologyBizTypes.contains(r.getResourceBizType())).collect(Collectors.toList());
        if (CollectionUtils.isEmpty(ontologyResources)) {
            return;
        }
        // ontologyBaseCode 注入（Part B）
        List<Long> ids = ontologyResources.stream().map(SsResource::getResourceId).filter(Objects::nonNull)
            .collect(Collectors.toList());
        Map<Long, String> pidMap = ssResourceService.findOntologyBaseCodeMap(ids);

        // 构建 id->资源 映射用于回溯父链：先放入关联资源，再补齐缺失的祖先
        Map<Long, SsResource> byId = new HashMap<>();
        for (SsResourceDTO r : relResourceList) {
            if (r != null && r.getResourceId() != null) {
                byId.put(r.getResourceId(), r);
            }
        }
        boolean added = true;
        while (added) {
            added = false;
            List<Long> missing = new ArrayList<>();
            for (SsResource r : new ArrayList<>(byId.values())) {
                Long p = r.getParentResourceId();
                if (p != null && p > 0 && !byId.containsKey(p)) {
                    missing.add(p);
                }
            }
            if (!missing.isEmpty()) {
                List<SsResource> loaded = ssResourceService
                    .findByIdList(missing.stream().distinct().collect(Collectors.toList()));
                for (SsResource s : loaded) {
                    if (s != null && !byId.containsKey(s.getResourceId())) {
                        byId.put(s.getResourceId(), s);
                        added = true;
                    }
                }
            }
        }

        List<JSONObject> relOntology = new ArrayList<>();
        for (SsResourceDTO dto : ontologyResources) {
            String baseCode = pidMap.get(dto.getResourceId());
            if (StringUtils.isBlank(baseCode) && "ONTOLOGY_BASE".equals(dto.getResourceBizType())) {
                baseCode = dto.getResourceCode();
            }
            dto.setOntologyBaseCode(baseCode);
            SsResource baseResource = findOntologyBaseResource(dto, baseCode, byId);

            JSONObject entry = new JSONObject();
            entry.put("resourceId", dto.getResourceId());
            entry.put("resourceBizType", dto.getResourceBizType());
            entry.put("ontologyBaseCode", baseCode);
            if (baseResource != null) {
                entry.put("ontologyBaseName", baseResource.getResourceName());
                entry.put("ownerType", baseResource.getOwnerType());
            }
            entry.put("resourceName", dto.getResourceName());

            String biz = dto.getResourceBizType();
            if ("SCENE".equals(biz)) {
                entry.put("sceneId", dto.getResourceCode());
                entry.put("sceneName", dto.getResourceName());
            }
            else if ("VIEW".equals(biz)) {
                entry.put("viewCode", dto.getResourceCode());
                entry.put("viewName", dto.getResourceName());
                SsResource scene = byId.get(dto.getParentResourceId());
                if (scene != null) {
                    entry.put("sceneId", scene.getResourceCode());
                    entry.put("sceneName", scene.getResourceName());
                }
            }
            else if ("OBJECT".equals(biz)) {
                entry.put("objectCode", dto.getResourceCode());
                entry.put("objectName", dto.getResourceName());
                SsResource parent = byId.get(dto.getParentResourceId());
                if (parent != null && "VIEW".equals(parent.getResourceBizType())) {
                    entry.put("viewCode", parent.getResourceCode());
                    entry.put("viewName", parent.getResourceName());
                    SsResource scene = byId.get(parent.getParentResourceId());
                    if (scene != null) {
                        entry.put("sceneId", scene.getResourceCode());
                        entry.put("sceneName", scene.getResourceName());
                    }
                }
                else if (parent != null && "SCENE".equals(parent.getResourceBizType())) {
                    entry.put("sceneId", parent.getResourceCode());
                    entry.put("sceneName", parent.getResourceName());
                }
            }
            relOntology.add(entry);
        }
        details.setRelOntology(relOntology);
    }

    private SsResource findOntologyBaseResource(SsResource resource, String baseCode, Map<Long, SsResource> byId) {
        if (resource == null) {
            return null;
        }
        if ("ONTOLOGY_BASE".equals(resource.getResourceBizType())) {
            return resource;
        }
        Long cur = resource.getParentResourceId();
        while (cur != null && cur > 0) {
            SsResource parent = byId.get(cur);
            if (parent == null) {
                break;
            }
            if ("ONTOLOGY_BASE".equals(parent.getResourceBizType())) {
                if (StringUtils.isBlank(baseCode) || StringUtils.equals(baseCode, parent.getResourceCode())) {
                    return parent;
                }
            }
            cur = parent.getParentResourceId();
        }
        return byId.values().stream()
            .filter(r -> r != null && "ONTOLOGY_BASE".equals(r.getResourceBizType()))
            .filter(r -> StringUtils.isBlank(baseCode) || StringUtils.equals(baseCode, r.getResourceCode())).findFirst()
            .orElse(null);
    }

    /**
     * 用前端原始入参覆盖 details 上的运行期字段。 仅处理"不入 DB" 或"前端入参更新"的字段（relTools / relPrompt），其它字段以 DB 现状为准。
     */
    private void applyInputRuntimeFields(DigitalEmployeeDetailsDTO details, DigitalEmployeeDTO inputDto) {
        if (details == null || inputDto == null) {
            return;
        }
        if (inputDto.getRelTools() != null) {
            details.setRelTools(inputDto.getRelTools());
        }
        // relPrompt 以本次提交为准：
        // - 显式传 relPrompt：直接使用，允许空串表达"清空"；
        // - 否则若传了 corePersonaDefinition：按同源字段同步，允许空串覆盖；
        // - 两者都未传：保持 findDetailsById 查出的值不变。
        if (inputDto.getRelPrompt() != null) {
            details.setRelPrompt(inputDto.getRelPrompt());
        }
        else if (inputDto.getCorePersonaDefinition() != null) {
            details.setRelPrompt(inputDto.getCorePersonaDefinition());
        }
    }

    /** 更新/保存接口返回详情时，用本次入参兜底覆盖运行期字段，避免响应仍回显旧值。 */
    public void applyInputRuntimeFieldsForResponse(DigitalEmployeeDetailsDTO details, DigitalEmployeeDTO inputDto) {
        applyInputRuntimeFields(details, inputDto);
    }

    /**
     * 把刚刚生成的标准 JSON 串镜像写入 ss_res_ext_dig_employee.target_content。 失败仅记日志，不阻断后续 MinIO 同步——target_content 是辅助快照，缺失不影响主流程。
     */
    private void persistTargetContent(Long resourceId, String jsonContent) {
        if (resourceId == null || StringUtils.isBlank(jsonContent)) {
            return;
        }
        try {
            SsResExtDigEmployee ssResExtDigEmployee = ssResExtDigEmployeeService.findById(resourceId);
            if (ssResExtDigEmployee == null) {
                logger.warn("写入 target_content 失败：扩展表记录不存在, resourceId={}", resourceId);
                return;
            }
            ssResExtDigEmployee.setTargetContent(jsonContent);
            ssResExtDigEmployeeService.update(ssResExtDigEmployee);
        }
        catch (Exception e) {
            logger.warn("写入 target_content 异常, resourceId={}, ignored. err={}", resourceId, e.getMessage());
        }
    }

    private void normalizeRelSkillsForSave(DigitalEmployeeDTO digitalEmployeeDTO) {
        if (digitalEmployeeDTO == null) {
            return;
        }
        List<Map<String, Object>> relSkills = buildStandardRelSkills(digitalEmployeeDTO.getRelSkills(),
            digitalEmployeeDTO.getSkills());
        if (relSkills == null) {
            return;
        }
        digitalEmployeeDTO.setRelSkills(toRelSkillObjects(relSkills));
        digitalEmployeeDTO.setSkills(JSON.toJSONString(relSkills));
    }

    private List<Object> toRelSkillObjects(List<Map<String, Object>> relSkills) {
        return relSkills == null ? null : new ArrayList<>(relSkills);
    }

    private List<Long> mergeRelSkillIds(List<Long> relIds, List<?> relSkills) {
        LinkedHashSet<Long> mergedRelIds = new LinkedHashSet<>();
        if (CollectionUtils.isNotEmpty(relIds)) {
            mergedRelIds.addAll(relIds.stream().filter(Objects::nonNull).collect(Collectors.toList()));
        }
        if (CollectionUtils.isNotEmpty(relSkills)) {
            for (Object relSkill : relSkills) {
                Map<String, Object> itemMap = toMap(relSkill);
                Long resourceId = parseLongSafely(firstNotBlank(
                    stringValue(itemMap.get("resourceId")),
                    stringValue(itemMap.get("skillId")),
                    stringValue(itemMap.get("value"))));
                if (resourceId != null) {
                    mergedRelIds.add(resourceId);
                }
            }
        }
        return new ArrayList<>(mergedRelIds);
    }

    private List<Map<String, Object>> buildStandardRelSkills(List<?> relSkills, String skillsJson) {
        if (relSkills == null && StringUtils.isBlank(skillsJson)) {
            return null;
        }
        List<Object> rawItems = new ArrayList<>();
        if (StringUtils.isNotBlank(skillsJson)) {
            try {
                rawItems.addAll(JSON.parseArray(skillsJson, Object.class));
            }
            catch (Exception e) {
                logger.warn("解析数字员工技能列表失败, ignored. err={}", e.getMessage());
            }
        }
        else if (relSkills != null) {
            rawItems.addAll(relSkills);
        }
        if (CollectionUtils.isEmpty(rawItems)) {
            return Collections.emptyList();
        }

        Set<Long> resourceIds = new LinkedHashSet<>();
        Set<String> skillCodes = new LinkedHashSet<>();
        for (Object rawItem : rawItems) {
            Map<String, Object> itemMap = toMap(rawItem);
            String resourceIdText = StringUtils.trimToNull(stringValue(itemMap.get("resourceId")));
            if (resourceIdText == null) {
                resourceIdText = StringUtils.trimToNull(stringValue(itemMap.get("skillId")));
            }
            if (resourceIdText == null) {
                resourceIdText = StringUtils.trimToNull(stringValue(itemMap.get("value")));
            }
            Long resourceId = parseLongSafely(resourceIdText);
            if (resourceId != null) {
                resourceIds.add(resourceId);
            }

            String skillCode = firstNotBlank(
                stringValue(itemMap.get("skillCode")),
                stringValue(itemMap.get("resourceCode")),
                parseLongSafely(stringValue(itemMap.get("value"))) == null ? stringValue(itemMap.get("value")) : null,
                rawItem instanceof String ? (String) rawItem : null);
            if (StringUtils.isNotBlank(skillCode)) {
                skillCodes.add(skillCode);
            }
        }

        Map<Long, SsResource> resourceById = new HashMap<>();
        if (ssResourceService != null && !CollectionUtils.isEmpty(resourceIds)) {
            List<SsResource> resources = ssResourceService.findByIdList(resourceIds);
            if (!CollectionUtils.isEmpty(resources)) {
                resources.stream()
                    .filter(item -> item != null && ResourceBizTypeEnum.SKILL.name().equals(item.getResourceBizType()))
                    .forEach(item -> resourceById.put(item.getResourceId(), item));
            }
        }

        Map<String, SsResource> resourceByCode = new HashMap<>();
        if (ssResourceService != null && !CollectionUtils.isEmpty(skillCodes)) {
            List<SsResource> resources = ssResourceService.getResourceListByCode(new ArrayList<>(skillCodes));
            if (!CollectionUtils.isEmpty(resources)) {
                resources.stream()
                    .filter(item -> item != null && ResourceBizTypeEnum.SKILL.name().equals(item.getResourceBizType()))
                    .forEach(item -> resourceByCode.put(item.getResourceCode(), item));
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        Set<String> emittedSkillCodes = new LinkedHashSet<>();
        for (Object rawItem : rawItems) {
            Map<String, Object> itemMap = toMap(rawItem);
            Long resourceId = parseLongSafely(firstNotBlank(
                stringValue(itemMap.get("resourceId")),
                stringValue(itemMap.get("skillId")),
                stringValue(itemMap.get("value"))));
            String inputSkillCode = firstNotBlank(
                stringValue(itemMap.get("skillCode")),
                stringValue(itemMap.get("resourceCode")),
                parseLongSafely(stringValue(itemMap.get("value"))) == null ? stringValue(itemMap.get("value")) : null,
                rawItem instanceof String ? (String) rawItem : null);
            SsResource skillResource = resourceId == null ? null : resourceById.get(resourceId);
            if (skillResource == null && StringUtils.isNotBlank(inputSkillCode)) {
                skillResource = resourceByCode.get(inputSkillCode);
            }

            String skillCode = skillResource == null ? inputSkillCode : skillResource.getResourceCode();
            if (StringUtils.isBlank(skillCode) || emittedSkillCodes.contains(skillCode)) {
                continue;
            }
            emittedSkillCodes.add(skillCode);

            SsResExtSkill extSkill = skillResource == null || skillResource.getResourceId() == null || ssResExtSkillService == null
                ? null
                : ssResExtSkillService.findById(skillResource.getResourceId());
            String skillType = firstNotBlank(
                stringValue(itemMap.get("skillType")),
                extSkill == null ? null : extSkill.getSkillType(),
                SsResExtSkillService.DEFAULT_SKILL_TYPE);
            boolean innerSkill = StringUtils.equalsIgnoreCase(skillType, SsResExtSkillService.INNER_SKILL_TYPE);

            Map<String, Object> relSkill = new LinkedHashMap<>();
            Long resolvedResourceId = skillResource == null ? resourceId : skillResource.getResourceId();
            if (resolvedResourceId != null) {
                relSkill.put("resourceId", resolvedResourceId);
            }
            relSkill.put("skillCode", skillCode);
            relSkill.put("skillType", skillType);
            relSkill.put("skillUrl", innerSkill ? "" : buildSkillDownloadUrl(resolvedResourceId,
                stringValue(itemMap.get("skillUrl"))));
            relSkill.put("versionUrl", buildSkillVersionUrl(resolvedResourceId, stringValue(itemMap.get("versionUrl"))));
            result.add(relSkill);
        }
        return result;
    }

    private Map<String, Object> toMap(Object value) {
        if (value instanceof Map) {
            return (Map<String, Object>) value;
        }
        if (value instanceof String) {
            Map<String, Object> map = new HashMap<>();
            map.put("skillCode", value);
            return map;
        }
        if (value == null) {
            return Collections.emptyMap();
        }
        return JSON.parseObject(JSON.toJSONString(value), Map.class);
    }

    private String buildSkillVersionUrl(Long resourceId, String fallback) {
        if (resourceId == null) {
            return StringUtils.defaultString(fallback);
        }
        return "/byaiService/tool/getSkillVersion?skillId=" + resourceId;
    }

    private String buildSkillDownloadUrl(Long resourceId, String fallback) {
        if (resourceId == null) {
            return StringUtils.defaultString(fallback);
        }
        return "/byaiService/tool/downloadSkillZip?skillId=" + resourceId;
    }

    private Long parseLongSafely(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return Long.parseLong(value);
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private String firstNotBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (StringUtils.isNotBlank(value)) {
                return StringUtils.trim(value);
            }
        }
        return null;
    }

    /** 反序列化 target_content 里的 relTools 数组；不存在或解析失败返回 null。 */
    private List<String> parseRelToolsFromTargetContent(String targetContent) {
        com.alibaba.fastjson2.JSONObject obj = parseTargetContentSafely(targetContent);
        if (obj == null) {
            return null;
        }
        com.alibaba.fastjson2.JSONArray arr = obj.getJSONArray("relTools");
        return arr == null ? null : arr.toJavaList(String.class);
    }

    /** 反序列化 target_content 里的 relPrompt 字符串；不存在或解析失败返回 null。 */
    private String parseRelPromptFromTargetContent(String targetContent) {
        com.alibaba.fastjson2.JSONObject obj = parseTargetContentSafely(targetContent);
        if (obj == null) {
            return null;
        }
        return obj.getString("relPrompt");
    }

    /** 通用：把 target_content 解析为 JSONObject，失败返回 null 并记 warn。 */
    private com.alibaba.fastjson2.JSONObject parseTargetContentSafely(String targetContent) {
        if (StringUtils.isBlank(targetContent)) {
            return null;
        }
        try {
            return JSON.parseObject(targetContent);
        }
        catch (Exception e) {
            logger.warn("解析 target_content 失败, ignored. err={}", e.getMessage());
            return null;
        }
    }

    /**
     * @param digitalEmployeeDetailsDTO 修改模型的名称-防止在后台修改
     */
    private void updateModelName(DigitalEmployeeDetailsDTO digitalEmployeeDetailsDTO) {
        String prologue = digitalEmployeeDetailsDTO.getPrologue();
        Map<String, Object> promap = JSONObject.parseObject(prologue);
        Map<String, Object> modelMap = (Map<String, Object>) MapUtils.getMap(promap, "modelInfo");
        // 得到modelId,设置modelName
        if (MapUtils.isNotEmpty(modelMap)) {
            Long modelId = MapUtils.getLong(modelMap, "modelId");
            if (modelId != null) {
                ModelDto model = aiModelService.getModel(String.valueOf(modelId));
                if (model != null) {
                    modelMap.put("model", model.getModelName());
                    promap.put("modelInfo", modelMap);
                    digitalEmployeeDetailsDTO.setPrologue(JSONObject.toJSONString(promap));
                }
            }
        }
    }

    public ResponseUtil<?> queryRelResourceInfo(DigitalEmployeeDetailsDTO digitalEmployeeDetailsDTO) {
        List<SsResourceRelDetail> ssResourceRelDetailList = ssResourceRelDetailService
            .findByResourceId(digitalEmployeeDetailsDTO.getResourceId());
        List<SsResource> relResourceList = new ArrayList<>(10);
        if (CollectionUtils.isNotEmpty(ssResourceRelDetailList)) {
            List<Long> relIds = ssResourceRelDetailList.stream().map(SsResourceRelDetail::getRelResourceId)
                .collect(Collectors.toList());
            relResourceList = ssResourceService.findByIdList(relIds);
        }

        return ResponseUtil.successResponse(I18nUtil.get("digemployee.rel.resource.query.success"), relResourceList);
    }

    /**
     * 构建数字员工核心扩展参数
     *
     * @param relIds 关联扩展资源标识
     * @param digEmployeeExtCore 数字员工核心扩展类
     */
    private void buildDigEmployeeExtCore(List<Long> relIds, DigEmployeeExtCore digEmployeeExtCore) {

        if (ListUtil.isEmpty(relIds)) {
            return;
        }

    }

    /**
     * 生成智能体提示词 根据输入的提示词参数，调用AI服务生成智能体所需的各类提示词内容
     *
     * @param promptInputMap 提示词输入参数，包含lang（语言）、promptGroupCode（提示词分组编码）等
     * @return 生成的提示词Map，key为提示词字段编码，value为生成的提示词内容
     */
    public Map<String, Object> generate(Map<String, Object> promptInputMap) {

        // 获取语言参数
        String lang = org.apache.commons.collections.MapUtils.getString(promptInputMap, "lang", "zh");
        String promptGroupCode = org.apache.commons.collections.MapUtils.getString(promptInputMap, "promptGroupCode",
            "DIG_EMPLOYEE_PROMPT");

        List<AiPrompt> aiPrompts = aiPromptService.findPromptGroupCode(promptGroupCode);

        // 根据输入提示词基本信息
        String agentInfo = this.buildAgentInfo(promptInputMap, aiPrompts, lang);

        Map<String, Object> generateMap = new HashMap<>(10);
        for (AiPrompt aiPrompt : aiPrompts) {
            String template = "zh".equals(lang) ? aiPrompt.getPromptZhTemplate() : aiPrompt.getPromptEnTemplate();

            // 生成提示描述信息
            String prompt = template.replace("${description}", agentInfo);
            String value = aiService.generateText(prompt, aiPrompt.getModelCode());
            generateMap.put(aiPrompt.getPromptFiledCode(), value);
        }

        return generateMap;

    }

    /**
     * 构建智能体信息描述：将输入参数和提示词模板组合，构建用于AI生成的智能体描述信息
     *
     * @param paramsInput 输入的参数Map
     * @param aiPrompts 提示词模板列表
     * @param lang 语言类型（zh：中文，en：英文）
     * @return 格式化后的智能体信息描述字符串
     */
    private String buildAgentInfo(Map<String, Object> paramsInput, List<AiPrompt> aiPrompts, String lang) {
        StringBuilder agentInfo = new StringBuilder();
        for (AiPrompt aiPrompt : aiPrompts) {
            String promptFiledCode = aiPrompt.getPromptFiledCode();
            String promptFiledValue = MapParamUtil.getStringValue(paramsInput, promptFiledCode);
            String property = "zh".equals(lang) ? aiPrompt.getPromptName() : aiPrompt.getPromptCode();
            agentInfo.append(property).append(": ").append(promptFiledValue).append("\n");
        }
        return agentInfo.toString();
    }

    /**
     * 查询调试会话信息
     *
     * @param agentId 数字员工标识
     * @return DebugSessionVo
     */
    public DebugSessionVo debugSession(Long agentId) {

        ByaiSession byaiSession = byaiSessionService.findDebugSessionByAgentId(agentId);

        if (byaiSession == null) {
            return null;
        }

        MessageHotPageQo messageHotPageQo = new MessageHotPageQo();
        messageHotPageQo.setSessionId(byaiSession.getSessionId());
        messageHotPageQo.setPageNum(1);
        messageHotPageQo.setPageSize(1000);
        PageInfo<ByaiMessage> pageInfo = byaiMessageHotService.selectByPageQo(messageHotPageQo);

        DebugSessionVo debugSessionVo = new DebugSessionVo();
        debugSessionVo.setSessionInfo(byaiSession);
        debugSessionVo.setMessages(pageInfo.getList());
        debugSessionVo.setTotalMessageCount(pageInfo.getTotal());
        return debugSessionVo;
    }

    /**
     * 根据defaultType查询数据
     *
     * @param agentListQo 查询对象
     * @return List<SsResource>
     */
    public List<SsResource> queryResourceListByDefaultType(AgentListQo agentListQo) {

        // 1.首先查询默认类型
        String defaultType = agentListQo.getDefaultType();
        List<ByaiSystemConfigList> configLists = byaiSystemConfigListService.findByParamGroupCode(defaultType);

        List<String> codes = new ArrayList<>();
        for (ByaiSystemConfigList byaiSystemConfigList : configLists) {
            codes.add(byaiSystemConfigList.getParamValue());
        }

        // 2.根据resourceCode查询即可
        if (CollectionUtils.isEmpty(codes)) {
            return null;
        }

        return ssResourceService.getResourceListByCode(codes);
    }

    public Map<String, Long> getStatusNumStatics(ResourceQueryRequest request) {
        // 管理员设�?
        setQuery(request);

        // 我管理的，不仅仅是查man_user_id，还要给有管理权限的人授
        Map<Integer, Long> statusNumMap = new HashMap<>();
        // TODO:
        // 或者将此方法也移至ResourceAuthApplicationService
        List<Map<Integer, Long>> statusNumList = ssResourceService.getStatusNumStatics(request);

        // 计算所有状态的总数
        // 用于存储各状态的总和
        Map<String, Long> statusNumStatics = new HashMap<>();

        // 遍历列表中的每个Map，累加各状态的�?
        for (Map<Integer, Long> statusMap : statusNumList) {
            // 累加每个Map中的所有值到总数
            // 累加各状态的值（使用getOrDefault避免NullPointerException�?
            statusNumMap.put(org.apache.commons.collections.MapUtils.getInteger(statusMap, "resourceStatus"),
                org.apache.commons.collections.MapUtils.getLong(statusMap, "num"));
        }
        Long draft = statusNumMap.getOrDefault(0, 0L);
        // Long pending = statusNumMap.getOrDefault(1, 0L);
        Long shelf = statusNumMap.getOrDefault(2, 0L);
        Long unshelf = statusNumMap.getOrDefault(3, 0L);
        Long audit = statusNumMap.getOrDefault(4, 0L);
        Long auditReject = statusNumMap.getOrDefault(5, 0L);
        Long total = draft + shelf + unshelf + auditReject + audit;

        // 将计算结果放入结果Map
        statusNumStatics.put("ALL", total);
        statusNumStatics.put("DRAFT", draft);
        // statusNumStatics.put("PENDING", pending);
        statusNumStatics.put("SHELF", shelf);
        statusNumStatics.put("UNSHELF", unshelf);
        statusNumStatics.put("AUDIT", audit);
        statusNumStatics.put("AUDIT_REJECT", auditReject);

        return statusNumStatics;
    }

    private void setQuery(ResourceQueryRequest request) {
        if (CurrentUserHolder.isPlatformAdminOrOperator()) {
            request.setOwnershipType(null);
        }
        if (null != request.getOwnershipType() && 2 == request.getOwnershipType()) {
            // 1. 首先得到所有有管理权限的资源id
            Set<Long> managedResourceIds = getAuthListByResourceTypeAndGrantType(request.getResourceTypeList(),
                List.of(GrantType.ALLOW_MANAGE));
            // 如果没有管理权限的资源，只查我创建的
            if (managedResourceIds != null && !managedResourceIds.isEmpty()) {
                // 有管理权限的资源列表
                request.setResourceIdList(managedResourceIds);
                // 需要在SQL中实现：resource_id IN (managedResourceIds) OR create_by = currentUserId
            }
            else {
                request.setResourceIdList(Set.of(Long.MIN_VALUE));
            }
        }
        // 我创建的
        if (null != request.getOwnershipType() && 1 == request.getOwnershipType()) {
            request.setUserId(CurrentUserHolder.getCurrentUserId());
        }
    }

    public Set<Long> getAuthListByResourceTypeAndGrantType(List<String> resourceTypeList, List<String> grantTypes) {

        // 查询当前用户权限列表
        Long grantToObjId = CurrentUserHolder.getCurrentUserId();
        String grantToObjType = GrantToObjType.USER;
        List<PrivilegeGrant> authList = authApplicationService.listAuthPrivilegeGrant("", resourceTypeList,
            grantToObjType, grantToObjId, grantTypes);

        // 过滤掉黑名单资源
        return filterBackList(authList);
    }

    /**
     * 过滤权限列表中的黑名单资�?
     *
     * @param authList 权限授权列表，包含资源授权信�?
     * @return 过滤后的有效资源ID集合，不包含黑名单资�?
     */
    public Set<Long> filterBackList(List<PrivilegeGrant> authList) {
        if (authList == null || authList.isEmpty()) {
            return Collections.emptySet();
        }

        // 按资源ID分组处理权限
        Map<Long, List<PrivilegeGrant>> authByResource = authList.stream().filter(item -> null != item.getGrantObjId())
            .collect(Collectors.groupingBy(PrivilegeGrant::getGrantObjId));

        // 过滤掉黑名单中的资源
        return authByResource.entrySet().stream().filter(entry -> {
            List<PrivilegeGrant> resourceAuths = entry.getValue();
            // 检查是否有红名单权�?
            boolean hasRedAuth = resourceAuths.stream().anyMatch(auth -> Color.RED.equals(auth.getGrantToType()));

            // 检查是否有黑名单权�?
            boolean hasBlackAuth = resourceAuths.stream().anyMatch(auth -> Color.BLACK.equals(auth.getGrantToType()));

            // 黑名单优先级更高：有红名单且无黑名单才有�?
            return hasRedAuth && !hasBlackAuth;
        }).map(Map.Entry::getKey).collect(Collectors.toSet());
    }

    /**
     * 根据会话ID清理调试消息接口
     *
     * @param sessionId 数字员工ID，用于标识需要清理调试消息的会话
     * @return 返回清理调试消息的结果响应）
     */
    public DebugSessionCleanupVo cleanupDebugMessages(Long sessionId) {

        DebugSessionCleanupVo debugSessionCleanupVo = new DebugSessionCleanupVo();
        debugSessionCleanupVo.setSuccess(true);

        ByaiSession byaiSession = byaiSessionService.findById(sessionId);
        if (byaiSession == null) {
            return debugSessionCleanupVo;
        }

        MessageHotDelQo messageHotDelQo = new MessageHotDelQo();
        messageHotDelQo.setSessionId(sessionId);
        byaiMessageHotService.deleteByQo(messageHotDelQo);

        return debugSessionCleanupVo;

    }

    /**
     * 商业版本（dataset.system=WHALE_AGENT）下，企业 tab 不允许创建编码型/调试型数字员工。 个人 tab 不受限；非商业版本（datasetSystem 为空或其它值）也不受限。
     *
     * @author qin.guoquan
     * @date 2026-05-07
     */
    private void validateCommercialEditionDigitalEmployeeCreation(DigitalEmployeeDTO digitalEmployeeDTO) {
        if (digitalEmployeeDTO == null) {
            return;
        }
        if (!SystemCode.WHAGE_AGENT.getCode().equalsIgnoreCase(StringUtils.trimToEmpty(datasetSystem))) {
            return;
        }
        if (!OwnerType.ENTERPRISE.equals(digitalEmployeeDTO.getOwnerType())) {
            return;
        }
        String agentType = StringUtils.trimToEmpty(digitalEmployeeDTO.getAgentType());
        if (DigitalEmployType.AGENT_TYPE_DEBUG.getCode().equals(agentType)
            || DigitalEmployType.AGENT_TYPE_CODE.getCode().equals(agentType)) {
            String typeDesc = DigitalEmployType.AGENT_TYPE_DEBUG.getCode().equals(agentType)
                ? DigitalEmployType.AGENT_TYPE_DEBUG.getDesc()
                : DigitalEmployType.AGENT_TYPE_CODE.getDesc();
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("commercial.not.support.create.digital.employee", typeDesc));
        }

    }

}
