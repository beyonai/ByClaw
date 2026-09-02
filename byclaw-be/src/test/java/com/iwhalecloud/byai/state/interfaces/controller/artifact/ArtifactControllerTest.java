package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactContentUpdateDto;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactPublishMode;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

@ExtendWith(MockitoExtension.class)
class ArtifactControllerTest {

    @Mock
    private ArtifactApplicationService artifactApplicationService;

    @Test
    void replaceContentDelegatesToOwnerContentReplacement() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "site.zip", "application/zip", new byte[] {1, 2, 3});
        ArtifactContentUpdateDto expected = ArtifactContentUpdateDto.builder()
            .ok(true)
            .operation("updated")
            .status("READY")
            .build();
        when(artifactApplicationService.replaceOwnedContent("artifact-id", file, ArtifactPublishMode.SITE,
            "index.html", true, "Updated site", "sha256"))
            .thenReturn(expected);
        ArtifactController controller = new ArtifactController(artifactApplicationService);

        ArtifactContentUpdateDto response = controller.replaceContent("artifact-id", file,
            ArtifactPublishMode.SITE, "index.html", true, "Updated site", "sha256");

        assertThat(response).isSameAs(expected);
        ObjectMapper objectMapper = new ObjectMapper();
        Map<String, Object> payload = objectMapper.readValue(objectMapper.writeValueAsBytes(response),
            new TypeReference<>() { });
        assertThat(payload).containsOnlyKeys("ok", "operation", "status");
        verify(artifactApplicationService).replaceOwnedContent("artifact-id", file, ArtifactPublishMode.SITE,
            "index.html", true, "Updated site", "sha256");
    }
}
