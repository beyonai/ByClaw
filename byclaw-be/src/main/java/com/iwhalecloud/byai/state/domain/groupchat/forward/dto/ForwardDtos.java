package com.iwhalecloud.byai.state.domain.groupchat.forward.dto;

import java.util.List;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;

/** Public forwarding transport fields; authoritative content is never accepted from clients. */
public final class ForwardDtos {
    private ForwardDtos() { }
    public record CreateRequest(String clientRequestId, ForwardMode mode, List<String> messageIds, List<String> targetSessionIds) {
        public CreateRequest { messageIds = List.copyOf(messageIds); targetSessionIds = List.copyOf(targetSessionIds); }
    }
    public record RetryRequest(List<String> targetSessionIds) { public RetryRequest { targetSessionIds = List.copyOf(targetSessionIds); } }
    public record TargetItem(String sessionId, String name, String enterpriseId, String projectId, String role) { }
    public record TargetStatus(String targetSessionId, ForwardState status, List<String> messageIds, String errorCode, boolean retryable) {
        public TargetStatus { messageIds = List.copyOf(messageIds); }
    }
    public record OperationResponse(String forwardRequestId, ForwardOperationState state, List<TargetStatus> targets) {
        public OperationResponse { targets = List.copyOf(targets); }
    }
    public static OperationResponse operation(ForwardOperation value) {
        return new OperationResponse(Long.toString(value.requestId()), value.state(), value.targets().stream()
            .map(t -> new TargetStatus(Long.toString(t.targetSessionId()), t.state(), t.messageIds(), t.errorCode(), t.retryable())).toList());
    }
    public record ItemPage(List<ForwardItem> items, int pageSize, boolean hasMore, String nextCursor) {
        public ItemPage { items = List.copyOf(items); }
    }
}
