package com.iwhalecloud.byai.state.interfaces.controller.filepreview;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.iwhalecloud.byai.state.application.service.filepreview.FilePreviewApplicationService;

class FilePreviewControllerTest {

    @Test
    void acceptsMultipartAndReturnsAnUncachedPdfCopy() throws Exception {
        FilePreviewApplicationService service = mock(FilePreviewApplicationService.class);
        MockMultipartFile file = new MockMultipartFile("file", "slides.ppt", "application/vnd.ms-powerpoint", new byte[]{1});
        byte[] pdf = "%PDF-1.4".getBytes(StandardCharsets.US_ASCII);
        when(service.convert(file)).thenReturn(pdf);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new FilePreviewController(service)).build();

        mvc.perform(multipart("/file-preview/legacy-office").file(file))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_PDF))
            .andExpect(content().bytes(pdf))
            .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"preview.pdf\""))
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }
}
