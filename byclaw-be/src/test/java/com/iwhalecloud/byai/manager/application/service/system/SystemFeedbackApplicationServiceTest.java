package com.iwhalecloud.byai.manager.application.service.system;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.domain.system.service.AttachFileService;
import com.iwhalecloud.byai.manager.domain.system.service.SystemFeedbackService;
import com.iwhalecloud.byai.manager.dto.system.SystemFeedbackDTO;
import com.iwhalecloud.byai.manager.entity.system.AttachFile;
import com.iwhalecloud.byai.manager.vo.system.SystemFeedbackManageVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.context.MessageSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SystemFeedbackApplicationServiceTest {

    private SystemFeedbackApplicationService service;

    private SystemFeedbackService systemFeedbackService;

    private AttachFileService attachFileService;

    private SequenceService sequenceService;

    private CommonFileStorage commonFileStorage;

    private CommonFilePathResolver commonFilePathResolver;

    @BeforeEach
    void setUp() {
        service = new SystemFeedbackApplicationService();
        systemFeedbackService = mock(SystemFeedbackService.class);
        attachFileService = mock(AttachFileService.class);
        sequenceService = mock(SequenceService.class);
        commonFileStorage = mock(CommonFileStorage.class);
        commonFilePathResolver = new CommonFilePathResolver();
        ReflectionTestUtils.setField(service, "systemFeedbackService", systemFeedbackService);
        ReflectionTestUtils.setField(service, "attachFileService", attachFileService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "commonFileStorage", commonFileStorage);
        ReflectionTestUtils.setField(service, "commonFilePathResolver", commonFilePathResolver);
        mockI18n();

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10001L);
        loginInfo.setUserCode("manager001");
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    private void mockI18n() {
        MessageSource messageSource = mock(MessageSource.class);
        when(messageSource.getMessage(any(String.class), any(Object[].class), any(Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void queryManageDetail_returnsFeedbackAttachments() {
        SystemFeedbackManageVo feedback = new SystemFeedbackManageVo();
        feedback.setId(501L);
        feedback.setTitle("模型切换失败");
        AttachFile attachment = createAttachment();
        when(systemFeedbackService.selectManageDetail(501L)).thenReturn(feedback);
        when(attachFileService.findFeedbackAttachments(any())).thenReturn(List.of(attachment));

        SystemFeedbackManageVo result = service.queryManageDetail(501L);

        assertThat(result.getAttachments()).hasSize(1);
        assertThat(result.getAttachments().get(0).getAttachFileId()).isEqualTo(601L);
        assertThat(result.getAttachments().get(0).getFileName()).isEqualTo("error.png");
    }

    @Test
    void writeFeedbackAttachment_readsOnlyAttachmentLinkedToFeedback() throws Exception {
        byte[] content = "feedback-image".getBytes(StandardCharsets.UTF_8);
        AttachFile attachment = createAttachment();
        SystemFeedbackManageVo feedback = new SystemFeedbackManageVo();
        feedback.setId(501L);
        when(attachFileService.selectById(601L)).thenReturn(attachment);
        when(systemFeedbackService.selectManageDetail(501L)).thenReturn(feedback);
        when(commonFileStorage.read(commonFilePathResolver.feedback("/manager001/error.png")))
            .thenReturn(new ByteArrayInputStream(content));
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.writeFeedbackAttachment(response, 601L, false);

        assertThat(response.getContentAsByteArray()).isEqualTo(content);
        assertThat(response.getContentType()).isEqualTo("image/png");
        assertThat(response.getHeader("Content-Disposition")).startsWith("inline;");
        verify(commonFileStorage).read(commonFilePathResolver.feedback("/manager001/error.png"));
    }

    @Test
    void save_bindsUploadedAttachmentsToTheNewFeedback() {
        SystemFeedbackDTO feedback = new SystemFeedbackDTO();
        feedback.setFeedbackType("BUG");
        feedback.setTitle("附件无法查看");
        feedback.setContent("提交反馈后附件未展示");
        feedback.setAttachFileIds(List.of(601L));
        AttachFile attachment = new AttachFile();
        attachment.setAttachFileId(601L);
        attachment.setTableName("byai_system_feedback");
        attachment.setCreateUserId(10001L);

        when(sequenceService.nextVal()).thenReturn(501L);
        when(attachFileService.selectById(601L)).thenReturn(attachment);

        service.save(new MockHttpServletRequest(), feedback);

        assertThat(attachment.getTablePkValue()).isEqualTo(501L);
        assertThat(attachment.getState()).isEqualTo("00A");
        verify(attachFileService).update(attachment);
    }

    @Test
    void exportManageList_writesAttachmentLogicalPaths() throws Exception {
        SystemFeedbackManageVo feedback = new SystemFeedbackManageVo();
        feedback.setId(501L);
        feedback.setCreateDate(new Date());
        AttachFile attachment = createAttachment();
        when(systemFeedbackService.selectManageList(any())).thenReturn(List.of(feedback));
        when(attachFileService.findFeedbackAttachments(any())).thenReturn(List.of(attachment));
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.exportManageList(response, null);

        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(response.getContentAsByteArray()))) {
            assertThat(workbook.getSheetAt(0).getRow(1).getCell(10).getStringCellValue())
                .isEqualTo("/byai-feedback/manager001/error.png");
        }
    }

    private AttachFile createAttachment() {
        AttachFile attachment = new AttachFile();
        attachment.setAttachFileId(601L);
        attachment.setFileName("error.png");
        attachment.setFileType("image/png");
        attachment.setFileLocation("/manager001/error.png");
        attachment.setTableName("byai_system_feedback");
        attachment.setTablePkValue(501L);
        attachment.setState("00A");
        return attachment;
    }
}
