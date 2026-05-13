package com.iwhalecloud.byai.manager.dto.men;

import lombok.Getter;
import lombok.Setter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-09-16 11:27:10
 * @description 通知列表DTO
 */
@Getter
@Setter
public class Notices {

    /**
     * 通知详情列表
     */
    @NotEmpty(message = "{notices.noticedetails.notempty}")
    @Size(max = 100, message = "{notices.noticedetails.maxsize}")
    @Valid
    private List<NoticeDetail> noticeDetails;
}
