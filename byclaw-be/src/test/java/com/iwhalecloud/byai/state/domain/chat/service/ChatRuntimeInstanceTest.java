package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ChatRuntimeInstanceTest {

    @Test
    void developmentInstanceIdIsStableForSameHostAndDomain() {
        ChatRuntimeInstance first = new ChatRuntimeInstance("development", "ByaiService-dev-a", "developer-mac");
        ChatRuntimeInstance second = new ChatRuntimeInstance("development", "ByaiService-dev-a", "developer-mac");

        assertThat(first.isDevelopment()).isTrue();
        assertThat(first.getInstanceId()).isEqualTo("development:developer-mac:ByaiService-dev-a");
        assertThat(second.getInstanceId()).isEqualTo(first.getInstanceId());
    }

    @Test
    void productionInstanceIdRemainsUniqueAcrossProcesses() {
        ChatRuntimeInstance first = new ChatRuntimeInstance("production", "ByaiService", "be-pod");
        ChatRuntimeInstance second = new ChatRuntimeInstance("production", "ByaiService", "be-pod");

        assertThat(first.isDevelopment()).isFalse();
        assertThat(first.getInstanceId()).startsWith("be-pod:");
        assertThat(second.getInstanceId()).isNotEqualTo(first.getInstanceId());
    }

    @Test
    void developmentRequiresDomainName() {
        assertThatThrownBy(() -> new ChatRuntimeInstance("development", " ", "developer-mac"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("BE_DOMAINNAME");
    }

    @Test
    void developmentRequiresHostName() {
        assertThatThrownBy(() -> new ChatRuntimeInstance("development", "ByaiService-dev-a", null))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("hostname");
    }

    @Test
    void publicConstructorReadsDotenvValuesFromSystemProperties() {
        String originalEnvironment = System.getProperty("BE_ENV");
        String originalDomainName = System.getProperty("BE_DOMAINNAME");
        try {
            System.setProperty("BE_ENV", "development");
            System.setProperty("BE_DOMAINNAME", "ByaiService-dotenv");

            ChatRuntimeInstance instance = new ChatRuntimeInstance();

            assertThat(instance.isDevelopment()).isTrue();
            assertThat(instance.getInstanceId()).startsWith("development:");
            assertThat(instance.getInstanceId()).endsWith(":ByaiService-dotenv");
        }
        finally {
            restoreSystemProperty("BE_ENV", originalEnvironment);
            restoreSystemProperty("BE_DOMAINNAME", originalDomainName);
        }
    }

    private static void restoreSystemProperty(String key, String value) {
        if (value == null) {
            System.clearProperty(key);
        }
        else {
            System.setProperty(key, value);
        }
    }
}
