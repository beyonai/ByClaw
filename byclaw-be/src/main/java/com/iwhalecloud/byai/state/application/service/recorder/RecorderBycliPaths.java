package com.iwhalecloud.byai.state.application.service.recorder;

import java.nio.file.Path;

public record RecorderBycliPaths(Path backendPath, Path daemonPath) {
}
