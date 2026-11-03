export type ImageType = "png" | "jpeg" | "webp" | "gif";
export interface ImageInfo { type: ImageType; width: number; height: number }

export const CONTENT_TYPE: Record<ImageType, string> = {
  png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

/** 讀檔頭取得真實格式與尺寸（不信任副檔名與前端宣告值）；解析失敗回傳 null。 */
export function probeImage(b: Buffer): ImageInfo | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR")
    return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };

  if (b.length >= 10 && b.toString("ascii", 0, 4) === "GIF8")
    return { type: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };

  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: "jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }

  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = b.toString("ascii", 12, 16);
    if (fourcc === "VP8 ") return { type: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (fourcc === "VP8L" && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X")
      return { type: "webp", width: (b.readUIntLE(24, 3)) + 1, height: (b.readUIntLE(27, 3)) + 1 };
  }
  return null;
}
