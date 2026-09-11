package com.iwhalecloud.byai.state.domain.groupchat.domain;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;

/** 群成员稳定 UID 编解码器，仅允许真人与数字员工两类资源。 */
@Component
public class GroupChatMemberUidCodec {
    private static final Pattern UID_PATTERN = Pattern.compile("^(HUMAN|DIG_EMPLOYEE)_([1-9]\\d*)$");

    public String encode(AgentMetaEnum resourceType, Long resourceId) {
        if ((resourceType != AgentMetaEnum.HUMAN && resourceType != AgentMetaEnum.DIG_EMPLOYEE)
            || resourceId == null || resourceId <= 0) {
            throw new IllegalArgumentException("Unsupported group member identity");
        }
        return resourceType.getCode() + "_" + resourceId;
    }

    public Optional<DecodedUid> decode(String uid) {
        if (uid == null) {
            return Optional.empty();
        }
        Matcher matcher = UID_PATTERN.matcher(uid);
        if (!matcher.matches()) {
            return Optional.empty();
        }
        try {
            return Optional.of(new DecodedUid(AgentMetaEnum.valueOf(matcher.group(1)),
                Long.valueOf(matcher.group(2))));
        }
        catch (IllegalArgumentException error) {
            return Optional.empty();
        }
    }

    public record DecodedUid(AgentMetaEnum resourceType, Long resourceId) {
    }
}
