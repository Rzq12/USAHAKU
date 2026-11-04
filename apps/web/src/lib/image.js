const MAX_LONG_SIDE = 1600;
const JPEG_QUALITY = 0.82;

export function compressedSize(width, height) {
  const longSide = Math.max(width, height);
  if (longSide <= MAX_LONG_SIDE) return { width, height };
  const scale = MAX_LONG_SIDE / longSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Shrinks a receipt photo to at most 1600 px on the long side before upload. */
export async function compressReceipt(file) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = compressedSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  return new File([blob], 'struk.jpg', { type: 'image/jpeg' });
}
