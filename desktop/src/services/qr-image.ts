import { PNG } from 'pngjs'
import jsQR from 'jsqr'
import { ServiceError, parseQr } from './riot'
export function decodeQrImage(bytes: Buffer): string {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new ServiceError('The capture is not a PNG image.')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > 40000000) throw new ServiceError('The capture is too large. Select only the QR code.')
  const png = PNG.sync.read(bytes)
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  if (!result) throw new ServiceError('No QR code found. Capture the QR code again, or paste its URL.')
  parseQr(result.data)
  return result.data
}
