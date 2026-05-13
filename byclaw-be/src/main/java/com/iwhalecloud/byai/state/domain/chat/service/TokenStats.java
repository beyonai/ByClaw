package com.iwhalecloud.byai.state.domain.chat.service;

import lombok.Getter;
import lombok.Setter;

/**
 * Token统计信息类
 */
@Getter
@Setter
public class TokenStats {

    /** token 输入token总数 */
    private Float inputTokenCount;

    /** token 输出token总数 */
    private Float outputTokenCount;

    /** token 每秒输出token数 */
    private Float outputTokenPerSecond;

}