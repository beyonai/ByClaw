import { DOWNLOAD_PATH, UPLOAD_PATH } from '../openClaw/const';

describe('utils/openClaw/const', () => {
  it('exports stable upload and download paths', () => {
    expect(UPLOAD_PATH).toBe('/openclaw/upload-file');
    expect(DOWNLOAD_PATH).toBe('/openclaw/download-file');
  });
});
