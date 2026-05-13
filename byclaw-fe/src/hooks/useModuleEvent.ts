import { useCallback, useState } from 'react';
import { EventEmitter$Cls } from '@/utils/eventEmitter';

class MyEventEmitter extends EventEmitter$Cls {
  scopeId: string;

  originalEmit: (event: string, param: any) => void;

  constructor(scopeId?: string) {
    super();
    this.scopeId = scopeId || '';
    this.originalEmit = super.emit.bind(this);
  }

  /* 获取作用域ID */
  public getScopeId(): string {
    return this.scopeId;
  }

  /* 设置作用域ID */
  public setScopeId(scopeId: string): void {
    this.scopeId = scopeId;
  }
}

// 存储模块事件发射器的映射
const registeredModuleEvent: {
  [key: string]: {
    eventEmitters: Map<string, MyEventEmitter>;
    onlineCount: number;
  };
} = {};

export default function useModuleEvent(moduleName: string) {
  // 为每个组件实例生成唯一的ID
  const [instanceId] = useState(Math.random().toString(16).slice(2));

  const [moduleEventEmitter] = useState(() => {
    // 如果该模块名还没有注册过，则初始化
    if (!registeredModuleEvent[moduleName]) {
      registeredModuleEvent[moduleName] = {
        eventEmitters: new Map(),
        onlineCount: 0,
      };
    }

    // 创建新的事件发射器实例
    const myEventEmitter = new MyEventEmitter(instanceId);

    // 保存到映射中
    registeredModuleEvent[moduleName].eventEmitters.set(instanceId, myEventEmitter);
    registeredModuleEvent[moduleName].onlineCount += 1;

    myEventEmitter.emit = (event, param) => {
      // 获取同模块名下的所有其他事件发射器
      const emitters = registeredModuleEvent[moduleName]?.eventEmitters;

      // 遍历所有其他实例并触发事件
      emitters?.forEach((emitter, id) => {
        // 跳过自己
        if (id !== instanceId) {
          // 使用原始的 emit 方法触发事件，避免无限递归
          emitter.originalEmit.call(emitter, event, param);
        }
      });
    };

    return myEventEmitter;
  });

  // 注销模块事件
  const logoutModuleEvent = useCallback(() => {
    if (registeredModuleEvent[moduleName]) {
      // 从映射中删除当前实例
      registeredModuleEvent[moduleName].eventEmitters.delete(instanceId);
      registeredModuleEvent[moduleName].onlineCount -= 1;

      // 如果没有实例了，则删除整个模块记录
      if (registeredModuleEvent[moduleName].onlineCount <= 0) {
        delete registeredModuleEvent[moduleName];
      }
    }
  }, []);

  return {
    moduleEventEmitter,
    logoutModuleEvent,
  };
}
