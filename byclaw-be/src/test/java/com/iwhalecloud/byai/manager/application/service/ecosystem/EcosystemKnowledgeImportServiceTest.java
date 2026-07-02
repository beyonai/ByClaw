package com.iwhalecloud.byai.manager.application.service.ecosystem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

@ExtendWith(MockitoExtension.class)
class EcosystemKnowledgeImportServiceTest {

    @Mock
    private DatasetApplicationService datasetApplicationService;

    private EcosystemKnowledgeImportService service;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("ecosystem.import.directory", Locale.SIMPLIFIED_CHINESE, "生态采集/{0}/{1}");
        messageSource.addMessage("ecosystem.import.upload.remark", Locale.SIMPLIFIED_CHINESE, "生态采集导入：{0}");
        messageSource.addMessage("ecosystem.import.success.message", Locale.SIMPLIFIED_CHINESE, "已导入知识库并触发索引构建：{0}");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        service = new EcosystemKnowledgeImportService();
        ReflectionTestUtils.setField(service, "datasetApplicationService", datasetApplicationService);
    }

    @Test
    void importMarkdownUsesTimestampDirectoryWhenTaskIdMissing() throws Exception {
        ArgumentCaptor<String> directoryCaptor = ArgumentCaptor.forClass(String.class);
        when(datasetApplicationService.uploadFiles(any(MultipartFile[].class), eq(90001L),
            directoryCaptor.capture(), anyString())).thenAnswer(invocation ->
                uploadResult(invocation.getArgument(2, String.class) + "/article.md"));
        ArgumentCaptor<DatasetBuild> buildCaptor = ArgumentCaptor.forClass(DatasetBuild.class);
        EcosystemTaskVo task = new EcosystemTaskVo();
        task.setTaskName("生态采集-知乎");
        task.setSourceName("知乎");
        task.setImportTarget("knowledgeBase");

        EcosystemKnowledgeImportService.ImportResult result = service.importMarkdown(task,
            Map.of("knowledgeBaseResourceId", 90001L),
            List.of(new EcosystemArtifactStorageService.MarkdownImportFile("article.md",
                "# ok".getBytes(StandardCharsets.UTF_8))));

        assertThat(directoryCaptor.getValue()).matches("/生态采集/知乎/\\d{13}");
        assertThat(directoryCaptor.getValue()).doesNotContain("null");
        assertThat(result.getDirectoryPath()).isEqualTo(directoryCaptor.getValue());
        verify(datasetApplicationService).build(buildCaptor.capture());
        assertThat(buildCaptor.getValue().getDirectoryPath()).isEqualTo(directoryCaptor.getValue() + "/article.md");
    }

    @Test
    void importMarkdownKeepsLargeTaskIdDirectoryWithoutNumberGrouping() throws Exception {
        ArgumentCaptor<String> directoryCaptor = ArgumentCaptor.forClass(String.class);
        when(datasetApplicationService.uploadFiles(any(MultipartFile[].class), eq(90001L),
            directoryCaptor.capture(), anyString())).thenAnswer(invocation ->
                uploadResult(invocation.getArgument(2, String.class) + "/article.md"));
        EcosystemTaskVo task = new EcosystemTaskVo();
        task.setTaskId(1234567890123L);
        task.setTaskName("生态采集-知乎");
        task.setSourceName("知乎");
        task.setImportTarget("knowledgeBase");

        service.importMarkdown(task, Map.of("knowledgeBaseResourceId", 90001L),
            List.of(new EcosystemArtifactStorageService.MarkdownImportFile("article.md",
                "# ok".getBytes(StandardCharsets.UTF_8))));

        assertThat(directoryCaptor.getValue()).isEqualTo("/生态采集/知乎/1234567890123");
    }

    private UploadResult uploadResult(String filePath) {
        UploadResult uploadResult = new UploadResult();
        uploadResult.setResourceName("测试知识库");
        UploadItem uploadItem = new UploadItem();
        uploadItem.setFileName("article.md");
        uploadItem.setFilePath(filePath);
        uploadResult.getUploadItems().add(uploadItem);
        return uploadResult;
    }
}
