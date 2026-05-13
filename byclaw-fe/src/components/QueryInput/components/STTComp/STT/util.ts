export const enumerateMicrophones = (): Promise<MediaDeviceInfo[]> =>
  new Promise((resolve, reject) => {
    if (!navigator || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.log('Unable to query for audio input devices. Default will be used.\r\n');
      resolve([]);
    }

    window.navigator.mediaDevices
      .getUserMedia({
        audio: true,
      })
      .then(() => {
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            const audioMedias = [];
            for (const device of devices) {
              if (device.kind === 'audioinput' && device.deviceId) {
                audioMedias.push(device);
              }
            }

            resolve(audioMedias);
          })
          .catch((err) => {
            console.error(err);
            reject(err);
          });
      })
      .catch((err) => {
        // 如果用户电脑没有麦克风设备或者用户拒绝了，或者连接出问题了等
        // 这里都会抛异常，并且通过err.name可以知道是哪种类型的错误
        console.error(err);
        reject(err);
      });
  });
