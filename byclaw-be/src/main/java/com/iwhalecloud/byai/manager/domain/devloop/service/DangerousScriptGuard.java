package com.iwhalecloud.byai.manager.domain.devloop.service;

import org.apache.commons.lang3.StringUtils;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 集成测试脚本的高危命令闸门。环境准备 stages 与套件 runCommand 都是在测试环境上以 SSH/本机 shell 执行的任意脚本,
 * 一旦含删库跑路级命令会造成不可逆破坏。保存与运行两处都过闸:保存时挡在入库前,运行时再挡一遍(防绕过 API 直接改库)。
 * 仅拦"非常危险"的破坏性操作,不做通用 lint;命中即拒,返回人可读原因。
 */
@Service
public class DangerousScriptGuard {

    // 每条规则:正则 + 命中原因。规则面向不可逆破坏(删根/格式化/裸盘写/关机/fork 炸弹/远程管道执行等),不覆盖一般坏味道。
    private static final List<Rule> RULES = List.of(
        // rm -rf 作用到根/家目录/通配根:典型删库跑路。
        rule("(?i)\\brm\\s+(-[a-z]*\\s+)*-?[a-z]*r[a-z]*f?[a-z]*\\s+(-[a-z]*\\s+)*(/|~|/\\*|\\$HOME|/\\s|\\.\\s*$|\\*\\s*$)",
            "devloop.script.rootDelete"),
        // 磁盘格式化。
        rule("(?i)\\bmkfs(\\.[a-z0-9]+)?\\b", "devloop.script.formatDisk"),
        // dd 直接写块设备。
        rule("(?i)\\bdd\\b[^\\n]*\\bof=\\s*/dev/(sd|nvme|vd|hd|mapper)", "devloop.script.rawWrite"),
        // 向块设备/整盘重定向。
        rule("(?i)>\\s*/dev/(sd|nvme|vd|hd)[a-z0-9]*", "devloop.script.redirectDevice"),
        // 覆盖磁盘为空/随机。
        rule("(?i)\\b(shred|wipefs)\\b", "devloop.script.wipeDisk"),
        // 关机/重启/停机。
        rule("(?i)\\b(shutdown|reboot|halt|poweroff|init\\s+0|init\\s+6)\\b", "devloop.script.shutdown"),
        // fork 炸弹 :(){ :|:& };:
        rule(":\\s*\\(\\s*\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:", "devloop.script.forkBomb"),
        // 远程下载直接管道执行:curl/wget ... | sh/bash。
        rule("(?i)\\b(curl|wget)\\b[^\\n|]*\\|\\s*(sudo\\s+)?(sh|bash|zsh|python[0-9.]*|node)\\b",
            "devloop.script.remotePipe"),
        // 递归 chmod/chown 作用到根/家目录。
        rule("(?i)\\bch(mod|own)\\s+(-[a-z]*\\s+)*-?[a-z]*R[a-z]*\\s+[^\\n]*\\s(/|~|\\$HOME)(\\s|$)",
            "devloop.script.rootPermissions"),
        // 覆盖关键系统文件。
        rule("(?i)>\\s*/etc/(passwd|shadow|sudoers|fstab|hosts)\\b", "devloop.script.systemFiles"),
        // 清空 iptables 或危险 kill -9 -1。
        rule("(?i)\\bkill\\s+-9\\s+-1\\b", "devloop.script.killAll")
    );

    private static Rule rule(String regex, String reason) {
        return new Rule(Pattern.compile(regex), reason);
    }

    /**
     * 检查一段脚本;命中任一高危规则即返回原因,否则返回 null。
     *
     * @param label  脚本来源标签(用于拼原因,如 stage 名或 "套件命令")
     * @param script 脚本正文
     * @return 命中原因(含来源标签);未命中返回 null
     */
    public String detect(String label, String script) {
        if (StringUtils.isBlank(script)) {
            return null;
        }
        for (Rule r : RULES) {
            if (r.pattern.matcher(script).find()) {
                // 规则只保存消息键，检测时按调用者语言生成提示。
                return I18nUtil.get("devloop.script.blocked",
                    StringUtils.defaultString(label, I18nUtil.get("devloop.script.label")), I18nUtil.get(r.reason));
            }
        }
        return null;
    }

    private record Rule(Pattern pattern, String reason) {
    }
}
