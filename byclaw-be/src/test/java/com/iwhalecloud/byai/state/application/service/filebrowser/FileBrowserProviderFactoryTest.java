package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FileBrowserProviderFactoryTest {
    @Test void remoteFileBrowserUsesGenericStorageEvenWithLegacyOpenClawSetting() {
        check(true,"OPENCLAW",true);
    }
    @Test void remoteCommercialEditionAlsoUsesGenericStorage() {
        check(true,null,true);
    }
    @Test void legacyExplicitOpenClawIsPreserved() {
        check(false,"OPENCLAW",false);
    }
    @Test void legacyExplicitGenericStorageIsPreserved() {
        check(false,"MINIO",true);
    }
    @Test void remoteObjectStoreKeepsLegacyBrowserSelection() {
        check(true,"OPENCLAW",false,"oss");
    }
    private void check(boolean remote,String configured,boolean generic) {
        check(remote,configured,generic,"file");
    }
    private void check(boolean remote,String configured,boolean generic,String storageType) {
        PlatformRemoteGateway gateway=mock(PlatformRemoteGateway.class);
        when(gateway.isRemote()).thenReturn(remote);
        ByaiSystemConfigService config=mock(ByaiSystemConfigService.class);
        when(config.getDcSystemConfigValueByCode("FILE_BROWSER_TYPE")).thenReturn(configured);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        MinioFileBrowserProvider storage=mock(MinioFileBrowserProvider.class);
        OpenClawFileBrowserProvider openclaw=mock(OpenClawFileBrowserProvider.class);
        try(AnnotationConfigApplicationContext context=new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource(
                "test",java.util.Map.of("file.storage.type",storageType)));
            context.getBeanFactory().registerSingleton("gateway",gateway);
            context.getBeanFactory().registerSingleton("config",config);
            context.getBeanFactory().registerSingleton("storage",storage);
            context.getBeanFactory().registerSingleton("openclaw",openclaw);
            context.register(FileBrowserProviderFactory.class);context.refresh();
            assertSame(generic?storage:openclaw,context.getBean(FileBrowserProviderFactory.class).getProvider());
        }
    }
}
