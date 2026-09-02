export function fitZoom(imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number) {
  if (imageWidth <= 0 || imageHeight <= 0) return 100;
  const availableWidth = Math.max(1, viewportWidth - 84);
  const availableHeight = Math.max(1, viewportHeight - 122);
  const percent = Math.floor(Math.min(1, availableWidth / imageWidth, availableHeight / imageHeight) * 100);
  return Math.min(100, Math.max(10, percent));
}
