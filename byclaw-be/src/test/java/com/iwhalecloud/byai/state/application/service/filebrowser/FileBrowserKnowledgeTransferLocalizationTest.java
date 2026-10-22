package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSaveToKnowledgeRequest;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class FileBrowserKnowledgeTransferLocalizationTest extends I18nTestSupport {
    @Test
    void localizesMissingFieldsBeforeAnyFileOperation() {
        var files = mock(FileBrowserApplicationService.class);
        var datasets = mock(DatasetApplicationService.class);
        var service = new FileBrowserKnowledgeTransferApplicationService(files, datasets);
        var request = new FileBrowserSaveToKnowledgeRequest();
        assertThatThrownBy(() -> service.saveToKnowledge("alice", request)).hasMessage("resourceId 不能为空");
        LocaleContextHolder.setLocale(Locale.US);
        assertThatThrownBy(() -> service.saveToKnowledge("alice", request)).hasMessage("resourceId is required");
        request.setResourceId(9007199254740993L);
        assertThatThrownBy(() -> service.saveToKnowledge("alice", request)).hasMessage("targetResourceId is required");
        request.setTargetResourceId(9007199254740994L);
        assertThatThrownBy(() -> service.saveToKnowledge("alice", request)).hasMessage("sourcePath is required");
        assertThat(request.getResourceId()).isEqualTo(9007199254740993L);
        assertThat(request.getTargetResourceId()).isEqualTo(9007199254740994L);
        verifyNoInteractions(files, datasets);
    }
}
