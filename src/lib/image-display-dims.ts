import imageSize from "image-size";

/**
 * Reads IFD entries for TIFF EXIF APP1 tag (JPEG). Returns undefined if absent.
 */
function jpegExifOrientation(buf: Buffer): number | undefined {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return undefined;

  let offset = 2;
  while (offset < buf.length - 4) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1]!;
    offset += 2;
    // Start of Scan — no more metadata segments in baseline path
    if (marker === 0xda) break;
    // Standalone markers without length
    if (
      marker === 0xd0 ||
      marker === 0xd1 ||
      marker === 0xd2 ||
      marker === 0xd3 ||
      marker === 0xd4 ||
      marker === 0xd5 ||
      marker === 0xd6 ||
      marker === 0xd7 ||
      marker === 0xd8 ||
      marker === 0xd9
    )
      continue;

    const len = buf.readUInt16BE(offset);
    if (len < 2 || offset + len > buf.length) break;
    const dataStart = offset + 2;
    const segmentEnd = offset + len;

    if (marker === 0xe1 && dataStart + 12 <= segmentEnd) {
      // APP1 EXIF
      if (
        buf[dataStart] === 0x45 &&
        buf[dataStart + 1] === 0x78 &&
        buf[dataStart + 2] === 0x69 &&
        buf[dataStart + 3] === 0x66 &&
        buf[dataStart + 4] === 0 &&
        buf[dataStart + 5] === 0
      ) {
        const orient = orientationFromExifTiff(buf, dataStart + 6);
        if (orient !== undefined) return orient;
      }
    }

    offset = segmentEnd;
  }

  return undefined;
}

function orientationFromExifTiff(buf: Buffer, tiff: number): number | undefined {
  if (tiff + 8 > buf.length) return undefined;
  const bom = buf.readUInt16BE(tiff);
  const le = bom === 0x4949;
  const be = bom === 0x4d4d;
  if (!le && !be) return undefined;

  const r16 = le
    ? (o: number) => buf.readUInt16LE(o)
    : (o: number) => buf.readUInt16BE(o);
  const r32 = le
    ? (o: number) => buf.readUInt32LE(o)
    : (o: number) => buf.readUInt32BE(o);

  const ifd0Off = r32(tiff + 4);
  const ifd0 = tiff + ifd0Off;
  if (ifd0 + 2 > buf.length) return undefined;
  const n = r16(ifd0);
  let p = ifd0 + 2;

  for (let i = 0; i < n; i++) {
    if (p + 12 > buf.length) return undefined;
    const tag = r16(p);
    const type = r16(p + 2);
    const count = r32(p + 4);

    // Orientation tag 0x0112, SHORT type 3, single value inlined in IFD slot
    if (tag === 0x0112 && type === 3 && count === 1) {
      return r16(p + 8);
    }

    if (tag === 0x0112 && type === 1 && count === 1) {
      return buf[p + 8]!;
    }

    p += 12;
  }

  return undefined;
}

/** EXIF Orientation 5–8 imply a 90°/270° step relative to raster storage → swap WxH for upright aspect. */
function dimensionsNeedSwap(exifOrientation: number | undefined): boolean {
  if (exifOrientation === undefined || exifOrientation === 1) return false;
  return exifOrientation === 5 || exifOrientation === 6 || exifOrientation === 7 || exifOrientation === 8;
}

/**
 * Raster pixel dimensions corrected for JPEG EXIF Orientation (common for camera roll images).
 * Other formats fall back to `image-size`; WebP may still report storage orientation only.
 */
export function displayPixelDimensions(buffer: Buffer): {
  width: number;
  height: number;
} {
  const raw = imageSize(buffer);
  const w = raw.width ?? 0;
  const h = raw.height ?? 0;
  const o = jpegExifOrientation(buffer);
  if (dimensionsNeedSwap(o)) {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}
