package com.iwhalecloud.byai.state.domain.searchask.vo;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 联网搜索 query 接口响应 VO：封装 requestId 与 DocChain 返回的 textList，供前端展示并勾选后调用选中归档。
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class WebSearchQueryVO {

    /**
     * 本次归档会话 ID（SequenceService 生成，前端勾选后调用 archive-selected 时传入）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    /**
     * 本次归档请求 ID（SequenceService 生成，前端勾选后调用 archive-selected 时传入）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long requestId;

    /**
     * DocChain 返回的文本列表，每项为一条检索结果（含 data.heading_chain、data.url、data.content 等）
     */
    private List<Map<String, Object>> textList;
}
