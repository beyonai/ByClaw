import { ClipboardEvent, useCallback } from 'react';
import { Editor, Transforms } from 'slate';
import { getDescendantValueByDefaultValue, isMentionElement } from './utils';
import { Props, Resource } from './types';
import { ResourceType } from './utils/constants';
import useGlobal from '@/hooks/useGlobal';

export default function useOnPasteFiles(params: {
  editor: Editor;
  agentId?: string;
  onPasteFiles: Props['onPasteFiles'];
  chatMode?: Props['chatMode'];
}) {
  const { editor, agentId, onPasteFiles, chatMode } = params;

  const { EventEmitter } = useGlobal();

  const parseSlate = useCallback(
    (xstring: string) => {
      try {
        const json = decodeURIComponent(window.atob(xstring));
        const {
          text,
          resourceList,
        }: {
          text: string;
          resourceList: Resource[];
        } = JSON.parse(json);
        let nodes = getDescendantValueByDefaultValue(
          {
            text,
            resourceList,
          },
          chatMode
        );
        const agents = resourceList.filter((item) => item.resourceType === ResourceType.digitalEmployee);
        const schema: {
          agentId?: string;
          payload?: {
            mode?: Props['chatMode'];
          };
          queryQuestion: string;
          inputSchema: {
            text: string;
            resourceList: Resource[];
          };
        } = {
          queryQuestion: text,
          inputSchema: {
            text,
            resourceList,
          },
        };
        if (agents.length === 1 && `${agents[0].resourceId}` !== `${agentId}`) {
          // 当前输入框不是同一个数字员工，想要粘贴的话，就要切换
          schema.agentId = agents[0].resourceId;
          EventEmitter.emit('queryInput-set-schema', schema);
          return;
        }

        if (agentId) {
          // 如果当前是专家模式，做一个防御措施，将nodes中的所有数字员工类型的节点去掉（理论上不会存在这种情况）
          nodes = nodes.filter((element: any) => {
            if (isMentionElement(element) && element.resourceType === ResourceType.digitalEmployee) {
              return false;
            }
            return true;
          });
        }
        Transforms.insertNodes(editor, nodes);
      } catch (error) {
        console.error(error);
      }
    },
    [chatMode, editor, agentId, EventEmitter]
  );

  const pasteFiles = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (typeof onPasteFiles === 'function' && items) {
        const files: File[] = [];
        Array.from(items).forEach((item) => {
          console.log(item.kind, item.type);
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          } else if (item.type === 'application/x-byai-slate') {
            e.preventDefault();
            item.getAsString((str) => {
              parseSlate(str);
            });
          }
        });
        if (files.length > 0) {
          e.preventDefault();
          onPasteFiles(files);
        }
      }
    },
    [onPasteFiles, parseSlate]
  );

  return pasteFiles;
}
