package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.verifyNoInteractions;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.context.i18n.LocaleContextHolder;

import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiPromptService;
import com.iwhalecloud.byai.manager.entity.aimodel.AiPrompt;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;

@ExtendWith(MockitoExtension.class)
class AssistantChatServiceTest {

    @InjectMocks
    private AssistantChatService assistantChatService;

    @Mock
    private SessionTitleService sessionTitleService;

    @Mock
    private AiPromptService aiPromptService;

    @Mock
    private AIService aiService;

    @AfterEach
    void resetLocale() {
        LocaleContextHolder.resetLocaleContext();
    }

    @ParameterizedTest
    @ValueSource(strings = {"en-US", "en-GB", "en"})
    void summaryChatContent_usesEnglishTemplateForEnglishLocale(String language) {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        AiPrompt prompt = titlePrompt("中文标题: ${chatContent}", "english-model");
        prompt.setPromptEnTemplate("English title: ${chatContent}");
        when(aiPromptService.findFirst("SUMMARY_CHAT_CONTENT")).thenReturn(prompt);
        when(aiService.generateText("English title: 中文问题", "english-model")).thenReturn("English title");

        String title = ReflectionTestUtils.invokeMethod(assistantChatService, "summaryChatContent", "中文问题");

        assertThat(title).isEqualTo("English title");
        verify(aiPromptService).findFirst("SUMMARY_CHAT_CONTENT");
        verifyNoMoreInteractions(aiPromptService);
    }

    @Test
    void summaryChatContent_usesChineseTemplateForChineseLocale() {
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        when(aiPromptService.findFirst("SUMMARY_CHAT_CONTENT"))
            .thenReturn(titlePrompt("默认标题: ${chatContent}", "default-model"));
        when(aiService.generateText("默认标题: 问题", "default-model")).thenReturn("默认标题");

        String title = ReflectionTestUtils.invokeMethod(assistantChatService, "summaryChatContent", "问题");

        assertThat(title).isEqualTo("默认标题");
        verify(aiPromptService).findFirst("SUMMARY_CHAT_CONTENT");
        verifyNoMoreInteractions(aiPromptService);
    }

    @Test
    void summaryChatContent_fallsBackWhenEnglishTemplateMissing() {
        LocaleContextHolder.setLocale(Locale.US);
        when(aiPromptService.findFirst("SUMMARY_CHAT_CONTENT"))
            .thenReturn(titlePrompt("Default: ${chatContent}", "fallback-model"));
        when(aiService.generateText("Default: 问题", "fallback-model")).thenReturn("Fallback title");

        String title = ReflectionTestUtils.invokeMethod(assistantChatService, "summaryChatContent", "问题");

        assertThat(title).isEqualTo("Fallback title");
    }

    @Test
    void summaryChatContent_fallsBackWhenEnglishTemplateBlank() {
        LocaleContextHolder.setLocale(Locale.US);
        AiPrompt prompt = titlePrompt("Default: ${chatContent}", "fallback-model");
        prompt.setPromptEnTemplate(" ");
        when(aiPromptService.findFirst("SUMMARY_CHAT_CONTENT")).thenReturn(prompt);
        when(aiService.generateText("Default: 问题", "fallback-model")).thenReturn("Fallback title");

        String title = ReflectionTestUtils.invokeMethod(assistantChatService, "summaryChatContent", "问题");

        assertThat(title).isEqualTo("Fallback title");
    }

    @Test
    void summaryChatContent_truncatesOriginalWhenConfigsMissing() {
        LocaleContextHolder.setLocale(Locale.US);

        String title = ReflectionTestUtils.invokeMethod(assistantChatService, "summaryChatContent",
            "{{DIG_EMPLOYEE_1}}1234567890123");

        assertThat(title).isEqualTo("1234567890");
        verify(aiPromptService).findFirst("SUMMARY_CHAT_CONTENT");
        verifyNoInteractions(aiService);
    }

    @Test
    void summaryChatContent_truncatesOriginalWhenGenerationFails() {
        LocaleContextHolder.setLocale(Locale.US);
        when(aiPromptService.findFirst("SUMMARY_CHAT_CONTENT"))
            .thenReturn(titlePrompt("English: ${chatContent}", "english-model"));
        when(aiService.generateText("English: 1234567890123", "english-model"))
            .thenThrow(new IllegalStateException("model unavailable"));

        String title = ReflectionTestUtils.invokeMethod(assistantChatService, "summaryChatContent", "1234567890123");

        assertThat(title).isEqualTo("1234567890");
    }

    private AiPrompt titlePrompt(String template, String modelCode) {
        AiPrompt prompt = new AiPrompt();
        prompt.setPromptZhTemplate(template);
        prompt.setModelCode(modelCode);
        return prompt;
    }

    @Test
    void handleSessionLogic_emitsTitleUpdateForFirstUserText() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setSessionId(10L);
        assistantChatDto.setSessionType(SessionType.H_AS.getCode());
        assistantChatDto.setChatContent("请分析这个文件");
        ByaiSession updatedSession = new ByaiSession();
        updatedSession.setSessionId(10L);
        updatedSession.setSessionName("请分析这个文件");
        when(sessionTitleService.resolveInitialTitle(10L, "请分析这个文件")).thenReturn(updatedSession);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        ReflectionTestUtils.invokeMethod(assistantChatService, "handleSessionLogic", outputStream, assistantChatDto);

        verify(sessionTitleService).resolveInitialTitle(10L, "请分析这个文件");
        String eventPayload = outputStream.toString(StandardCharsets.UTF_8);
        assertThat(eventPayload).contains("\"event\":\"sessionTitleUpdated\"");
        assertThat(eventPayload).contains("\"sessionName\":\"请分析这个文件\"");
    }
}
