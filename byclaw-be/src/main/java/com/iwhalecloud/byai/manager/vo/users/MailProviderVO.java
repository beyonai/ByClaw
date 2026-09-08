package com.iwhalecloud.byai.manager.vo.users;

import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import lombok.Getter;

/**
 * 邮箱服务商目录项。
 */
@Getter
public class MailProviderVO {

    private final String code;

    private final String name;

    private final String transport;

    private final String authType;

    private final MailServerConfigDTO imap;

    private final MailServerConfigDTO smtp;

    private final String connectorCode;

    private final List<String> capabilities;

    private final Map<String, String> capabilityStatus;

    private final List<String> setupRequirements;

    private final Boolean advancedServerEditable;

    public MailProviderVO(String code, String name, String transport, String authType,
        MailServerConfigDTO imap, MailServerConfigDTO smtp, String connectorCode,
        List<String> capabilities, Map<String, String> capabilityStatus,
        List<String> setupRequirements, boolean advancedServerEditable) {
        this.code = code;
        this.name = name;
        this.transport = transport;
        this.authType = authType;
        this.imap = copyServer(imap);
        this.smtp = copyServer(smtp);
        this.connectorCode = connectorCode;
        this.capabilities = List.copyOf(capabilities);
        this.capabilityStatus = Map.copyOf(capabilityStatus);
        this.setupRequirements = List.copyOf(setupRequirements);
        this.advancedServerEditable = advancedServerEditable;
    }

    public MailServerConfigDTO getImap() {
        return copyServer(imap);
    }

    public MailServerConfigDTO getSmtp() {
        return copyServer(smtp);
    }

    private static MailServerConfigDTO copyServer(MailServerConfigDTO source) {
        if (source == null) {
            return null;
        }
        MailServerConfigDTO copy = new MailServerConfigDTO();
        copy.setHost(source.getHost());
        copy.setPort(source.getPort());
        copy.setEncryption(source.getEncryption());
        return copy;
    }
}
