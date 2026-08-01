package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 集成测试环境入参。stages / testAccounts 由前端序列化为JSON字符串传入,与 ScanSource.config 同规。
 */
@Data
public class IntegrationEnvDTO {

    private Long envId;

    private Long projectId;

    private String envName;

    private String address;

    private String orchestrator;

    private String connProtocol;

    private String connHost;

    private String connPort;

    private String connUser;

    private String connAuth;

    /** 连接凭据key,指向 ~/.openclaw/credentials/,不存明文 */
    private String connCredentialRef;

    private String connWorkdir;

    /** 部署/准备阶段脚本数组JSON */
    private String stages;

    /** 业务测试账号数组JSON,密码只存凭据key不入库 */
    private String testAccounts;
}
