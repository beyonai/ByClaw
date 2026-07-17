package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.util.Map;

public interface RecorderBrowserPort {

    Map<String, Object> health();

    Map<String, Object> navigate(RecorderSession session, String url);

    Map<String, Object> captureStart(RecorderSession session, String sampleName);

    Map<String, Object> captureRead(RecorderSession session, String sampleName, String seed);

    Map<String, Object> screenshot(RecorderSession session, Integer quality);

    Map<String, Object> input(RecorderSession session, String cdpMethod, Map<String, Object> cdpParams);
}
