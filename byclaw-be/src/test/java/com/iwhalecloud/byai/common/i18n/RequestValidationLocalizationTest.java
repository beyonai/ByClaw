package com.iwhalecloud.byai.common.i18n;

import com.iwhalecloud.byai.manager.dto.auth.SmsCaptchaRequest;
import com.iwhalecloud.byai.manager.dto.users.MailConnectionCheckRequestDTO;
import com.iwhalecloud.byai.state.common.config.I18nConfig;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactExpiryRenewRequest;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionRequest;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class RequestValidationLocalizationTest extends I18nTestSupport {
    @Test
    void julyKnowledgeConstraintsTranslateContainerElementsWithoutChangingPaths() {
        try (var validator = new I18nConfig().validator(new I18nConfig().messageSource())) {
            validator.afterPropertiesSet();
            var move = new com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemsMoveRequest();
            move.setResourceId(9007199254740993L);
            move.setSourcePath(java.util.List.of(""));
            move.setTargetDirectoryPath("/资料/2026-07");
            String chinese = validator.validate(move).iterator().next().getMessage();
            assertThat(chinese).doesNotStartWith("{");
            LocaleContextHolder.setLocale(Locale.US);
            assertThat(validator.validate(move)).singleElement().satisfies(error ->
                assertThat(error.getMessage()).isEqualTo("A source path is required").isNotEqualTo(chinese));
            move.setSourcePath(java.util.List.of("/资料/源文件.md"));
            assertThat(validator.validate(move)).isEmpty();
            assertThat(move.getTargetDirectoryPath()).isEqualTo("/资料/2026-07");
            assertThat(move.getOverwrite()).isFalse();
            var search = new com.iwhalecloud.byai.manager.dto.resource.KnowledgeSearchRequest();
            search.setTopK(0);
            assertThat(validator.validateProperty(search, "topK")).singleElement().satisfies(error ->
                assertThat(error.getMessage()).isEqualTo("The result limit must be greater than 0"));
        }
    }

    @Test
    void augustRequestConstraintsTranslateWhilePreservingFieldNamesAndLimits() {
        try (var validator = new I18nConfig().validator(new I18nConfig().messageSource())) {
            validator.afterPropertiesSet();
            var project = new com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO();
            project.setProjectName("x".repeat(101));
            assertThat(validator.validateProperty(project, "projectName")).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("项目名称不能超过100个字"));
            LocaleContextHolder.setLocale(Locale.US);
            assertThat(validator.validateProperty(project, "projectName")).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("Project name cannot exceed 100 characters"));
            var discovery = new com.iwhalecloud.byai.manager.dto.resource.KnowledgeEntityDiscoveryRequest();
            discovery.setResourceId(9007199254740993L);
            discovery.setMaxEntities(13);
            assertThat(validator.validate(discovery)).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("Maximum entity count must not exceed 12"));
            var artifact = new com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataCreateRequest();
            artifact.setCollectionName("records_1");
            artifact.setData(java.util.Map.of("rawValue", "业务内容"));
            assertThat(validator.validate(artifact)).isEmpty();
            assertThat(artifact.getData()).containsEntry("rawValue", "业务内容");
            artifact.setData(java.util.Map.of());
            assertThat(validator.validate(artifact)).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("data is required"));
        }
    }

    @Test
    void requestConstraintsTranslateWithoutChangingAcceptedProtocolValues() {
        try (var validator = new I18nConfig().validator(new I18nConfig().messageSource())) {
            validator.afterPropertiesSet();
            AppVersionRequest version = new AppVersionRequest();
            version.setPlatform("macos");
            version.setArch("arm64");
            version.setChannel("stable");
            version.setAppVersion("1.0.0-beta.2");
            version.setUrl("https://example.com/app.dmg");
            version.setReleaseStatus("draft");
            assertThat(validator.validate(version)).isEmpty();
            version.setPlatform("linux");
            assertThat(validator.validate(version)).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("平台只能是 windows/macos"));
            LocaleContextHolder.setLocale(Locale.US);
            assertThat(validator.validate(version)).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("Platform must be windows or macos"));
            assertThat(validator.validate(new ArtifactExpiryRenewRequest())).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("expiresInSeconds is required"));
            assertThat(validator.validate(new MailConnectionCheckRequestDTO())).singleElement()
                .satisfies(error -> assertThat(error.getMessage()).isEqualTo("Mail account ID is required"));
            assertThat(validator.validate(new SmsCaptchaRequest())).extracting(error -> error.getMessage())
                .containsExactlyInAnyOrder("Phone number is required", "Business type is required", "Image captcha is required");
        }
    }

    @Test
    void unknownMailFieldsKeepTheirValidationBoundaryInBothLanguages() {
        MailConnectionCheckRequestDTO request = new MailConnectionCheckRequestDTO();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> request.rejectUnknownField("provider", "private value"))
            .hasMessage("不支持的邮箱连接检查字段");
        LocaleContextHolder.setLocale(Locale.US);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> request.rejectUnknownField("provider", "private value"))
            .hasMessage("Unsupported mail connection check field");
    }
}
