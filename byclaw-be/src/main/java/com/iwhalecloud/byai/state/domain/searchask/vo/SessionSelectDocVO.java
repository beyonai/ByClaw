package com.iwhalecloud.byai.state.domain.searchask.vo;

import java.util.List;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.state.domain.searchask.dto.SessionArchiveItemDTO;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 按 sessionId 反查的响应 DTO：该会话下所有 request 的 query 与文档列表及文件信息
 *
 * @author system
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class SessionSelectDocVO {

    /**
     * 会话标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    /**
     * 该会话下所有归档请求列表（按 request 维度，每项含 request_id、query、create_time、doc_list）
     */
    private List<SessionArchiveItemDTO> requestList;
}
