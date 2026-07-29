package com.iwhalecloud.byai.state.domain.langfuse.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.domain.session.service.ByaiSessionService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Authorization helper for the /langfuse/* endpoints.
 *
 * <p>Enforces two rules on every entry point:
 * <ol>
 *   <li>The caller must have a {@code LoginInfo} populated by an upstream filter
 *       (i.e. the request passed through the standard auth filters).</li>
 *   <li>For session-scoped or BE-generated trace ids, the underlying resource
 *       must be owned by the caller (or the caller must be a platform manager).</li>
 * </ol>
 *
 * <p>Trace ids that are not BE-generated (e.g. raw Langfuse hex ids from outside
 * our pipeline) cannot be tied back to a local message and therefore fall back
 * to "login required" only.
 */
@Slf4j
@Service
public class LangfuseAuthorizationService {

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private ByaiSessionService byaiSessionService;

    /**
     * Require that the request is associated with a logged-in user.
     *
     * @throws BdpRuntimeException if no login info is on the current thread.
     */
    public void requireLogin() {
        if (CurrentUserHolder.getLoginInfo() == null) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.login.required"));
        }
    }

    /**
     * Verify that the current user owns the given session, or is a platform manager.
     *
     * @param sessionId session id from the URL path
     * @throws BdpRuntimeException if the session does not exist or is not owned by the caller.
     */
    public void verifySessionOwner(String sessionId) {
        requireLogin();
        if (StringUtils.isBlank(sessionId)) {
            throw new BdpRuntimeException("langfuse.session.id.not.empty");
        }
        Long parsedSessionId;
        try {
            parsedSessionId = Long.parseLong(sessionId);
        }
        catch (NumberFormatException e) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.id.invalid"));
        }
        if (CurrentUserHolder.isPlatformManager() || CurrentUserHolder.isPlatformAdminOrOperator()) {
            return;
        }
        ByaiSession session = byaiSessionService.findById(parsedSessionId);
        if (session == null) {
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.not.found"));
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (session.getCreatorId() == null || !session.getCreatorId().equals(currentUserId)) {
            log.warn("Session ownership check failed: sessionId={}, callerUserId={}", sessionId, currentUserId);
            throw new BdpRuntimeException(I18nUtil.get("langfuse.session.access.denied"));
        }
    }

    /**
     * Verify that the current user owns the messages encoded into the given trace id.
     *
     * <p>If the trace id is not BE-generated (i.e. {@link TraceIdCodec#canDecode(String)}
     * returns {@code false}), only {@link #requireLogin()} is enforced.
     *
     * @param traceId trace id from the URL path
     * @throws BdpRuntimeException if the trace id is invalid, not owned by the caller, or the caller is not logged in.
     */
    public void verifyTraceOwner(String traceId) {
        requireLogin();
        if (StringUtils.isBlank(traceId)) {
            throw new BdpRuntimeException("langfuse.trace.id.not.empty");
        }
        if (!TraceIdCodec.canDecode(traceId)) {
            // Not a BE-generated trace id — cannot tie back to a local message.
            // Login is sufficient; treat as an external Langfuse reference.
            return;
        }
        if (CurrentUserHolder.isPlatformManager() || CurrentUserHolder.isPlatformAdminOrOperator()) {
            return;
        }
        TraceIdCodec.TraceMessageIds messageIds = TraceIdCodec.decode(traceId);
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (messageIds.getUserMessageId() != null) {
            ByaiMessage ask = byaiMessageHotService.find(messageIds.getUserMessageId());
            if (ask == null || ask.getCreatorId() == null || !ask.getCreatorId().equals(currentUserId)) {
                log.warn("Trace ownership check failed on ask msg: traceId={}, callerUserId={}", traceId, currentUserId);
                throw new BdpRuntimeException(I18nUtil.get("langfuse.trace.access.denied"));
            }
        }
        if (messageIds.getModelAnswerMessageId() != null) {
            ByaiMessage answer = byaiMessageHotService.find(messageIds.getModelAnswerMessageId());
            if (answer == null || answer.getCreatorId() == null || !answer.getCreatorId().equals(currentUserId)) {
                log.warn("Trace ownership check failed on answer msg: traceId={}, callerUserId={}", traceId,
                    currentUserId);
                throw new BdpRuntimeException(I18nUtil.get("langfuse.trace.access.denied"));
            }
        }
    }
}
