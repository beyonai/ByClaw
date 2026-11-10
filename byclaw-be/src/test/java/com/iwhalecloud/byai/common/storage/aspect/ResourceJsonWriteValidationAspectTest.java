package com.iwhalecloud.byai.common.storage.aspect;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.storage.ByclawResourceFS;
import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.ResourceFS;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationService;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationMessages;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonPathParser;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonContentExtractor;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidatorRouter;
import com.iwhalecloud.byai.common.storage.validation.validator.DocResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.validator.DefaultResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.i18n.I18nTestScope;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import com.iwhalecloud.byai.state.domain.resource.service.DefaultResourceJsonConnectivityValidationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceCurlService;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

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

    @ParameterizedTest
    @CsvSource({"true, true", "false, false", "true, false", "false, true"})
    void writeKnowledge_usesRealValidationBeforeWritingResourceJson(boolean create, boolean delete) {
        try (var messagesScope = new I18nTestScope(Locale.US)) {
            ObjectStorage objectStorage = mock(ObjectStorage.class);
            ResourceCurlService curl = mock(ResourceCurlService.class);
            var connectivity = new DefaultResourceJsonConnectivityValidationService(curl, mock(SsResExtMcpService.class));
            ReflectionTestUtils.setField(connectivity, "enabled", true);
            ReflectionTestUtils.setField(connectivity, "failFast", true);
            ResourceJsonValidationMessages messages = new ResourceJsonValidationMessages(new StaticMessageSource());
            var validation = new ResourceJsonValidationService(new ResourceJsonPathParser(),
                new ResourceJsonContentExtractor(messages),
                new ResourceJsonValidatorRouter(List.of(new DocResourceJsonTypeValidator(connectivity)),
                    new DefaultResourceJsonTypeValidator()), new ObjectMapper(), messages);
            AspectJProxyFactory factory = new AspectJProxyFactory(new ByclawResourceFS(objectStorage));
            factory.addAspect(new ResourceJsonWriteValidationAspect(validation));
            factory.setInterfaces(ResourceFS.class);
            ResourceFS proxy = factory.getProxy();

            JSONObject root = JSONObject.parseObject("""
                {"systemCode":"WHALE","resourceBizType":"KG_DOC","domainURL":"http://example.com",
                 "resourceService":[{"openapiSchema":{"paths":{"/search":{"post":{"operationId":"search"}}}}}]}
                """);
            JSONObject paths = root.getJSONArray("resourceService").getJSONObject(0).getJSONObject("openapiSchema")
                .getJSONObject("paths");
            if (create) paths.put("/create_kb", JSONObject.parseObject("{\"post\":{\"operationId\":\"create_kb\"}}"));
            if (delete) paths.put("/delete_kb", JSONObject.parseObject("{\"post\":{\"operationId\":\"delete_kb\"}}"));
            String json = root.toJSONString();
            MultipartFileUtil file = new MultipartFileUtil("KG_DOC_1.json", "KG_DOC_1.json", "application/json",
                json.getBytes(StandardCharsets.UTF_8));
            ResourceCurlRunResult success = new ResourceCurlRunResult();
            success.setSuccess(true);
            when(curl.runOpenApiOperation(eq("KG_DOC"), eq(json), any(JSONObject.class), any(String.class),
                org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(),
                org.mockito.ArgumentMatchers.anyMap())).thenReturn(success);

            if (create != delete) {
                assertThatThrownBy(() -> proxy.write(file, "/resource/doc/"))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining(create ? "delete_kb" : "create_kb");
                verifyNoInteractions(objectStorage, curl);
            }
            else {
                proxy.write(file, "/resource/doc/");
                var order = org.mockito.Mockito.inOrder(curl, objectStorage);
                if (create) {
                    for (String operation : List.of("create_kb", "delete_kb")) {
                        order.verify(curl).runOpenApiOperation(eq("KG_DOC"), eq(json), any(JSONObject.class), eq(operation),
                            org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(),
                            org.mockito.ArgumentMatchers.anyMap());
                    }
                }
                else verifyNoInteractions(curl);
                order.verify(objectStorage).put(eq(StorageLocation.of("byclaw-fs", "byclaw", "/resource/doc/KG_DOC_1.json",
                    "public")), any(InputStream.class), eq(file.getSize()), eq(file.getContentType()));
            }
        }
    }
}
