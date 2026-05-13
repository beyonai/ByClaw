package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;

public interface UserFS {

    int DEFAULT_LIST_DEPTH = 3;

    /**
     * 用户文件系统：初始化底层存储。
     */
    void init();

    /**
     * 用户文件系统：挂载底层存储。
     */
    void mount();

    /**
     * 用户文件系统：读
     *
     * @param filePath /.openclaw/xx /.sessions/xx /.personal_agent/xx /.uiagent/xx
     * @return
     */
    InputStream read(String filePath);

    /**
     * 用户文件系统：删除
     *
     * @param filePath
     * @return
     */
    Boolean delete(String filePath);

    /**
     * 用户文件系统：list
     *
     * @param filePath 文件或目录路径
     * @param maxDepth 递归深度，按 filePath 下的相对路径层级计算；为空时默认递归 3 层
     * @return
     */
    List<String> list(String filePath, Integer maxDepth);

    /**
     * 用户文件系统：写
     *
     * @param multipartFile 文件对象
     * @param filePath      /.openclaw/xxx /.sessions/xx /.personal_agent/xx /.uiagent/xx
     * @return
     */
    FileMetadata write(MultipartFile multipartFile, String filePath);

}
