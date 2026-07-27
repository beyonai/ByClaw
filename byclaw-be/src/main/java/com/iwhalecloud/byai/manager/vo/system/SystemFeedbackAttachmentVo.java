package com.iwhalecloud.byai.manager.vo.system;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 系统反馈附件展示信息。
 *
 * @author qin.guoquan
 * @date 2026-07-27 15:37:18
 */
@Getter
@Setter
public class SystemFeedbackAttachmentVo {

    private Long attachFileId;

    private String fileName;

    private String fileType;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createDate;
}
