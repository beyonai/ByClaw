package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** 租户群昵称由 Node 解析，平台用户名由 BE 在返回消息前补齐。 */
@Service
public class TenantGroupMessageDisplayService {
    private final UserService users;

    public TenantGroupMessageDisplayService(UserService users) {
        this.users = users;
    }

    public Object resolve(Object response) {
        List<MissingName> missing = new ArrayList<>();
        Object result = copyMessages(response, missing);
        List<Long> ids = missing.stream().map(MissingName::userId).filter(java.util.Objects::nonNull).distinct().toList();
        Map<Long, String> names = new HashMap<>();
        if (!ids.isEmpty()) {
            users.findByIds(ids).stream()
                .filter(user -> user.getUserId() != null && StringUtils.isNotBlank(user.getUserName()))
                .forEach(user -> names.put(user.getUserId(), user.getUserName()));
        }
        missing.forEach(item -> {
            String name = names.get(item.userId());
            item.speaker().put("displayName", name == null ? I18nUtil.get("groupchat.memberFallback") : name);
        });
        return result;
    }

    /** 仅沿公开消息字段遍历；forward、metadata 和系统事件中的原始姓名快照不能被重写。 */
    private Object copyMessages(Object value, List<MissingName> missing) {
        if (value instanceof List<?> list) return list.stream().map(item -> copyMessages(item, missing)).toList();
        if (!(value instanceof Map<?, ?> source)) return value;
        Map<String, Object> result = copy(source);
        if (source.get("speaker") instanceof Map<?, ?> speaker && "user".equals(speaker.get("type"))
            && (!(speaker.get("displayName") instanceof String name) || name.isBlank())) {
            Map<String, Object> display = copy(speaker);
            result.put("speaker", display);
            missing.add(new MissingName(userId(source.get("creatorId")), display));
        }
        for (String key : List.of("messages", "items", "rootMessage", "lastMessage", "replyTo")) {
            if (source.containsKey(key)) result.put(key, copyMessages(source.get(key), missing));
        }
        return result;
    }

    private Map<String, Object> copy(Map<?, ?> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> result.put(key.toString(), value));
        return result;
    }

    /** Node 的 bigint 身份保持十进制字符串，不经浮点数转换。 */
    private Long userId(Object value) {
        if (value instanceof Long id) return id > 0 ? id : null;
        if (!(value instanceof String id) || !id.matches("[1-9][0-9]{0,18}")) return null;
        try {
            return Long.parseLong(id);
        }
        catch (NumberFormatException ignored) {
            return null;
        }
    }

    private record MissingName(Long userId, Map<String, Object> speaker) { }
}
