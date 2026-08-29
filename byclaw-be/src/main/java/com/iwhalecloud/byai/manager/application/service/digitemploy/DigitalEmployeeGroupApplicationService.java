package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeGroupMemberDTO;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeDTO;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeRequestDTO;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceVersion;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceVersionMapper;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * 数字员工组成员、配置版本与运行时聚合服务。
 */
@Service
public class DigitalEmployeeGroupApplicationService {

    public static final String GROUP_AGENT_TYPE = "017";
    public static final String GROUP_MEMBER_REL_TYPE = "DIG_EMPLOYEE_GROUP_MEMBER";

    private static final String ORCHESTRATOR_KIND = "EXPERT_TEAM";
    private static final String REQUEST_SCHEMA = "byclaw.orchestrator-runtime-request/v1";
    private static final String RUNTIME_SCHEMA = "byclaw.orchestrator-runtime/v1";
    private static final String SNAPSHOT_SCHEMA = "byclaw.digital-employee-group-runtime/v1";
    private static final String MEMBER_SCHEMA = "byclaw.digital-employee-group-member/v1";
    private static final String CONTEXT_PROFILE = "EXPERT_TEAM_MINIMAL_V1";
    private static final int MAX_MEMBER_COUNT = 20;
    private static final int MAX_TEAM_ROLE_LENGTH = 100;
    public static final Set<String> ALLOWED_MEMBER_AGENT_TYPES =
        Set.of("001", "005", "006", "011");
    public static final Set<String> ALLOWED_THIRD_INTEGRATIONS =
        Set.of("INTERFACE", "A2A", "PAGE");

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceVersionMapper ssResourceVersionMapper;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private AiModelService aiModelService;

    public boolean isGroup(String agentType) {
        return GROUP_AGENT_TYPE.equals(StringUtils.trimToEmpty(agentType));
    }

    public boolean isGroup(Long resourceId) {
        SsResExtDigEmployee ext = ssResExtDigEmployeeService.findById(resourceId);
        return ext != null && isGroup(ext.getAgentType());
    }

    /** 返回当前用户可管理且可作为组员的数字员工候选。 */
    public PageInfo<EmployeeGroupMemberDTO> filterMemberCandidates(PageInfo<DigitalEmployeePageVo> source) {
        PageInfo<EmployeeGroupMemberDTO> result = new PageInfo<>();
        if (source == null) {
            result.setList(new ArrayList<>());
            return result;
        }
        result.setPageNum(source.getPageNum());
        result.setPageSize(source.getPageSize());
        List<DigitalEmployeePageVo> sourceList = source.getList() == null ? new ArrayList<>() : source.getList();
        List<Long> ids = sourceList.stream().map(DigitalEmployeePageVo::getResourceId).filter(Objects::nonNull)
            .collect(Collectors.toList());
        Map<Long, ResourceExtDigEmployeeDto> facts = loadMemberFacts(ids);
        List<EmployeeGroupMemberDTO> candidates = new ArrayList<>();
        for (DigitalEmployeePageVo item : sourceList) {
            ResourceExtDigEmployeeDto fact = facts.get(item.getResourceId());
            if (!isEligibleCandidate(fact) || !authApplicationService.hasResourceManagePermission(fact)) {
                continue;
            }
            EmployeeGroupMemberDTO candidate = toMemberDto(fact, null);
            candidate.setSortOrder(candidates.size() + 1);
            candidates.add(candidate);
        }
        result.setList(candidates);
        result.setTotal(candidates.size());
        result.setTotalPages(candidates.isEmpty() ? 0 : 1);
        return result;
    }

    /**
     * 保存成员关系，并生成新的在用快照。调用者的数字员工主事务会覆盖本方法事务边界。
     */
    @Transactional(rollbackFor = Exception.class)
    public String saveGroupConfiguration(SsResource group, DigitalEmployeeDTO input) {
        validateGroupResource(group, input);
        String prompt = StringUtils.trimToEmpty(input.getCorePersonaDefinition());
        if (StringUtils.isBlank(prompt)) {
            throw invalidConfig("数字员工组 Prompt 不能为空");
        }
        String modelId = extractModelId(input.getPrologue());
        if (StringUtils.isBlank(modelId)) {
            throw invalidConfig("数字员工组模型不能为空");
        }

        List<EmployeeGroupMemberDTO> requested = normalizeMembers(input.getEmployeeGroupMembers());
        Map<Long, ResourceExtDigEmployeeDto> memberFacts = loadMemberFactsForConfigs(requested);
        for (EmployeeGroupMemberDTO member : requested) {
            ResourceExtDigEmployeeDto fact = memberFacts.get(member.getResourceId());
            validateMember(group, fact, true);
        }

        replaceMemberRelations(group, requested);
        long versionId = createRuntimeSnapshot(group, prompt, modelId, requested);
        group.setResourceDVerid(versionId);
        group.setResourceRVerid(versionId);
        ssResourceService.updateResourceEntity(group);
        return String.valueOf(versionId);
    }

    public void enrichGroupDetails(DigitalEmployeeDetailsDTO details) {
        if (details == null || !isGroup(details.getAgentType())) {
            return;
        }
        List<SsResourceRelDetail> relations = findActiveMemberRelations(details.getResourceId());
        List<Long> ids = relations.stream().map(SsResourceRelDetail::getRelResourceId).filter(Objects::nonNull)
            .distinct().collect(Collectors.toList());
        Map<Long, ResourceExtDigEmployeeDto> facts = loadMemberFacts(ids);
        List<EmployeeGroupMemberDTO> members = new ArrayList<>();
        for (SsResourceRelDetail relation : relations) {
            ResourceExtDigEmployeeDto fact = facts.get(relation.getRelResourceId());
            EmployeeGroupMemberDTO member = toMemberDto(fact, relation);
            if (member != null) {
                members.add(member);
            }
        }
        members.sort(Comparator.comparing(EmployeeGroupMemberDTO::getSortOrder,
            Comparator.nullsLast(Integer::compareTo)));
        details.setEmployeeGroupMembers(members);
        details.setConfigVersion(details.getResourceRVerid() == null ? null
            : String.valueOf(details.getResourceRVerid()));
        // 组成员不能混入普通资源选择器的 relIds / relResourceList。
        details.setRelIds(new ArrayList<>());
        details.setRelResourceList(new ArrayList<>());
    }

    /**
     * 校验组使用权并返回 Super 可直接冻结到本轮 Run 的快照。
     */
    public OrchestratorRuntimeDTO resolveRuntime(OrchestratorRuntimeRequestDTO request) {
        validateRuntimeRequest(request);
        Long groupId = parseGroupId(request.getOrchestratorId());
        SsResource group = ssResourceService.findById(groupId);
        SsResExtDigEmployee groupExt = ssResExtDigEmployeeService.findById(groupId);
        if (!isVisibleGroup(group, groupExt)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数字员工组不存在或不可见");
        }
        if (!authApplicationService.hasResourceUsePermission(group)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前用户无数字员工组使用权限");
        }
        if (group.getResourceRVerid() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组尚无可运行配置");
        }
        SsResourceVersion version = ssResourceVersionMapper.selectById(group.getResourceRVerid());
        if (version == null || version.getVersionStatus() == null || version.getVersionStatus() != 3
            || StringUtils.isBlank(version.getExtInfo())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组在用配置不完整");
        }

        JSONObject snapshot;
        try {
            snapshot = JSON.parseObject(version.getExtInfo());
        }
        catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组在用配置格式错误", e);
        }
        if (!SNAPSHOT_SCHEMA.equals(snapshot.getString("schemaVersion"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组在用配置版本不受支持");
        }
        String prompt = StringUtils.trimToEmpty(snapshot.getString("prompt"));
        String modelId = StringUtils.trimToEmpty(snapshot.getString("modelId"));
        if (StringUtils.isAnyBlank(prompt, modelId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组 Prompt 或模型配置不完整");
        }
        ModelDto model;
        try {
            model = aiModelService.getModel(modelId);
        }
        catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "模型配置服务不可用", e);
        }
        if (model == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组模型不存在或已停用");
        }

        List<EmployeeGroupMemberDTO> configuredMembers = parseSnapshotMembers(snapshot.getJSONArray("members"));
        Map<Long, ResourceExtDigEmployeeDto> currentFacts = loadMemberFacts(
            configuredMembers.stream().map(EmployeeGroupMemberDTO::getResourceId).collect(Collectors.toList()));
        List<OrchestratorRuntimeDTO.Agent> agents = new ArrayList<>();
        for (EmployeeGroupMemberDTO configured : configuredMembers) {
            ResourceExtDigEmployeeDto fact = currentFacts.get(configured.getResourceId());
            if (!isEligibleMember(group, fact)) {
                continue;
            }
            agents.add(toRuntimeAgent(fact, configured.getTeamRole()));
        }
        if (agents.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组没有有效成员");
        }
        return buildRuntime(group, version, prompt, modelId, model, agents);
    }

    private void validateGroupResource(SsResource group, DigitalEmployeeDTO input) {
        if (group == null || input == null || !isGroup(input.getAgentType())) {
            throw invalidConfig("数字员工组类型必须为 017");
        }
        if (!WorkerAgentType.BY_SUPER.getCode().equals(group.getWorkerAgentType())) {
            throw invalidConfig("数字员工组运行类型必须为 BY_SUPER");
        }
    }

    private List<EmployeeGroupMemberDTO> normalizeMembers(List<EmployeeGroupMemberDTO> input) {
        if (CollectionUtils.isEmpty(input)) {
            throw invalidConfig("数字员工组至少需要一个成员");
        }
        if (input.size() > MAX_MEMBER_COUNT) {
            throw invalidConfig("数字员工组成员不能超过 " + MAX_MEMBER_COUNT + " 个");
        }
        Set<Long> seen = new HashSet<>();
        List<EmployeeGroupMemberDTO> normalized = new ArrayList<>();
        for (int i = 0; i < input.size(); i++) {
            EmployeeGroupMemberDTO source = input.get(i);
            if (source == null || source.getResourceId() == null || !seen.add(source.getResourceId())) {
                throw invalidConfig("数字员工组成员不能为空或重复");
            }
            EmployeeGroupMemberDTO member = new EmployeeGroupMemberDTO();
            member.setResourceId(source.getResourceId());
            member.setTeamRole(StringUtils.trimToEmpty(source.getTeamRole()));
            if (StringUtils.isBlank(member.getTeamRole())) {
                throw invalidConfig("数字员工组成员的团队角色不能为空");
            }
            if (member.getTeamRole().length() > MAX_TEAM_ROLE_LENGTH) {
                throw invalidConfig("数字员工组成员的团队角色不能超过 " + MAX_TEAM_ROLE_LENGTH + " 个字符");
            }
            member.setSortOrder(i + 1);
            normalized.add(member);
        }
        return normalized;
    }

    private void validateMember(SsResource group, ResourceExtDigEmployeeDto fact, boolean checkManagePermission) {
        if (!isEligibleMember(group, fact)) {
            throw invalidConfig("数字员工组包含不可用或配置不完整的成员");
        }
        if (checkManagePermission && !authApplicationService.hasResourceManagePermission(fact)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                "无权把数字员工加入当前数字员工组: " + fact.getResourceName());
        }
    }

    private boolean isEligibleMember(SsResource group, ResourceExtDigEmployeeDto fact) {
        if (group == null || fact == null || fact.getSsResExtDigEmployee() == null) {
            return false;
        }
        SsResExtDigEmployee ext = fact.getSsResExtDigEmployee();
        if (Objects.equals(group.getResourceId(), fact.getResourceId())
            || !Objects.equals(group.getComAcctId(), fact.getComAcctId())
            || !ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(fact.getResourceBizType())
            || !Objects.equals(ResourceStatus.LIST.getNum(), fact.getResourceStatus())
            || !ALLOWED_MEMBER_AGENT_TYPES.contains(ext.getAgentType())
            || WorkerAgentType.BY_SUPER.getCode().equals(fact.getWorkerAgentType())
            || StringUtils.isAnyBlank(fact.getResourceCode(), fact.getResourceName(), fact.getWorkerAgentType())) {
            return false;
        }
        if ("FROM_THIRD".equalsIgnoreCase(ext.getCreateType())) {
            String integration = StringUtils.upperCase(ext.getIntegrationType());
            if (!ALLOWED_THIRD_INTEGRATIONS.contains(integration)) {
                return false;
            }
            if ("PAGE".equals(integration)) {
                return StringUtils.isNotBlank(ext.getAgentWebUrl()) || StringUtils.isNotBlank(ext.getAgentHomeUrl());
            }
            return StringUtils.isNotBlank(ext.getAgentSseUrl());
        }
        return true;
    }

    private boolean isEligibleCandidate(ResourceExtDigEmployeeDto fact) {
        if (fact == null || fact.getSsResExtDigEmployee() == null
            || !Objects.equals(CurrentUserHolder.getEnterpriseId(), fact.getComAcctId())) {
            return false;
        }
        SsResource tenantGroup = new SsResource();
        tenantGroup.setComAcctId(CurrentUserHolder.getEnterpriseId());
        tenantGroup.setResourceId(-1L);
        return isEligibleMember(tenantGroup, fact);
    }

    private Map<Long, ResourceExtDigEmployeeDto> loadMemberFactsForConfigs(List<EmployeeGroupMemberDTO> members) {
        return loadMemberFacts(members.stream().map(EmployeeGroupMemberDTO::getResourceId).collect(Collectors.toList()));
    }

    private Map<Long, ResourceExtDigEmployeeDto> loadMemberFacts(List<Long> ids) {
        if (CollectionUtils.isEmpty(ids)) {
            return new HashMap<>();
        }
        return ssResExtDigEmployeeService.findExtDigEmployeeByIds(ids.stream().filter(Objects::nonNull).distinct()
            .collect(Collectors.toList())).stream().collect(Collectors.toMap(ResourceExtDigEmployeeDto::getResourceId,
                item -> item, (left, right) -> left, LinkedHashMap::new));
    }

    private void replaceMemberRelations(SsResource group, List<EmployeeGroupMemberDTO> members) {
        ssResourceRelDetailService.remove(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, group.getResourceId())
            .eq(SsResourceRelDetail::getRelTypeName, GROUP_MEMBER_REL_TYPE));
        Date now = new Date();
        List<SsResourceRelDetail> relations = new ArrayList<>();
        for (EmployeeGroupMemberDTO member : members) {
            JSONObject info = new JSONObject();
            info.put("schemaVersion", MEMBER_SCHEMA);
            info.put("teamRole", member.getTeamRole());
            info.put("sortOrder", member.getSortOrder());
            SsResourceRelDetail relation = new SsResourceRelDetail();
            relation.setResourceRelDetailId(sequenceService.nextVal());
            relation.setResourceId(group.getResourceId());
            relation.setRelResourceId(member.getResourceId());
            relation.setRelResourceInfo(info.toJSONString());
            relation.setRelTypeName(GROUP_MEMBER_REL_TYPE);
            relation.setRelStatus(1);
            relation.setCreateBy(CurrentUserHolder.getCurrentUserId());
            relation.setCreateTime(now);
            relation.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            relation.setUpdateTime(now);
            relation.setComAcctId(group.getComAcctId());
            relations.add(relation);
        }
        ssResourceRelDetailService.saveBatch(relations);
    }

    private long createRuntimeSnapshot(SsResource group, String prompt, String modelId,
        List<EmployeeGroupMemberDTO> members) {
        long versionId = sequenceService.nextVal();
        ssResourceVersionMapper.update(null, new LambdaUpdateWrapper<SsResourceVersion>()
            .eq(SsResourceVersion::getResourceId, group.getResourceId())
            .eq(SsResourceVersion::getVersionStatus, 3)
            .set(SsResourceVersion::getVersionStatus, 1)
            .set(SsResourceVersion::getUpdateBy, CurrentUserHolder.getCurrentUserId())
            .set(SsResourceVersion::getUpdateTime, new Date()));

        JSONObject extInfo = new JSONObject();
        extInfo.put("schemaVersion", SNAPSHOT_SCHEMA);
        extInfo.put("prompt", prompt);
        extInfo.put("modelId", modelId);
        extInfo.put("members", members);

        SsResourceVersion version = new SsResourceVersion();
        version.setResourceVersionId(versionId);
        version.setResourceId(group.getResourceId());
        version.setSystemCode(group.getSystemCode());
        version.setResourceSourcePkId(group.getResourceSourcePkId());
        version.setResourceBizType(group.getResourceBizType());
        version.setResourceType(group.getResourceType());
        version.setResourceName(group.getResourceName());
        version.setResourceDesc(group.getResourceDesc());
        version.setAvatar(group.getAvatar());
        version.setSample(group.getSample());
        version.setTags(group.getTags());
        version.setVersionNo(String.valueOf(versionId));
        version.setCatalogId(group.getCatalogId());
        version.setManOrgId(group.getManOrgId());
        version.setManUserId(group.getManUserId());
        version.setExtInfo(extInfo.toJSONString());
        version.setRelResourceList(JSON.toJSONString(members.stream().map(EmployeeGroupMemberDTO::getResourceId)
            .collect(Collectors.toList())));
        version.setResourceStatus(group.getResourceStatus());
        version.setVersionStatus(3);
        version.setCreateBy(CurrentUserHolder.getCurrentUserId());
        version.setCreateTime(new Date());
        version.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        version.setUpdateTime(new Date());
        version.setComAcctId(group.getComAcctId());
        ssResourceVersionMapper.insert(version);
        return versionId;
    }

    private List<SsResourceRelDetail> findActiveMemberRelations(Long groupId) {
        return ssResourceRelDetailService.list(new LambdaQueryWrapper<SsResourceRelDetail>()
            .eq(SsResourceRelDetail::getResourceId, groupId)
            .eq(SsResourceRelDetail::getRelTypeName, GROUP_MEMBER_REL_TYPE)
            .eq(SsResourceRelDetail::getRelStatus, 1));
    }

    private EmployeeGroupMemberDTO toMemberDto(ResourceExtDigEmployeeDto fact, SsResourceRelDetail relation) {
        if (fact == null || fact.getSsResExtDigEmployee() == null) {
            return null;
        }
        JSONObject info = relation == null ? new JSONObject() : parseRelationInfo(relation.getRelResourceInfo());
        SsResExtDigEmployee ext = fact.getSsResExtDigEmployee();
        EmployeeGroupMemberDTO member = new EmployeeGroupMemberDTO();
        member.setResourceId(fact.getResourceId());
        member.setResourceCode(fact.getResourceCode());
        member.setName(fact.getResourceName());
        member.setDescription(fact.getResourceDesc());
        member.setAvatar(fact.getAvatar());
        member.setTeamRole(info.getString("teamRole"));
        member.setSortOrder(info.getInteger("sortOrder"));
        member.setCreateType(ext.getCreateType());
        member.setIntegrationType(ext.getIntegrationType());
        member.setAgentType(ext.getAgentType());
        member.setWorkerAgentType(fact.getWorkerAgentType());
        return member;
    }

    private List<EmployeeGroupMemberDTO> parseSnapshotMembers(JSONArray array) {
        if (array == null) {
            return new ArrayList<>();
        }
        try {
            return array.toJavaList(EmployeeGroupMemberDTO.class);
        }
        catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "数字员工组成员快照格式错误", e);
        }
    }

    private OrchestratorRuntimeDTO.Agent toRuntimeAgent(ResourceExtDigEmployeeDto fact, String teamRole) {
        SsResExtDigEmployee ext = fact.getSsResExtDigEmployee();
        OrchestratorRuntimeDTO.Agent agent = new OrchestratorRuntimeDTO.Agent();
        agent.setId(String.valueOf(fact.getResourceId()));
        agent.setResourceCode(fact.getResourceCode());
        agent.setName(fact.getResourceName());
        agent.setDescription(fact.getResourceDesc());
        agent.setTeamRole(StringUtils.trimToNull(teamRole));
        agent.setCreateType(ext.getCreateType());
        agent.setIntegrationType(ext.getIntegrationType());
        agent.setAgentType(ext.getAgentType());
        return agent;
    }

    private OrchestratorRuntimeDTO buildRuntime(SsResource group, SsResourceVersion version, String prompt,
        String modelId, ModelDto model, List<OrchestratorRuntimeDTO.Agent> agents) {
        String configVersion = String.valueOf(version.getResourceVersionId());
        OrchestratorRuntimeDTO result = new OrchestratorRuntimeDTO();
        result.setSchemaVersion(RUNTIME_SCHEMA);
        result.setContextProfile(CONTEXT_PROFILE);
        result.setConfigVersion(configVersion);
        result.setAgents(agents);

        OrchestratorRuntimeDTO.Orchestrator orchestrator = new OrchestratorRuntimeDTO.Orchestrator();
        orchestrator.setId(String.valueOf(group.getResourceId()));
        orchestrator.setKind(ORCHESTRATOR_KIND);
        orchestrator.setName(group.getResourceName());
        result.setOrchestrator(orchestrator);

        OrchestratorRuntimeDTO.Prompt promptDto = new OrchestratorRuntimeDTO.Prompt();
        promptDto.setContent(prompt);
        promptDto.setVersion(configVersion);
        result.setPrompt(promptDto);

        OrchestratorRuntimeDTO.Model modelDto = new OrchestratorRuntimeDTO.Model();
        modelDto.setModelId(modelId);
        // byai_aimodel 无独立 config_version；使用模型自身稳定事实作为审计标识。
        modelDto.setConfigVersion(StringUtils.defaultIfBlank(model.getInstanceId(), modelId));
        result.setModel(modelDto);
        return result;
    }

    private boolean isVisibleGroup(SsResource group, SsResExtDigEmployee ext) {
        return group != null && ext != null && isGroup(ext.getAgentType())
            && ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(group.getResourceBizType())
            && Objects.equals(ResourceStatus.LIST.getNum(), group.getResourceStatus())
            && Objects.equals(CurrentUserHolder.getEnterpriseId(), group.getComAcctId());
    }

    private void validateRuntimeRequest(OrchestratorRuntimeRequestDTO request) {
        if (request == null || !REQUEST_SCHEMA.equals(request.getSchemaVersion())
            || !ORCHESTRATOR_KIND.equals(request.getKind()) || StringUtils.isBlank(request.getOrchestratorId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "数字员工组运行时请求不合法");
        }
    }

    private Long parseGroupId(String id) {
        try {
            return Long.valueOf(id);
        }
        catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "数字员工组不存在或不可见");
        }
    }

    private String extractModelId(String prologue) {
        if (StringUtils.isBlank(prologue)) {
            return null;
        }
        try {
            JSONObject json = JSON.parseObject(prologue);
            JSONObject modelInfo = json.getJSONObject("modelInfo");
            String modelId = modelInfo == null ? null : modelInfo.getString("modelId");
            return StringUtils.defaultIfBlank(modelId, json.getString("modelId"));
        }
        catch (Exception e) {
            throw invalidConfig("数字员工组模型配置格式错误");
        }
    }

    private JSONObject parseRelationInfo(String value) {
        if (StringUtils.isBlank(value)) {
            return new JSONObject();
        }
        try {
            return JSON.parseObject(value);
        }
        catch (Exception e) {
            return new JSONObject();
        }
    }

    private BaseException invalidConfig(String message) {
        return new BaseException(CommonErrorCode.ERROR_CODE_50500, message);
    }
}
