package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupWorkAssistantMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupWorkAssistantResponse;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import lombok.RequiredArgsConstructor;

/** 新建群时解析由平台统一发布、供多个企业共用的组织级助手。关联 beyonai/byclaw-hacu#6。 */
@Service
@RequiredArgsConstructor
public class GroupWorkAssistantService {
    public static final String NAME_CONFIG = "BYAI_GROUP_WORK_ASSISTANT_NAME";
    public static final String DEFAULT_NAME = "群组工作助手";

    private final ByaiSystemConfigService systemConfigService;
    private final GroupWorkAssistantMapper mapper;
    private final SsResourceService resourceService;
    @org.springframework.beans.factory.annotation.Autowired
    private SessionExtService sessionExtService;
    @org.springframework.beans.factory.annotation.Autowired
    private SessionMemberService memberService;
    @org.springframework.beans.factory.annotation.Autowired
    private SequenceService sequenceService;
    public static final String COORDINATOR_EXT = "group_coordinator_agent_id";

    /** Resolve one published coordinator; ambiguous configuration must be corrected explicitly. */
    public Long resolveDefaultCoordinatorId() {
        List<GroupWorkAssistantResponse> assistants = getDefaultAssistants();
        if (assistants.size() != 1) {
            throw new GroupChatMessageRejectedException("Configure exactly one group work assistant");
        }
        return Long.valueOf(assistants.getFirst().resourceId());
    }

    public Long resolveCoordinatorId(Long groupSessionId) {
        ByaiSessionExt ext = sessionExtService.findOneByExtParamCode(groupSessionId, COORDINATOR_EXT);
        Long id = ext == null ? resolveDefaultCoordinatorId() : Long.valueOf(ext.getExtParamValue());
        if (memberService.findSessionMember(groupSessionId, "AGENT", id) == null) {
            throw new GroupChatMessageRejectedException("Group work assistant is not a group member");
        }
        if (ext == null) bindCoordinator(groupSessionId, id);
        return id;
    }

    public void bindCoordinator(Long groupSessionId, Long coordinatorId) {
        ByaiSessionExt ext = sessionExtService.findOneByExtParamCode(groupSessionId, COORDINATOR_EXT);
        if (ext == null) {
            ext = new ByaiSessionExt();
            ext.setExtId(sequenceService.nextVal());
            ext.setSessionId(groupSessionId);
            ext.setExtParamCode(COORDINATOR_EXT);
            ext.setExtParamName(COORDINATOR_EXT);
            ext.setExtParamValue(coordinatorId.toString());
            sessionExtService.save(ext);
        }
        else if (!coordinatorId.toString().equals(ext.getExtParamValue())) {
            ext.setExtParamValue(coordinatorId.toString());
            sessionExtService.update(ext);
        }
    }

    public List<GroupWorkAssistantResponse> getDefaultAssistants() {
        String configured = StringUtils.defaultIfBlank(
            systemConfigService.getDcSystemConfigValueByCode(NAME_CONFIG), DEFAULT_NAME).trim();
        // 兼容原有单名称配置；数组可配置多个名称，并保留各语言的原始名称。
        List<String> names = configured.startsWith("[")
            ? JSON.parseArray(configured, String.class) : List.of(configured);
        LinkedHashSet<Long> resourceIds = new LinkedHashSet<>();
        names.stream().filter(StringUtils::isNotBlank).map(String::trim).distinct()
            .forEach(name -> resourceIds.addAll(mapper.findCandidates(name)));
        if (resourceIds.isEmpty()) return List.of();

        Map<Long, SsResource> resources = resourceService.findByIdList(resourceIds).stream()
            .collect(Collectors.toMap(SsResource::getResourceId, Function.identity()));
        List<GroupWorkAssistantResponse> result = new ArrayList<>();
        for (Long resourceId : resourceIds) {
            SsResource resource = resources.get(resourceId);
            if (resource != null && Integer.valueOf(2).equals(resource.getResourceStatus())) {
                result.add(new GroupWorkAssistantResponse(String.valueOf(resourceId), resource.getResourceName(),
                    resource.getResourceDesc(), resource.getAvatar()));
            }
        }
        return result;
    }
}
