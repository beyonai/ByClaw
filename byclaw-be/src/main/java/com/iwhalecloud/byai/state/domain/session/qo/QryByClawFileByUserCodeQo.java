package com.iwhalecloud.byai.state.domain.session.qo;

import lombok.Getter;
import lombok.Setter;

/**
 *  * @author qin.guoquan
 *  * @date 2026-04-18 19:38:18
 * 按用户编码查询 byclaw 用户桶文件列表请求。
 */
@Getter
@Setter
public class QryByClawFileByUserCodeQo {

    /**
     * 用户编码。
     */
    private String userCode;

    /**
     * 空间搜索关键字，匹配文件名或对象路径。
     */
    private String keyword;

    /**
     * 前端当前对话的会话ID，仅查询 .sessions/{sessionId}/ 目录下的文件。
     * 例如当前对话 sessionId=10014538，则查询 .sessions/10014538/ 下的对象。
     * 这里不是登录态 sessionId。
     */
    private String sessionId;
}
