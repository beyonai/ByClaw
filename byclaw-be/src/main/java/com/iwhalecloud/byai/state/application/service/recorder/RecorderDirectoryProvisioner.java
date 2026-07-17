package com.iwhalecloud.byai.state.application.service.recorder;

import java.nio.file.Path;

public interface RecorderDirectoryProvisioner {

    void ensureDirectories(Path fileRoot, Path relativeDirectory);
}
