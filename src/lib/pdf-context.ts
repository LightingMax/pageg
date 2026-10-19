import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DocumentContext } from "./types";
import {
  cleanExtractedPages,
  DOCUMENT_CONTEXT_VERSION,
  textItemsToLines,
  validDocumentContext,
  type TextPiece,
} from "./pdf-context-core";

export { cleanExtractedPages, DOCUMENT_CONTEXT_VERSION, textItemsToLines, validDocumentContext } from "./pdf-context-core";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractDocumentContext(
  buffer: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<DocumentContext> {
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await task.promise;
  try {
    const rawPages: Array<{ page: number; lines: string[] }> = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      rawPages.push({ page: pageNumber, lines: textItemsToLines(content.items as TextPiece[]) });
      page.cleanup();
      onProgress?.(pageNumber, pdf.numPages);
    }
    return {
      version: DOCUMENT_CONTEXT_VERSION,
      pageCount: pdf.numPages,
      extractedAt: new Date().toISOString(),
      pages: cleanExtractedPages(rawPages),
    };
  } finally {
    await task.destroy();
  }
}
