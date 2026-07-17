package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;

public interface RecorderSavePort {

    PublishResult publish(RecorderOwner owner, String name, String source, String llmModel, boolean overwrite);

    record PublishResult(String adapterPath, String reportPath) {
    }
}
