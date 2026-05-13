package com.iwhalecloud.byai.state.common.dto;

import java.util.Arrays;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;
import org.springframework.web.multipart.MultipartFile;

@Getter
@Setter
public class FileUploadDto {
    //文档库id
    private String datasetId;

    //上传的格式  fileCollectId-当前上传知识库的目录， datasetType:4 兼容  datasetId:知识库id
    // {"datasetId":"1506397211732963328","fileCollectId":"-1","datasetType":"4"}
    private String metadata;

    //文件
    @NotEmpty(message = "上传文件不能为空")
    @Valid
    private MultipartFile[] file;

    //要构建的文件id
    private List<String> files;

    //文件类型
    private String datasetType;

    private Long id;


    // 添加文件类型校验方法
    public boolean isValidFileType(MultipartFile file) {
        String[] allowedTypes = {"image/jpeg", "image/png", "application/pdf"};
        return Arrays.asList(allowedTypes).contains(file.getContentType());
    }
}
