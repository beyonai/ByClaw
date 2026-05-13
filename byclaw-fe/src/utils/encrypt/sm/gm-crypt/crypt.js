/* eslint-disable */

import base64js from 'base64-js';

const utf8Encodings = ['utf8', 'utf-8', 'unicode-1-1-utf-8'];

function MyTextEncoder(encoding) {
  if (utf8Encodings.indexOf(encoding) < 0 && typeof encoding !== 'undefined' && encoding != null) {
    throw new RangeError('Invalid encoding type. Only utf-8 is supported');
  } else {
    this.encoding = 'utf-8';
    this.encode = function (str) {
      if (typeof str !== 'string') {
        throw new TypeError('passed argument must be of tye string');
      }
      const binstr = unescape(encodeURIComponent(str));
      const arr = new Uint8Array(binstr.length);
      const split = binstr.split('');
      for (let i = 0; i < split.length; i++) {
        arr[i] = split[i].charCodeAt(0);
      }
      return arr;
    };
  }
}

function MyTextDecoder(encoding) {
  if (utf8Encodings.indexOf(encoding) < 0 && typeof encoding !== 'undefined' && encoding != null) {
    throw new RangeError('Invalid encoding type. Only utf-8 is supported');
  } else {
    this.encoding = 'utf-8';
    this.decode = function (view, options) {
      if (typeof view === 'undefined') {
        return '';
      }

      var stream = typeof options !== 'undefined' && stream in options ? options.stream : false;
      if (typeof stream !== 'boolean') {
        throw new TypeError('stream option must be boolean');
      }

      if (!ArrayBuffer.isView(view)) {
        throw new TypeError('passed argument must be an array buffer view');
      } else {
        const arr = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        const charArr = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
          charArr[i] = String.fromCharCode(arr[i]);
        }
        return decodeURIComponent(escape(charArr.join('')));
      }
    };
  }
}

class Crypt {
  /**
   * Converts a JS string to an UTF-8 uint8array.
   *
   * @static
   * @param {String} str 16-bit unicode string.
   * @return {Uint8Array} UTF-8 Uint8Array.
   * @memberof Crypt
   */
  static stringToArrayBufferInUtf8(str) {
    // if not browser env, then require node.js's util. otherwise just use window's
    const TextEncoder = window.TextEncoder ? window.TextEncoder : MyTextEncoder;
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  /**
   * Converts an UTF-8 uint8array to a JS string.
   *
   * @static
   * @param {Uint8Array} strBuffer UTF-8 Uint8Array.
   * @return {String} 16-bit unicode string.
   * @memberof Crypt
   */
  static utf8ArrayBufferToString(strBuffer) {
    // if not browser env, then require node.js's util. otherwise just use window's
    const TextDecoder = window.TextDecoder ? window.TextDecoder : MyTextDecoder;
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(strBuffer);
  }

  /**
   * crypt a utf8 byteArray to base64 string
   *
   * @static
   * @param {Uint8Array} strBuffer UTF-8 Uint8Array.
   * @returns {String} base64 str
   * @memberof Crypt
   */
  static arrayBufferToBase64(strBuffer) {
    return base64js.fromByteArray(strBuffer);
  }

  /**
   * crypt base64 stringa to utf8 byteArray
   *
   * @static
   * @param {String} base64 str
   * @returns {Uint8Array} strBuffer UTF-8 Uint8Array.
   * @memberof Crypt
   */
  static base64ToArrayBuffer(base64) {
    return base64js.toByteArray(base64);
  }
}

export default Crypt;
