package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderEnvelope;

public record RecorderResponse<T>(int status, RecorderEnvelope<T> body) {
}
