package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

enum ConnectionState {
    LEASE_WAIT,
    STARTING,
    RUNNING,
    RETRY_WAIT,
    STOPPING,
    STOP_FAILED,
    STOPPED
}
