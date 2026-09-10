package com.iwhalecloud.byai.manager.application.service.ontology;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtScene;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSceneMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.Collections;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OntologyBaseServiceTest {

    private static final long RESOURCE_ID = 20000219L;

    @InjectMocks
    private OntologyBaseService service;

    @Mock
    private FeignDataCloudService feignDataCloudService;

    @Mock
    private SsResourceMapper ssResourceMapper;

    @Mock
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private AuthApplicationService authApplicationService;

    @Mock
    private ResourceAuthApplicationService resourceAuthApplicationService;

    @Mock
    private SsResExtSceneMapper ssResExtSceneMapper;

    @Mock
    private SsResExtViewMapper ssResExtViewMapper;

    @Mock
    private SsResExtObjectMapper ssResExtObjectMapper;

    @Test
    void ensureOntologyChildResourceUpdatesAnExistingSceneExtensionRow() {
        SsResource base = givenSceneCreation();

        SsResExtScene staleExtension = new SsResExtScene();
        staleExtension.setResourceId(RESOURCE_ID);
        staleExtension.setSceneCode("stale-scene");
        staleExtension.setTargetContent("{}");
        lenient().when(ssResExtSceneMapper.selectById(RESOURCE_ID)).thenReturn(staleExtension);
        lenient().when(ssResExtSceneMapper.insert(any(SsResExtScene.class)))
            .thenThrow(new DuplicateKeyException("resource_id already exists"));

        SsResource saved =
            service.ensureOntologyChildResource(base, ResourceBizType.SCENE.getCode(), "scene-1");

        assertThat(saved.getResourceId()).isEqualTo(RESOURCE_ID);
        ArgumentCaptor<SsResExtScene> extensionCaptor = ArgumentCaptor.forClass(SsResExtScene.class);
        verify(ssResExtSceneMapper).updateById(extensionCaptor.capture());
        verify(ssResExtSceneMapper, never()).insert(any(SsResExtScene.class));
        assertThat(extensionCaptor.getValue().getSceneCode()).isEqualTo("scene-1");
        assertThat(extensionCaptor.getValue().getTargetContent())
            .contains("\"sceneId\":\"scene-1\"", "\"ontologyBaseCode\":\"base-1\"");
    }

    @Test
    void ensureOntologyChildResourceInsertsANewSceneExtensionRow() {
        SsResource base = givenSceneCreation();

        SsResource saved =
            service.ensureOntologyChildResource(base, ResourceBizType.SCENE.getCode(), "scene-1");

        assertThat(saved.getResourceId()).isEqualTo(RESOURCE_ID);
        ArgumentCaptor<SsResExtScene> extensionCaptor = ArgumentCaptor.forClass(SsResExtScene.class);
        verify(ssResExtSceneMapper).insert(extensionCaptor.capture());
        verify(ssResExtSceneMapper, never()).updateById(any(SsResExtScene.class));
        assertThat(extensionCaptor.getValue().getSceneCode()).isEqualTo("scene-1");
    }

    private SsResource givenSceneCreation() {
        SsResource base = new SsResource();
        base.setResourceId(100L);
        base.setResourceCode("base-1");
        base.setOwnerType(OwnerType.ENTERPRISE);
        base.setHostType("local");

        JSONObject scene = new JSONObject();
        scene.put("sceneId", "scene-1");
        scene.put("sceneName", "Scene One");
        JSONArray scenes = new JSONArray();
        scenes.add(scene);

        when(ssResourceService.findByCodeAndBizTypeAndOntologyBaseCode(
            "scene-1", ResourceBizType.SCENE.getCode(), "base-1")).thenReturn(Collections.emptyList());
        when(feignDataCloudService.listScenes(OwnerType.ENTERPRISE, "base-1", null)).thenReturn(scenes);
        when(feignDataCloudService.getSceneDetails(OwnerType.ENTERPRISE, "base-1", "scene-1"))
            .thenReturn(new JSONObject());
        when(ssResourceService.createResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(RESOURCE_ID);
            return resource;
        });
        return base;
    }
}
