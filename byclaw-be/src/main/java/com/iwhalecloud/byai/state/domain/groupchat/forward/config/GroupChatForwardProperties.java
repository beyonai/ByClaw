package com.iwhalecloud.byai.state.domain.groupchat.forward.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

/** Forwarding limits use long bytes; deployment upload limits remain an additional ceiling. */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "group-chat.forward")
public class GroupChatForwardProperties {
    private int maxMessages = 100;
    private int maxTargets = 10;
    private int maxExpandedItems = 100;
    private int maxAttachmentsPerTarget = 100;
    private long maxSnapshotBytes = 1024L * 1024;
    private long maxFileBytes = 2L * 1024 * 1024 * 1024;
    private long maxTargetBytes = 2L * 1024 * 1024 * 1024;
    private long maxRequestBytes = 10L * 1024 * 1024 * 1024;
    private int parallelFiles = 2;
    private int globalStreams = 4;
    private int recoveryBatchSize = 20;
    private long workerLeaseSeconds = 60;
    private long workerRenewSeconds = 20;
    private long recoveryDelayMillis = 30000;
    @jakarta.annotation.PostConstruct
    public void validateRecovery() {
        if(globalStreams<1||parallelFiles<1||parallelFiles>2||recoveryBatchSize<1||recoveryBatchSize>20
            ||workerLeaseSeconds<1||workerLeaseSeconds>300||workerRenewSeconds<1||workerRenewSeconds>=workerLeaseSeconds
            ||recoveryDelayMillis<1)throw new IllegalArgumentException("FORWARD_INVALID_CONFIGURATION");
    }
    @Value("${spring.servlet.multipart.max-file-size:2GB}")
    private DataSize platformMaxFileSize = DataSize.ofGigabytes(2);

    public long effectiveMaxFileBytes() {
        long platformLimit = platformMaxFileSize.toBytes();
        return Math.min(Math.min(maxFileBytes, 2L * 1024 * 1024 * 1024),
            platformLimit < 0 ? Long.MAX_VALUE : platformLimit);
    }
}
