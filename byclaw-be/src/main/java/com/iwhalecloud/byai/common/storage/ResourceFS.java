package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;

public interface ResourceFS {

    int DEFAULT_LIST_DEPTH = 3;

    /**
     * 资源文件系统：初始化底层存储。
     */
    void init();

    /**
     * 资源文件系统：读
     *
     * @param filePath /.resource/toolkit/xx /.resource/mcp/xxx
     * @return
     */
    InputStream read(String filePath);

    /**
     * 资源文件系统：删除
     *
     * @param filePath
     * @return
     */
    Boolean delete(String filePath);

    /**
     * 资源文件系统：list
     *
     * @param filePath 文件或目录路径
     * @param maxDepth 递归深度，按 filePath 下的相对路径层级计算；为空时默认递归 3 层
     * @return
     */
    List<String> list(String filePath, Integer maxDepth);

    /**
     * 资源文件系统：写
     *
     * @param multipartFile
     * @param filePath
     * @return
     */
    FileMetadata write(MultipartFile multipartFile, String filePath);

}
