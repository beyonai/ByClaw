package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 集成测试环境:E2E 集成测试的目标环境。
 * 只负责"在哪测/怎么连/怎么部署/用什么账号登录";定时与执行员工归属独立测试数字员工配置。
 */
@Getter
@Setter
@TableName("byai_integration_env")
public class IntegrationEnv {

    @TableId(value = "env_id", type = IdType.INPUT)
    private Long envId;

    private Long projectId;

    private String envName;

    /** 环境访问地址(被测应用入口) */
    private String address;

    /** 编排方式 script/jenkins/k8s/webhook */
    private String orchestrator;

    /**
     * 用例来源 workspace跟随工作区仓库(约定 tests/run.sh)/on_env用例已在环境机上。
     * 与 orchestrator 正交:后者管"环境怎么部署",本字段管"用例从哪来",不可合并。
     */
    private String caseSource;

    /** 连接方式 ssh远程/local本机 */
    private String connProtocol;

    private String connHost;

    private String connPort;

    private String connUser;

    /** SSH认证方式 key密钥/password密码 */
    private String connAuth;

    /** 连接凭据key,指向 ~/.openclaw/credentials/,不存明文 */
    private String connCredentialRef;

    private String connWorkdir;

    /** 部署/准备阶段脚本数组JSON */
    private String stages;

    /** 业务测试账号数组JSON,密码只存凭据key不入库 */
    private String testAccounts;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
