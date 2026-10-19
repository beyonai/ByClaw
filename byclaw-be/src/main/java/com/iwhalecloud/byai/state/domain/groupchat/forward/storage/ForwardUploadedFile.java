package com.iwhalecloud.byai.state.domain.groupchat.forward.storage;

import java.time.Instant;
import java.util.Map;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

/** Upload progress belongs to one target and contains the ordinary upload result, not a storage location. */
public record ForwardUploadedFile(
    @JsonSerialize(using = ToStringSerializer.class) long enterpriseId,
    @JsonSerialize(using = ToStringSerializer.class) long targetSessionId,
    @JsonSerialize(using = ToStringSerializer.class) long forwardTargetId, String itemId,
    String attachmentId, String attemptId, String fileName,
    String contentType, @JsonSerialize(using = com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long size,
    String sha256, @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) Instant createdAt,
    Map<String, Object> uploadedFile) {
    public ForwardUploadedFile {
        uploadedFile = uploadedFile == null ? Map.of() : Map.copyOf(uploadedFile);
    }
    public ForwardUploadedFile(long enterpriseId, long targetSessionId, long forwardTargetId, String itemId,
            String attachmentId, String attemptId, String fileName,
            String contentType, long size, String sha256, Instant createdAt) {
        this(enterpriseId, targetSessionId, forwardTargetId, itemId, attachmentId, attemptId,
            fileName, contentType, size, sha256, createdAt, Map.of());
    }
}
