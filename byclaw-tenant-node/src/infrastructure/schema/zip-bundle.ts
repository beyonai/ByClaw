import yauzl from "yauzl";
import { crc32 } from "node:zlib";
import { DomainError } from "../../domain/errors.js";

const maxBytes = 32 * 1024 * 1024;
/** 在内存中读取 ZIP；限制条目和解压总量，拒绝越界路径、重复名、链接及 CRC 不符。 */
export async function unzipBundle(bytes: Uint8Array): Promise<Map<string, Buffer>> {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new DomainError("INVALID_BUNDLE_SIZE");
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(new DomainError("INVALID_BUNDLE"));
        const entries = new Map<string, Buffer>();
        let total = 0,
          count = 0;
        const fail = (code: string) => {
          zip.close();
          reject(new DomainError(code));
        };
        zip.on("error", () => fail("INVALID_BUNDLE"));
        zip.on("end", () => resolve(entries));
        zip.on("entry", (entry: yauzl.Entry) => {
          const path = entry.fileName,
            mode = entry.externalFileAttributes >>> 16;
          total += entry.uncompressedSize;
          count++;
          if (
            count > 64 ||
            path.split("/").some((part) => part === "." || part === "..") ||
            total > maxBytes ||
            entries.has(path) ||
            (mode & 0xf000) === 0xa000 ||
            entry.isEncrypted() ||
            !/^(?:baseline|versions)\/[A-Za-z0-9_.-]+\/(?:manifest\.json|__ddl\.sql)$/.test(path)
          )
            return fail("INVALID_BUNDLE_ENTRY");
          zip.openReadStream(entry, (readError, stream) => {
            if (readError || !stream) return fail("INVALID_BUNDLE");
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > entry.uncompressedSize || size > maxBytes) {
                stream.destroy();
                fail("INVALID_BUNDLE_SIZE");
              } else chunks.push(chunk);
            });
            stream.on("error", () => fail("INVALID_BUNDLE"));
            stream.on("end", () => {
              const content = Buffer.concat(chunks);
              if (size !== entry.uncompressedSize || crc32(content) !== entry.crc32)
                return fail("INVALID_BUNDLE");
              entries.set(path, content);
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
