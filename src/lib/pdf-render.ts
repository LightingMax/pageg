import type { PDFPageProxy } from "pdfjs-dist";

export function deviceScale() {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
}

export function startPaint(page: PDFPageProxy, canvas: HTMLCanvasElement, cssScale: number) {
  const dpr = deviceScale();
  const viewport = page.getViewport({ scale: cssScale });
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }
  const task = page.render({
    canvasContext: ctx ?? undefined,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
    canvas,
    intent: "display",
  });
  return { viewport, task };
}
