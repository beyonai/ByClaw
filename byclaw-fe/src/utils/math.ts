import { customAlphabet } from 'nanoid';

export function getRandomNumber(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 生成唯一ID
export function generateUniqueId(size: number = 6) {
  return customAlphabet('abcdefghijklmnopqrstuvwxyz123456', size)();
}
