package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec.DecodedUid;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;

/** 在 Agent 最终正文投影边界解析严格的群成员 Markdown mention。 */
@Component
public class GroupChatAgentMentionParser {
    private static final Pattern MENTION_PATTERN = Pattern.compile("\\[@([^]\\r\\n]+)]\\(uid\\?=([^()\\s]+)\\)");

    private final SessionMemberService memberService;
    private final UserService userService;
    private final SsResourceService resourceService;
    private final GroupChatMemberUidCodec uidCodec;

    public GroupChatAgentMentionParser(SessionMemberService memberService, UserService userService,
        SsResourceService resourceService, GroupChatMemberUidCodec uidCodec) {
        this.memberService = memberService;
        this.userService = userService;
        this.resourceService = resourceService;
        this.uidCodec = uidCodec;
    }

    public GroupChatAgentMention parse(Long groupSessionId, Long currentAgentId, String content) {
        if (content == null || content.isEmpty()) {
            return new GroupChatAgentMention(content, List.of());
        }
        Map<String, ByaiSessionMember> members = memberIndex(groupSessionId);
        Map<String, ResourceVo> resources = new LinkedHashMap<>();
        Matcher matcher = MENTION_PATTERN.matcher(content);
        StringBuffer normalized = new StringBuffer();
        while (matcher.find()) {
            String uid = matcher.group(2);
            DecodedUid decoded = uidCodec.decode(uid).orElse(null);
            ByaiSessionMember member = decoded == null ? null : members.get(uid);
            if (member == null || isSelfMention(decoded, currentAgentId)) {
                matcher.appendReplacement(normalized, Matcher.quoteReplacement(matcher.group()));
                continue;
            }
            ResourceVo resource = resources.computeIfAbsent(uid, ignored -> buildResource(uid, decoded));
            if (resource == null) {
                resources.remove(uid);
                matcher.appendReplacement(normalized, Matcher.quoteReplacement(matcher.group()));
                continue;
            }
            matcher.appendReplacement(normalized, Matcher.quoteReplacement("{{" + uid + "}}"));
        }
        matcher.appendTail(normalized);
        return new GroupChatAgentMention(normalized.toString(), new ArrayList<>(resources.values()));
    }

    private Map<String, ByaiSessionMember> memberIndex(Long groupSessionId) {
        Map<String, ByaiSessionMember> index = new LinkedHashMap<>();
        List<ByaiSessionMember> members = memberService.findSessionMembers(groupSessionId, null, null);
        if (members == null) {
            return index;
        }
        for (ByaiSessionMember member : members) {
            if (member == null) {
                continue;
            }
            AgentMetaEnum type = resourceType(member.getMemObjType());
            if (type != null && member.getMemObjId() != null && member.getMemObjId() > 0) {
                index.put(uidCodec.encode(type, member.getMemObjId()), member);
            }
        }
        return index;
    }

    private ResourceVo buildResource(String uid, DecodedUid decoded) {
        String name;
        if (decoded.resourceType() == AgentMetaEnum.HUMAN) {
            Users user = userService.findById(decoded.resourceId());
            name = user == null ? null : user.getUserName();
        }
        else {
            SsResource resource = resourceService.findById(decoded.resourceId());
            name = resource == null ? null : resource.getResourceName();
        }
        if (name == null || name.isBlank()) {
            return null;
        }
        ResourceVo resource = new ResourceVo();
        resource.setId(uid);
        resource.setResourceId(String.valueOf(decoded.resourceId()));
        resource.setResourceName(name);
        resource.setResourceType(decoded.resourceType());
        return resource;
    }

    private boolean isSelfMention(DecodedUid decoded, Long currentAgentId) {
        return decoded != null && decoded.resourceType() == AgentMetaEnum.DIG_EMPLOYEE
            && decoded.resourceId().equals(currentAgentId);
    }

    private AgentMetaEnum resourceType(String memberType) {
        if (MemObjType.USER.name().equals(memberType)) {
            return AgentMetaEnum.HUMAN;
        }
        if (MemObjType.AGENT.name().equals(memberType)) {
            return AgentMetaEnum.DIG_EMPLOYEE;
        }
        return null;
    }
}
