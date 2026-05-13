package com.iwhalecloud.byai.manager.entity.file;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 文件实体类 对应表：byai_files
 *
 * @author system
 * @date 2025-01-01
 */
@Getter
@Setter
@TableName("byai_files")
public class Files {

    /**
     * 文件id
     */
    @TableId(value = "file_id", type = IdType.INPUT)
    private Long fileId;

    /**
     * 文件名称
     */
    private String fileName;

    /**
     * 文件类型
     */
    private String fileType;

    /**
     * 文件长度
     */
    private Long length;

    /**
     * 文件md5
     */
    private String fileMd5;

    /**
     * 文件上传路径
     */
    private String fileUrl;

    /**
     * 上传时间
     */
    private Date uploadDate;

    /**
     * 上传用户
     */
    private Long createBy;

    /**
     * 所属团队
     */
    private Long teamId;

    /**
     * 所属知识库
     */
    private Long datasetId;

    /**
     * 所属目录
     */
    private Long fileCollectId;

    /**
     * 文件上传服务器类型 minio sso
     */
    private String fileSystemType;

    /**
     * 文件上传状态
     */
    private String uploadState;

    /**
     * 分块大小
     */
    private Long chunkSize;

    /**
     * 上传转化后文件地址
     */
    private String convertFileUrl;

    /**
     * 上传转化后文件名称
     */
    private String convertFileName;

    /**
     * 内容类型
     */
    private String contentType;

    /**
     * 是否问答对 0：否，1是
     */
    private Integer isAqs;

    /**
     * 是否转pdf
     */
    private String convertPdf;

    /**
     * 数据集类型：1-文档数据集；2-问答对数据集；3-自定义数据集；
     */
    private String datasetType;

    /**
     * 构建完成时间
     */
    private Date completeTime;

    /**
     * 构建配置信息
     */
    private String buildConf;

    /**
     * 第三方文件id
     */
    private String thirdFileId;

    /**
     * 标签
     */
    private String tags;

    /**
     * 聊天ID
     */
    private Long chatId;

    /**
     * 构建扩展参数
     */
    private String buildExtendParam;

    /**
     * 有效时间开始
     */
    private Date effectiveTimeStart;

    /**
     * 有效时间结束
     */
    private Date effectiveTimeEnd;

    /**
     * 文件状态，00A启用，00X禁用
     */
    private String fileStatus;

    /**
     * 项目标识
     */
    private Long projectId;
}
