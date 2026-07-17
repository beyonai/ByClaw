package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Publishes verified recorder drafts into the current user's byCLI filesystem.
 *
 * <p>The canonical adapter file owned by the user's byCLI daemon is the source of truth. This
 * service deliberately does not create or update a byclaw resource-table row.</p>
 */
@Service
public class RecorderResourceSaveService {

    private static final Pattern SAFE_SEGMENT = Pattern.compile("[A-Za-z0-9_-]+");

    private final RecorderSaveProperties properties;
    private final RecorderPipelineService pipeline;
    private final RecorderSavePort savePort;

    public RecorderResourceSaveService(
        RecorderSaveProperties properties,
        RecorderPipelineService pipeline,
        RecorderSavePort savePort
    ) {
        this.properties = properties;
        this.pipeline = pipeline;
        this.savePort = savePort;
    }

    public SavedAdapter save(
        RecorderOwner owner,
        RecorderSession session,
        Map<String, Object> draft,
        String requestedSource,
        boolean overwrite
    ) {
        requireEnabled();
        requireOwnerSession(owner, session);
        DraftIdentity identity = requireDraftIdentity(draft);
        String source = pipeline.requireVerifiedSource(draft, requestedSource);
        RecorderSavePort.PublishResult published;
        try {
            published = savePort.publish(
                owner,
                identity.site() + "/" + identity.name(),
                source,
                optionalString(draft, "llmModel"),
                overwrite
            );
        } catch (RecorderSaveException knownFailure) {
            throw knownFailure;
        } catch (RuntimeException unexpected) {
            throw new RecorderSaveException(
                "daemon_unavailable",
                "user byCLI daemon is unavailable",
                unexpected
            );
        }
        return new SavedAdapter(
            identity.draftId(),
            identity.site(),
            identity.name(),
            published.adapterPath(),
            published.reportPath()
        );
    }

    public BatchSaveResult saveMany(
        RecorderOwner owner,
        RecorderSession session,
        List<DraftSaveRequest> requests
    ) {
        requireEnabled();
        requireOwnerSession(owner, session);
        if (requests == null) {
            throw validation("save requests are required");
        }
        List<SavedAdapter> saved = new ArrayList<>();
        List<FailedAdapter> failed = new ArrayList<>();
        for (DraftSaveRequest request : new ArrayList<>(requests)) {
            String draftId = draftId(request == null ? null : request.draft());
            try {
                if (request == null) {
                    throw validation("save request is required");
                }
                saved.add(save(owner, session, request.draft(), request.source(), request.overwrite()));
            } catch (RecorderSaveException e) {
                failed.add(new FailedAdapter(draftId, e.getCode(), safeReason(e), adapterPath(e)));
            } catch (RuntimeException e) {
                failed.add(new FailedAdapter(draftId, "resource_save_failed", "adapter save failed", null));
            }
        }
        return new BatchSaveResult(saved, failed, failed.isEmpty());
    }

    private void requireEnabled() {
        if (!properties.isProductionEnabled()) {
            throw new RecorderSaveException(
                "save_adapter_disabled",
                "production adapter publishing is disabled"
            );
        }
    }

    private static void requireOwnerSession(RecorderOwner owner, RecorderSession session) {
        if (owner == null || owner.userId() == null || owner.userCode() == null || owner.userCode().isBlank()) {
            throw new RecorderSaveException("authentication_required", "authenticated recorder owner is required");
        }
        if (session == null || !owner.sameAs(session.owner())) {
            throw new RecorderSaveException("session_not_found", "recorder session was not found");
        }
    }

    private static DraftIdentity requireDraftIdentity(Map<String, Object> draft) {
        if (draft == null) {
            throw validation("draft is required");
        }
        String draftId = requiredSegment(draft.get("id"), "draftId", 300);
        String site = requiredSegment(draft.get("site"), "site", 300);
        String name = requiredSegment(draft.get("name"), "name", 300);
        Object model = draft.get("llmModel");
        if (model != null && (!(model instanceof String text)
            || text.getBytes(StandardCharsets.UTF_8).length > 256
            || text.chars().anyMatch(Character::isISOControl))) {
            throw validation("llmModel is invalid");
        }
        return new DraftIdentity(draftId, site, name);
    }

    private static String requiredSegment(Object value, String field, int maxLength) {
        if (!(value instanceof String text)
            || text.isBlank()
            || text.length() > maxLength
            || !SAFE_SEGMENT.matcher(text).matches()) {
            throw validation(field + " is invalid");
        }
        return text;
    }

    private static String optionalString(Map<String, Object> draft, String field) {
        Object value = draft.get(field);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private static String draftId(Map<String, Object> draft) {
        if (draft == null || !(draft.get("id") instanceof String value) || value.isBlank()) {
            return null;
        }
        return value;
    }

    private static String safeReason(RecorderSaveException exception) {
        String reason = exception.getMessage();
        return reason == null || reason.isBlank() ? "adapter save failed" : reason;
    }

    private static String adapterPath(RecorderSaveException exception) {
        Object value = exception.getDetails() == null ? null : exception.getDetails().get("adapterPath");
        return value instanceof String path ? path : null;
    }

    private static RecorderSaveException validation(String message) {
        return new RecorderSaveException("validation_failed", message);
    }

    public record SavedAdapter(
        String draftId,
        String site,
        String name,
        String adapterPath,
        String reportPath
    ) {
    }

    public record FailedAdapter(String draftId, String code, String reason, String adapterPath) {
    }

    public record DraftSaveRequest(Map<String, Object> draft, String source, boolean overwrite) {
    }

    public record BatchSaveResult(
        List<SavedAdapter> saved,
        List<FailedAdapter> failed,
        boolean allSucceeded
    ) {
        public BatchSaveResult {
            saved = List.copyOf(saved);
            failed = List.copyOf(failed);
        }
    }

    private record DraftIdentity(String draftId, String site, String name) {
    }
}
