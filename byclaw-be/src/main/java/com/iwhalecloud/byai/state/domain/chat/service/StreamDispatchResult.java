package com.iwhalecloud.byai.state.domain.chat.service;

/**
 * Redis Stream 事件的处理结果，决定调用方是否 ACK、是否执行终止收尾。
 * <p>
 * {@code name} 仅用于日志可读性；判定逻辑一律基于各布尔字段。
 */
public final class StreamDispatchResult {

    public static final StreamDispatchResult HANDLED =
        new StreamDispatchResult("HANDLED", true, false, null, false, false);
    public static final StreamDispatchResult INTENTIONALLY_IGNORED =
        new StreamDispatchResult("INTENTIONALLY_IGNORED", true, false, null, false, false);
    public static final StreamDispatchResult MISSING_CONTEXT =
        new StreamDispatchResult("MISSING_CONTEXT", false, false, null, true, false);
    public static final StreamDispatchResult ERROR =
        new StreamDispatchResult("ERROR", false, false, null, true, false);

    private final String name;
    private final boolean acknowledge;
    private final boolean terminal;
    private final ChatProcessContext context;
    private final boolean retryable;
    private final boolean alreadyPersisted;

    private StreamDispatchResult(String name, boolean acknowledge, boolean terminal, ChatProcessContext context,
        boolean retryable, boolean alreadyPersisted) {
        this.name = name;
        this.acknowledge = acknowledge;
        this.terminal = terminal;
        this.context = context;
        this.retryable = retryable;
        this.alreadyPersisted = alreadyPersisted;
    }

    /** 终止事件已完成业务处理，等待调用方落库后 ACK。 */
    public static StreamDispatchResult terminalHandled(ChatProcessContext context) {
        return new StreamDispatchResult("TERMINAL_HANDLED", true, true, context, false, false);
    }

    /**
     * 终止事件此前已落库成功（ACK 失败后重投）：仍需 ACK 与收尾，但不得重复落库。
     */
    public static StreamDispatchResult terminalAlreadyPersisted(ChatProcessContext context) {
        return new StreamDispatchResult("TERMINAL_ALREADY_PERSISTED", true, true, context, false, true);
    }

    public boolean shouldAcknowledge() {
        return acknowledge;
    }

    public boolean isTerminal() {
        return terminal;
    }

    public ChatProcessContext getContext() {
        return context;
    }

    public boolean isRetryable() {
        return retryable;
    }

    /** true 表示落库已完成，调用方应跳过持久化直接进入 ACK 与收尾。 */
    public boolean isAlreadyPersisted() {
        return alreadyPersisted;
    }

    @Override
    public String toString() {
        return name;
    }
}
