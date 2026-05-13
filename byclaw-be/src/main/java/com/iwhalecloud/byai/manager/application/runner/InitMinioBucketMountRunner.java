package com.iwhalecloud.byai.manager.application.runner;

import com.iwhalecloud.byai.common.storage.ResourceFS;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.storage.config.MinioConfig;

/**
 * MinIO 公共 bucket 初始化启动 Runner。
 *
 * 设计说明：
 * 1. 启动时只负责决定“要不要执行公共 bucket 初始化”；
 * 2. 具体 bucket/目录准备与 rclone 执行交给 ResourceFS；
 * 3. 通过最低优先级执行，尽量让基础配置和其他启动逻辑先完成。
 * @author qin.guoquan
 * @date 2026-04-19 02:12:18
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InitMinioBucketMountRunner implements ApplicationRunner {

    private static final Logger LOGGER = LoggerFactory.getLogger(InitMinioBucketMountRunner.class);

    @Value("${file.storage.type:minio}")
    private String storageType;

    @Autowired
    private ResourceFS resourceFS;

    @Autowired
    private MinioConfig minioConfig;

    @Override
    public void run(ApplicationArguments args) {
        if (!"minio".equalsIgnoreCase(storageType)) {
            LOGGER.info("当前文件存储类型不是minio，跳过MinIO公共bucket初始化, storageType={}", storageType);
            return;
        }

        LOGGER.info("准备执行MinIO公共bucket初始化, storageType={}, mountEnabled={}, mountPath={}",
            storageType,
            minioConfig.getMount() == null ? null : minioConfig.getMount().getEnabled(),
            minioConfig.getMount() == null ? null : minioConfig.getMount().getPath());
        try {
            resourceFS.init();
        } catch (Exception e) {
            // 公共 bucket 初始化是启动增强动作，不应该因为环境或rclone问题把整个服务启动打挂。
            LOGGER.error("MinIO公共bucket初始化任务执行失败，系统继续启动, storageType={}", storageType, e);
        }
    }
}
