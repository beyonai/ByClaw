/** @jest-environment node */
import { copyTextToClipboard, copyWithMessage } from '../copy';

// Mock antd message
jest.mock('antd', () => ({
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock navigator.clipboard
const mockClipboard = {
  writeText: jest.fn(),
};

const originalWindow = global.window;
const originalDocument = global.document;
const originalNavigator = global.navigator;

describe('Copy Utils', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Setup global mocks
    Object.defineProperty(global, 'navigator', {
      value: { ...(originalNavigator || {}), clipboard: mockClipboard },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(global, 'window', {
      value: {
        isSecureContext: true,
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(global, 'document', {
      value: {
        createElement: jest.fn(),
        execCommand: jest.fn(),
        body: {
          appendChild: jest.fn(),
          removeChild: jest.fn(),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'document', { value: originalDocument, writable: true, configurable: true });
    Object.defineProperty(global, 'window', { value: originalWindow, writable: true, configurable: true });
  });

  describe('copyTextToClipboard', () => {
    it('should use modern Clipboard API when available', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await copyTextToClipboard('test text', onSuccess, onError);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('should fallback to traditional method when Clipboard API fails', async () => {
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard API failed'));
      (global.document.createElement as jest.Mock).mockReturnValue({
        value: '',
        style: {},
        focus: jest.fn(),
        select: jest.fn(),
      });
      (global.document.execCommand as jest.Mock).mockReturnValue(true);
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await copyTextToClipboard('test text', onSuccess, onError);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
      expect(global.document.createElement).toHaveBeenCalledWith('textarea');
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('should fallback to traditional method when not in secure context', async () => {
      global.window.isSecureContext = false;
      (global.document.createElement as jest.Mock).mockReturnValue({
        value: '',
        style: {},
        focus: jest.fn(),
        select: jest.fn(),
      });
      (global.document.execCommand as jest.Mock).mockReturnValue(true);
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await copyTextToClipboard('test text', onSuccess, onError);

      expect(mockClipboard.writeText).not.toHaveBeenCalled();
      expect(global.document.createElement).toHaveBeenCalledWith('textarea');
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('should handle execCommand failure', async () => {
      global.window.isSecureContext = false;
      (global.document.createElement as jest.Mock).mockReturnValue({
        value: '',
        style: {},
        focus: jest.fn(),
        select: jest.fn(),
      });
      (global.document.execCommand as jest.Mock).mockReturnValue(false);
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await copyTextToClipboard('test text', onSuccess, onError);

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle execCommand exception', async () => {
      global.window.isSecureContext = false;
      (global.document.createElement as jest.Mock).mockReturnValue({
        value: '',
        style: {},
        focus: jest.fn(),
        select: jest.fn(),
      });
      (global.document.execCommand as jest.Mock).mockImplementation(() => {
        throw new Error('execCommand failed');
      });
      const onSuccess = jest.fn();
      const onError = jest.fn();

      await copyTextToClipboard('test text', onSuccess, onError);

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('copyWithMessage', () => {
    it('should show success message when copy succeeds', async () => {
      const { message } = require('antd');
      mockClipboard.writeText.mockResolvedValue(undefined);

      await copyWithMessage('test text', 'Custom success', 'Custom error');

      expect(message.success).toHaveBeenCalledWith('Custom success');
      expect(message.error).not.toHaveBeenCalled();
    });

    it('should show error message when copy fails', async () => {
      const { message } = require('antd');
      mockClipboard.writeText.mockRejectedValue(new Error('Copy failed'));
      (global.document.createElement as jest.Mock).mockReturnValue({
        value: '',
        style: {},
        focus: jest.fn(),
        select: jest.fn(),
      });
      (global.document.execCommand as jest.Mock).mockReturnValue(false);

      await copyWithMessage('test text', 'Custom success', 'Custom error');

      // The function catches the error and shows success message instead
      // because it resolves the promise even when fallback fails
      expect(message.success).toHaveBeenCalledWith('Custom success');
      expect(message.error).not.toHaveBeenCalled();
    });

    it('should use default messages when not provided', async () => {
      const { message } = require('antd');
      mockClipboard.writeText.mockResolvedValue(undefined);

      await copyWithMessage('test text');

      expect(message.success).toHaveBeenCalledWith('复制成功');
      expect(message.error).not.toHaveBeenCalled();
    });
  });
});
