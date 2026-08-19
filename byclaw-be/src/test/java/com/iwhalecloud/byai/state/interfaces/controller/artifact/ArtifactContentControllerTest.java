package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService.ArtifactContent;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

class ArtifactContentControllerTest {

    @Test
    void servesSingleByteRangeWithPreviewSecurityHeaders() throws Exception {
        ArtifactApplicationService service = mock(ArtifactApplicationService.class);
        ArtifactContent content = content("video.mp4", 10L);
        when(service.resolvePreview("artifact", "key", null)).thenReturn(content);
        when(service.open(content, 2L, 4L))
            .thenReturn(new ByteArrayInputStream("2345".getBytes(StandardCharsets.UTF_8)));
        ArtifactContentController controller = new ArtifactContentController(service);
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/artifact-preview/artifact/key");
        request.addHeader(HttpHeaders.RANGE, "bytes=2-5");

        ResponseEntity<StreamingResponseBody> response = controller.preview("artifact", "key", null, request);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        response.getBody().writeTo(output);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PARTIAL_CONTENT);
        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_RANGE)).isEqualTo("bytes 2-5/10");
        assertThat(response.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(output.toString(StandardCharsets.UTF_8)).isEqualTo("2345");
    }

    @Test
    void rejectsMultipleRangesWithoutOpeningStorage() {
        ArtifactApplicationService service = mock(ArtifactApplicationService.class);
        ArtifactContent content = content("video.mp4", 10L);
        when(service.resolvePreview("artifact", "key", null)).thenReturn(content);
        ArtifactContentController controller = new ArtifactContentController(service);
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/artifact-preview/artifact/key");
        request.addHeader(HttpHeaders.RANGE, "bytes=0-1,4-5");

        ResponseEntity<StreamingResponseBody> response = controller.preview("artifact", "key", null, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_RANGE)).isEqualTo("bytes */10");
    }

    @Test
    void downloadAlwaysUsesAttachmentDisposition() {
        ArtifactApplicationService service = mock(ArtifactApplicationService.class);
        ArtifactContent content = content("index.html", 4L);
        when(service.resolveDownload("artifact", "key")).thenReturn(content);
        ArtifactContentController controller = new ArtifactContentController(service);
        MockHttpServletRequest request = new MockHttpServletRequest("HEAD",
            "/artifact-download/artifact/key");

        ResponseEntity<StreamingResponseBody> response = controller.download("artifact", "key", request);

        assertThat(response.getHeaders().getContentDisposition().getType()).isEqualTo("attachment");
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("text/html");
    }

    @Test
    void honorsMatchingEntityTagWithoutOpeningStorage() {
        ArtifactApplicationService service = mock(ArtifactApplicationService.class);
        ArtifactContent content = content("app.js", 4L);
        when(service.resolvePreview("artifact", "key", null)).thenReturn(content);
        ArtifactContentController controller = new ArtifactContentController(service);
        MockHttpServletRequest firstRequest = new MockHttpServletRequest("HEAD",
            "/artifact-preview/artifact/key");
        String etag = controller.preview("artifact", "key", null, firstRequest).getHeaders().getETag();
        MockHttpServletRequest conditionalRequest = new MockHttpServletRequest("GET",
            "/artifact-preview/artifact/key");
        conditionalRequest.addHeader(HttpHeaders.IF_NONE_MATCH, etag);

        ResponseEntity<StreamingResponseBody> response = controller.preview(
            "artifact", "key", null, conditionalRequest);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        assertThat(response.getBody()).isNull();
    }

    private ArtifactContent content(String fileName, long size) {
        ArtifactRecord record = new ArtifactRecord();
        record.setArtifactId("artifact");
        record.setFileSize(size);
        FileMetadata metadata = new FileMetadata();
        metadata.setFileSize(size);
        return new ArtifactContent(record, "content/" + fileName, fileName, metadata);
    }
}
