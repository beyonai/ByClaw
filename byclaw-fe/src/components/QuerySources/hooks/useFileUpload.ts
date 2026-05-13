/* eslint-disable lines-around-comment */
/**
 * useFileUpload Hook
 * 处理文件上传相关的逻辑，包括添加 loading 节点、上传完成后更新节点
 */

import { useCallback } from 'react';
import type { SourceTreeNodeId, KnowledgeSource, LoadingSourceItem, SourceRootId } from '../types';
import { SourceTreeNodeTypeMap, SourceRootIdMap } from '../const';
import { generateUniqueId } from '@/utils/math';
import { uploadFile } from '../services';
import useGlobal from '@/hooks/useGlobal';

/** SourceBucket 类型 */
interface SourceBucket {
  items: KnowledgeSource[];
  totalCount: number;
}

/** Sources 状态类型 */
type SourcesState = {
  [key in SourceRootId]: SourceBucket;
};

interface UseFileUploadOptions {
  /** 会话ID */
  sessionId?: string;
  /** 设置 sources 状态 */
  setSources: React.Dispatch<React.SetStateAction<SourcesState>>;
  /** 设置 loading sources 状态 */
  setLoadingSources: React.Dispatch<React.SetStateAction<LoadingSourceItem[]>>;
  /** 设置勾选 ID 列表 */
  setCheckedIds: React.Dispatch<React.SetStateAction<SourceTreeNodeId[]>>;
}

interface UploadResult {
  success: boolean;
  fileId?: string;
  fileUrl?: string;
}

function getFileNodeId() {
  return `${SourceTreeNodeTypeMap.file}-${generateUniqueId()}` as SourceTreeNodeId;
}

/**
 * 文件上传 Hook
 * 用于处理文件上传和粘贴文字生成文件的上传逻辑
 * 实际上传接口在此处预留，后续可替换为真实接口调用
 */
export const useFileUpload = (options: UseFileUploadOptions) => {
  const { setSources, setLoadingSources, setCheckedIds, sessionId } = options;
  const { agentId, uploadFileConfig } = useGlobal();

  /**
   * 处理文件上传
   * 在【用户导入来源】下添加一个 loading 节点，上传完成后更新节点数据
   * @param file 文件对象
   * @param displayTitle 在树中显示的标题（可选，默认使用 file.name）
   */
  const handleFileUpload = useCallback(
    async (file: File, displayTitle?: string): Promise<UploadResult> => {
      const fileName = file.name;
      const title = displayTitle || fileName;

      // 生成唯一ID
      const tempId = getFileNodeId();

      // 根据 uploadFileConfig 判断是否还能将该文件标记为勾选（但无论如何都会发起上传）
      setCheckedIds((prev) => {
        if (uploadFileConfig && uploadFileConfig.maxFileCount > 0) {
          const filePrefix = `${SourceTreeNodeTypeMap.file}-`;
          const currentFileCount = prev.filter((id) => `${id}`.startsWith(filePrefix)).length;
          if (currentFileCount >= uploadFileConfig.maxFileCount) {
            return prev;
          }
        }
        return [...prev, tempId];
      });

      // 添加 loading 节点并发起上传
      const loadingItem: LoadingSourceItem = {
        id: tempId,
        title,
        type: SourceTreeNodeTypeMap.file,
        loading: true,
      };
      setLoadingSources((prev) => [...prev, loadingItem]);

      try {
        const resp = (await uploadFile(file, {
          sessionId,
          agentId,
        })) as unknown as {
          sessionId?: number | string;
          importResults?: Array<{
            fileId?: number | string;
            fileName?: string;
            fileType?: string;
            length?: number | null;
            fileMd5?: string;
            fileUrl?: string;
            [key: string]: any;
          }>;
        };

        const firstResult = resp?.importResults && resp.importResults.length > 0 ? resp.importResults[0] : undefined;

        let result: UploadResult = { success: false };
        if (firstResult && firstResult.fileId) {
          result = {
            success: true,
            fileId: String(firstResult.fileId),
            fileUrl: firstResult.fileUrl,
          };
        }

        if (result.success && firstResult) {
          // 上传成功，更新 sources，将 loading 节点转换为正式节点
          const newSource: KnowledgeSource = {
            ...firstResult,
            id: tempId,
            title: firstResult.fileName || title,
            type: SourceTreeNodeTypeMap.file,
            resourceId: String(firstResult.fileId),
            fileId: String(firstResult.fileId),
            fileUrl: firstResult.fileUrl,
            sessionId: resp?.sessionId,
          };

          setSources((prev) => ({
            ...prev,
            [SourceRootIdMap.userImported]: {
              ...prev[SourceRootIdMap.userImported],
              items: [...prev[SourceRootIdMap.userImported].items, newSource],
              totalCount: prev[SourceRootIdMap.userImported].totalCount + 1,
            },
          }));

          // 移除 loading 状态
          setLoadingSources((prev) => prev.filter((item) => item.id !== tempId));
        } else {
          // 上传失败，移除 loading 节点
          setLoadingSources((prev) => prev.filter((item) => item.id !== tempId));
          setCheckedIds((prev) => prev.filter((id) => id !== tempId));
        }

        return result;
      } catch (error) {
        console.error('File upload failed:', error);
        // 发生错误，移除 loading 节点
        setLoadingSources((prev) => prev.filter((item) => item.id !== tempId));
        setCheckedIds((prev) => prev.filter((id) => id !== tempId));
        return { success: false };
      }
    },
    [setSources, setLoadingSources, setCheckedIds, sessionId, uploadFileConfig, agentId]
  );

  /**
   * 处理粘贴文字上传
   * 将文字内容生成为 txt 文件，然后复用文件上传逻辑
   * @param text 文字内容
   */
  const handleTextUpload = useCallback(
    async (text: string): Promise<UploadResult> => {
      // 将文字内容生成为 txt 文件
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const fileName = `粘贴的文字-${Date.now()}.txt`;
      const file = new File([blob], fileName, { type: 'text/plain' });

      // 复用文件上传逻辑，并在树中显示统一标题
      return handleFileUpload(file, '粘贴的文字');
    },
    [handleFileUpload]
  );

  return {
    handleFileUpload,
    handleTextUpload,
  };
};
