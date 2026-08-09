package com.iwhalecloud.byai.manager.domain.devloop.exec;

import lombok.Data;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 一次命令执行的入参。ssh 连接目标 + 工作目录 + 注入环境变量 + 命令 + 超时。
 * secret 为解密后的私钥正文(authType=key)或密码(authType=password),仅内存持有,不落库不打日志。
 */
@Data
public class CommandExecSpec {

    /** 连接方式 ssh远程/local本机 */
    private String connProtocol;

    private String host;

    private String port;

    private String user;

    /** ssh认证方式 key密钥/password密码 */
    private String authType;

    /** 解密后的私钥正文或密码,内存态 */
    private String secret;

    private String workdir;

    /** 注入到命令执行环境的变量(如测试账号 <PREFIX>_USER/<PREFIX>_PASS),按插入序 export */
    private Map<String, String> env = new LinkedHashMap<>();

    private String command;

    private int timeoutSec;

    /**
     * 读文件原文用。置位后输出不截断、不掺 stderr:默认的尾部截断与 stdout+stderr 合并是给
     * 步骤日志设计的,套在 cat 报告上会砍掉 XML 声明或在根标签后追加噪声,直接把报告解析成不可读。
     */
    private boolean rawOutput;
}
