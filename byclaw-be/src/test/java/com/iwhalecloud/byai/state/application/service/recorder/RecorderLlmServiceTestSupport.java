package com.iwhalecloud.byai.state.application.service.recorder;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public final class RecorderLlmServiceTestSupport {

    private RecorderLlmServiceTestSupport() {
    }

    public static RecorderLlmService unavailable() {
        RecorderLlmService service = mock(RecorderLlmService.class);
        when(service.availability()).thenReturn(
            new RecorderLlmService.Availability(false, null, "default_model_list_lookup_failed")
        );
        return service;
    }
}
