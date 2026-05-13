import { isFunction, get } from 'lodash';
// @ts-ignore
import { getIntl } from '@umijs/max';

import { enumerateMicrophones } from './util';

type IEVENT = 'inited' | 'recording' | 'connecting' | 'disconnected' | 'error';

export type IRecognizedVal = string;

interface Props {
  onRecognized: (value: IRecognizedVal) => void;
}

type STTEventHandler = (...args: any[]) => void;

class BaseSTTHandler<P = Record<string, never>> {
  props: Props & P;

  audioList: MediaDeviceInfo[] = [];

  eventMap: Map<IEVENT, Set<STTEventHandler>> = new Map();

  microphoneSource: string | undefined = undefined;

  constructor(props: Props & P) {
    this.props = props;
  }

  on(eventName: IEVENT, event: (...args: any) => void) {
    if (!eventName || !isFunction(event)) {
      return this;
    }

    let curEventSet;

    if (this.eventMap.has(eventName)) {
      curEventSet = this.eventMap.get(eventName);
    } else {
      curEventSet = new Set<STTEventHandler>();
      this.eventMap.set(eventName, curEventSet);
    }

    if (curEventSet) {
      curEventSet.add(event);
    }
    return this;
  }

  off(eventName: IEVENT, event: (...args: any) => void) {
    if (!this.eventMap.has(eventName) || !event) {
      return this;
    }

    let curEventSet;

    if (this.eventMap.has(eventName)) {
      curEventSet = this.eventMap.get(eventName);
    }

    if (curEventSet) {
      curEventSet.delete(event);
    }
    return this;
  }

  dispatch(eventName: IEVENT, ...args: any) {
    if (!this.eventMap.has(eventName)) {
      return this;
    }

    [...(this.eventMap.get(eventName) || [])].forEach((event) => {
      // event.call(this, ...args)

      event(...args);
    });

    return true;
  }

  offAllEvent() {
    [...this.eventMap.values()].forEach((eventSet) => {
      eventSet.clear();
    });

    this.eventMap.clear();
  }

  initConnect() {
    try {
      this.dispatch('connecting');

      return Promise.all(this.initQueue())
        .then(() => {
          this.dispatch('inited');
          return Promise.resolve();
        })
        .catch((e) => {
          this.dispatch('disconnected');
          const intl = getIntl();
          return Promise.reject(e || intl.formatMessage({ id: 'common.microphoneConnectionFailed' }));
        })
        .finally(() => {
          this.microphoneSource = get(this.audioList, '0.deviceId');
        });
    } catch (e) {
      console.error('initConnect error:', e);
    }

    return null;
  }

  initQueue(): Array<Promise<unknown>> {
    return [this.getMicrophones()];
  }

  getMicrophones(): Promise<MediaDeviceInfo[]> {
    return new Promise((resolve, reject) => {
      enumerateMicrophones()
        .then((audioMedias) => {
          this.audioList = audioMedias;

          resolve(audioMedias);
        })
        .catch((err) => {
          console.error('getMicrophones:', err);

          this.dispatch('disconnected');
          const intl = getIntl();
          reject(new Error(intl.formatMessage({ id: 'common.getMicrophonesFail' })));
        });
    });
  }

  connectToService(): boolean {
    return false;
  }

  disconnectToService(): void {}

  pauseToService(): boolean {
    return true;
  }
}

export default BaseSTTHandler;
