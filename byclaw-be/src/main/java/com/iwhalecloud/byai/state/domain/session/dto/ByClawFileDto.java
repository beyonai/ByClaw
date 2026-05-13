package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-04-18 19:38:18
 * 用户 byclaw 文件信息。
 */
@Getter
@Setter
@AllArgsConstructor
public class ByClawFileDto {

    /**
     * UserFS 外部路径，例如 /.sessions/{sessionId}/reports/out.md。
     */
    private String objectKey;

    /**
     * 文件名（对象键最后一级）。
     */
    private String fileName;

    /**
     * 展示用路径，当前与 objectKey 保持一致，便于前端继续按 UserFS 路径读取。
     */
    private String filePath;
}
