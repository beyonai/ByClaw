package com.iwhalecloud.byai.state.domain.groupchat.forward.storage;

import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;

/** A reservation identifies retry progress only; it never reserves a private filesystem path. */
@Component
public class ForwardUploadReservation {
    public ForwardUploadReservation(GroupChatForwardProperties properties) { }
    public ForwardUploadedFile allocate(long tenant, long group, long target, String item, String slot, String name) {
        String attempt = UUID.randomUUID().toString();
        var file = new ForwardUploadedFile(tenant, group, target, item, slot, attempt, name, null, 0, null, Instant.now());
        validate(file);
        return file;
    }
    public void validate(ForwardUploadedFile file) {
        if (file == null || file.enterpriseId() <= 0 || file.targetSessionId() <= 0 || file.forwardTargetId() <= 0
            || !segment(file.itemId()) || !segment(file.attachmentId()) || !segment(file.attemptId())
            || file.fileName() == null || file.fileName().isBlank() || file.fileName().length() > 255
            || file.fileName().equals(".") || file.fileName().equals("..")
            || file.fileName().chars().anyMatch(c -> Character.isISOControl(c) || c == '/' || c == '\\')) {
            throw new IllegalArgumentException("FORWARD_INVALID_UPLOAD");
        }
    }
    private boolean segment(String value) { return value != null && value.matches("[A-Za-z0-9_-]{1,128}"); }
}
