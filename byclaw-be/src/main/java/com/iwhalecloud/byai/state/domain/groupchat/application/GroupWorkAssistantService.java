package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.List;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupWorkAssistantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** 新建群时解析由平台统一发布、供多个企业共用的组织级助手。关联 beyonai/byclaw-hacu#6。 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GroupWorkAssistantService {
    public static final String NAME_CONFIG = "BYAI_GROUP_WORK_ASSISTANT_NAME";
    public static final String DEFAULT_NAME = "群组工作助手";

    private final ByaiSystemConfigService systemConfigService;
    private final GroupWorkAssistantMapper mapper;

    public Long resolveResourceId() {
        String name = StringUtils.defaultIfBlank(
            systemConfigService.getDcSystemConfigValueByCode(NAME_CONFIG), DEFAULT_NAME).trim();
        List<Long> candidates = mapper.findCandidates(name);
        if (candidates.size() == 1) {
            return candidates.getFirst();
        }
        if (candidates.size() > 1) {
            log.warn("Multiple group work assistants match the configured platform name; skipping automatic addition");
        }
        return null;
    }
}
