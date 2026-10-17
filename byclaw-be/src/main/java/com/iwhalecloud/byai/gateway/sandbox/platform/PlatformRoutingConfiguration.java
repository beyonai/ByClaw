package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.common.storage.*;
import com.iwhalecloud.byai.gateway.sandbox.command.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.*;

@Configuration
public class PlatformRoutingConfiguration {
    @Bean
    @Primary
    public ObjectStorage platformObjectStorage(
            ObjectStorageRouter legacy,
            PlatformRemoteGateway gateway,
            ObjectProvider<PlatformStorageClient> files,
            com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration configuration) {
        return new PlatformRoutedStorage(
                legacy, gateway, files, () -> configuration.getStorageConfig().getStorageType());
    }

    @Bean
    @Primary
    public SandboxCommandExecutor platformSandboxCommands(
            OpenSandboxCommandExecutor legacy, PlatformRemoteGateway gateway) {
        return PlatformInterfaceRouting.create(
                SandboxCommandExecutor.class, legacy, gateway, false);
    }
}
