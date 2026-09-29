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
