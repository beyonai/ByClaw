package com.iwhalecloud.byai.gateway.sandbox.model;

import java.util.List;

import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import lombok.Getter;
import lombok.Setter;

/** Management projection that keeps sandbox lifecycle and worker lease state separate. */
@Getter
@Setter
public class SandboxRecordView extends SsSandboxRecord {

    private String workerId;

    /** Null means the registry could not report a value; false means the lease is absent. */
    private Boolean workerOnline;

    /** Worker-registry heartbeat timestamp in epoch milliseconds. */
    private Long workerLastSeen;

    /** Remaining Redis worker lease TTL in seconds. */
    private Long workerLeaseTtlSeconds;

    private List<String> workerAgentTypes;
}
