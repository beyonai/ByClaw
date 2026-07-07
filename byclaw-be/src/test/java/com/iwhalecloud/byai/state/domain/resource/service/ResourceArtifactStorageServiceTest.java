package com.iwhalecloud.byai.state.domain.resource.service;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.ResourceFS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ResourceArtifactStorageServiceTest {

    @Mock
    private ResourceFS resourceFS;

    @Mock
    private ResourceArtifactPathResolver pathResolver;

    @Test
    void uploadToSubdirectory_writesToResourceFsDirectory() {
        ResourceArtifactStorageService service = service();
        when(pathResolver.normalizeRelativePath("toolkit")).thenReturn("toolkit");

        service.uploadToSubdirectory("{}".getBytes(StandardCharsets.UTF_8), "toolkit", "TOOL_1.json",
            "application/json");

        verify(resourceFS).write(any(MultipartFile.class), eq("/resource/toolkit/"));
    }

    @Test
    void existsResourceJsonByBizType_returnsExactMatchFromResourceFs() {
        ResourceArtifactStorageService service = service();
        when(pathResolver.resolveResourceDirectory("toolkit")).thenReturn("toolkit");
        when(pathResolver.buildResourceJsonFileName("toolkit", 1L)).thenReturn("TOOLKIT_1.json");
        when(pathResolver.normalizeRelativePath("toolkit/TOOLKIT_1.json")).thenReturn("toolkit/TOOLKIT_1.json");
        when(resourceFS.list("/resource/toolkit/TOOLKIT_1.json", null)).thenReturn(List.of("/resource/toolkit/TOOLKIT_1.json"));

        boolean exists = service.existsResourceJsonByBizType("toolkit", 1L);

        assertThat(exists).isTrue();
    }

    @Test
    void deleteWithinResourceRoot_deletesExactFile() {
        ResourceArtifactStorageService service = service();
        when(pathResolver.normalizeRelativePath("toolkit/TOOL_1.json")).thenReturn("toolkit/TOOL_1.json");
        when(resourceFS.list("/resource/toolkit/TOOL_1.json", null)).thenReturn(List.of("/resource/toolkit/TOOL_1.json"));

        service.deleteWithinResourceRoot("toolkit/TOOL_1.json");

        verify(resourceFS).delete("/resource/toolkit/TOOL_1.json");
        verify(resourceFS, never()).delete("/resource/toolkit/TOOL_1.json/");
    }

    @Test
    void renameWithinResourceRoot_renamesExactFile() {
        ResourceArtifactStorageService service = service();
        when(pathResolver.normalizeRelativePath("toolkit/old.json")).thenReturn("toolkit/old.json");
        when(pathResolver.normalizeRelativePath("toolkit/new.json")).thenReturn("toolkit/new.json");
        when(resourceFS.list("/resource/toolkit/old.json", null)).thenReturn(List.of("/resource/toolkit/old.json"));
        when(resourceFS.read("/resource/toolkit/old.json")).thenReturn(
            new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8)));

        service.renameWithinResourceRoot("toolkit/old.json", "toolkit/new.json");

        verify(resourceFS).write(any(MultipartFile.class), eq("/resource/toolkit/new.json"));
        verify(resourceFS).delete("/resource/toolkit/old.json");
    }

    @Test
    void renameWithinResourceRoot_renamesDirectoryPrefix() {
        ResourceArtifactStorageService service = service();
        when(pathResolver.normalizeRelativePath("toolkit/old")).thenReturn("toolkit/old");
        when(pathResolver.normalizeRelativePath("toolkit/new")).thenReturn("toolkit/new");
        when(resourceFS.list("/resource/toolkit/old", null)).thenReturn(List.of());
        when(resourceFS.list("/resource/toolkit/old/", null)).thenReturn(List.of(
            "/resource/toolkit/old/a.json",
            "/resource/toolkit/old/sub/b.json"));
        when(resourceFS.read(anyString())).thenReturn(new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8)));

        service.renameWithinResourceRoot("toolkit/old", "toolkit/new");

        verify(resourceFS).write(any(MultipartFile.class), eq("/resource/toolkit/new/a.json"));
        verify(resourceFS).write(any(MultipartFile.class), eq("/resource/toolkit/new/sub/b.json"));
        verify(resourceFS).delete("/resource/toolkit/old/");
    }

    @Test
    void uploadDirectoryToSubdirectory_rejectsMissingDirectory() {
        ResourceArtifactStorageService service = service();

        Path localRoot = Path.of("/private/tmp/not-exist-" + System.nanoTime());

        assertThatCode(() -> service.uploadDirectoryToSubdirectory(localRoot, "toolkit"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void syncResourceJsonByBizType_writesJsonByResourceFs() {
        ResourceArtifactStorageService service = service();
        when(pathResolver.resolveResourceDirectory("toolkit")).thenReturn("toolkit");
        when(pathResolver.buildResourceJsonFileName("toolkit", 1L)).thenReturn("TOOLKIT_1.json");
        when(pathResolver.normalizeRelativePath("toolkit")).thenReturn("toolkit");

        service.syncResourceJsonByBizType("{}", "toolkit", 1L);

        verify(resourceFS).write(any(MultipartFile.class), eq("/resource/toolkit/"));
    }

    private ResourceArtifactStorageService service() {
        ResourceArtifactStorageService service = new ResourceArtifactStorageService();
        ReflectionTestUtils.setField(service, "resourceFS", resourceFS);
        ReflectionTestUtils.setField(service, "resourceArtifactPathResolver", pathResolver);
        return service;
    }
}
