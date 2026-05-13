package com.iwhalecloud.byai.common.storage.aspect;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.iwhalecloud.byai.common.storage.ByclawResourceFS;
import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.ResourceFS;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationService;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

class ResourceJsonWriteValidationAspectTest {

    @Test
    void write_whenCalledThroughProxy_invokesAspectValidation() {
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        ResourceJsonValidationService validationService = mock(ResourceJsonValidationService.class);
        ByclawResourceFS target = new ByclawResourceFS(objectStorage);

        AspectJProxyFactory proxyFactory = new AspectJProxyFactory(target);
        proxyFactory.addAspect(new ResourceJsonWriteValidationAspect(validationService));
        proxyFactory.setInterfaces(ResourceFS.class);

        ResourceFS proxy = proxyFactory.getProxy();
        MultipartFileUtil file = new MultipartFileUtil("TOOLKIT_1.json", "TOOLKIT_1.json", "application/json",
            "{\"resourceId\":1}".getBytes(StandardCharsets.UTF_8));

        proxy.write(file, "/resource/toolkit/");

        verify(validationService).validateIfResourceJson(eq(file), eq("/resource/toolkit/"));
        verify(objectStorage).put(eq(StorageLocation.of("byclaw-fs", "byclaw", "/resource/toolkit/TOOLKIT_1.json",
            "public")), any(InputStream.class), eq(file.getSize()), eq(file.getContentType()));
    }
}
