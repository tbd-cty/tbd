// image.js - Nén ảnh hóa đơn trước khi tải lên: cạnh dài tối đa 1600 px, JPEG chất lượng 0,72 (thường 150-400 KB, đủ đọc chữ).

const MAX_SIDE = 1600;
const QUALITY = 0.72;

export async function compressImage(file) {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return new Uint8Array(await file.arrayBuffer());                     // môi trường kiểm thử: giữ nguyên
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Không đọc được ảnh. Hãy chụp lại."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width, h = bitmap.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return new Uint8Array(await file.arrayBuffer());
  return new Uint8Array(await blob.arrayBuffer());
}
