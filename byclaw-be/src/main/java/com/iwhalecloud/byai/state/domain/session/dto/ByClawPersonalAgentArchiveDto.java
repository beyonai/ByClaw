package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 个人 agent tar.gz 档案信息。
 *
 * @author qin.guoquan
 * @date 2026-05-20
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ByClawPersonalAgentArchiveDto {

    /**
     * tar.gz 文件名。
     */
    private String fileName;

    /**
     * 用户桶外部路径，例如 /.personal-agents/10000417/demo.tar.gz。
     */
    private String archivePath;

    /**
     * MinIO objectKey，例如 /by/.personal-agents/10000417/demo.tar.gz。
     */
    private String objectKey;

    /**
     * 资源ID。
     */
    private Long resourceId;

    /**
     * 目标用户编码。
     */
    private String userCode;

    /**
     * 文件大小（字节）。
     */
    private Long fileSize;

    /**
     * 内容类型。
     */
    private String contentType;
}
