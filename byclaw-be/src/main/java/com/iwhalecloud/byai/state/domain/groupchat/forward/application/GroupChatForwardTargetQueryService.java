package com.iwhalecloud.byai.state.domain.groupchat.forward.application;

import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupChatForwardQueryMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardEligibility;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardEligibility.GroupIdentity;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.TargetItem;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** Read lightweight forwarding candidates after source authorization. */
@Service
public class GroupChatForwardTargetQueryService {
    private final SessionService sessions;
    private final GroupChatAuthorizationService authorization;
    private final GroupChatForwardQueryMapper mapper;

    public GroupChatForwardTargetQueryService(SessionService sessions, GroupChatAuthorizationService authorization,
        GroupChatForwardQueryMapper mapper) {
        this.sessions = sessions;
        this.authorization = authorization;
        this.mapper = mapper;
    }

    public PageInfo<TargetItem> listTargets(ForwardActor actor, long sourceId) {
        return listTargets(actor, sourceId, 1, 20, null);
    }

    public PageInfo<TargetItem> listTargets(ForwardActor actor, long sourceId, int page, int size, String keyword) {
        String normalized = keyword == null ? "" : keyword.trim();
        if (sourceId <= 0 || page < 1 || size < 1 || size > 100 || normalized.length() > 100) {
            throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        }
        // Membership must be established before reporting a missing source tenant.
        var member = authorization.requireUserMember(sourceId, actor.userId());
        var source = sessions.findById(sourceId);
        GroupIdentity identity = source == null ? null : new GroupIdentity(source.getSessionId(),
            source.getEnterpriseId(), source.getSessionType(), source.getState());
        boolean isUserMember = member != null && "USER".equals(member.getMemObjType())
            && Long.valueOf(actor.userId()).equals(member.getMemObjId());
        var result = new PageInfo<TargetItem>();
        result.setPageNum(page);
        result.setPageSize(size);
        result.setList(List.of());
        // 源群不在当前企业筛选范围时返回空页，不扩大候选群的租户范围。
        if (isUserMember && identity != null && identity.enterpriseId() != null
            && identity.enterpriseId() != actor.enterpriseId()) {
            return result;
        }
        ForwardEligibility.requireSource(actor, identity, isUserMember);

        // Escape the literal substring before binding; list and count share exactly the same predicate.
        String pattern = normalized.isEmpty() ? null : "%" + normalized.toLowerCase(Locale.ROOT)
            .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        result.setTotal(mapper.countTargets(actor.userId(), actor.enterpriseId(), sourceId, pattern));
        result.setTotalPages((int) ((result.getTotal() + size - 1) / size));
        result.setList(mapper.selectTargets(actor.userId(), actor.enterpriseId(), sourceId, pattern, size, (long) (page - 1) * size));
        return result;
    }
}
