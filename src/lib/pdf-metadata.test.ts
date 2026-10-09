import { beforeAll, describe, expect, it } from "vitest";
import type { deriveMetadata as deriveMetadataType } from "./pdf-metadata";

let deriveMetadata: typeof deriveMetadataType;

beforeAll(async () => {
  Object.assign(globalThis, { DOMMatrix: class DOMMatrix {} });
  ({ deriveMetadata } = await import("./pdf-metadata"));
});

describe("PDF metadata recognition", () => {
  it("prefers useful embedded metadata", () => {
    const result = deriveMetadata(
      { Title: "Memory in the Age of AI Agents", Author: "Yuyang Hu; Shichun Liu", CreationDate: "D:20260113", Subject: "doi:10.1234/agent.42" },
      [],
      "2512.13564v2.pdf",
      107,
      842,
    );
    expect(result.title).toBe("Memory in the Age of AI Agents");
    expect(result.authors).toEqual(["Yuyang Hu", "Shichun Liu"]);
    expect(result.year).toBe("2026");
    expect(result.doi).toBe("10.1234/agent.42");
  });

  it("infers a title from prominent first-page text when metadata is empty", () => {
    const result = deriveMetadata(
      {},
      [
        { text: "A Practical Guide to Local PDF Intelligence", y: 740, size: 24 },
        { text: "Ming Li, Ada Chen", y: 700, size: 12 },
        { text: "Department of Computer Science", y: 680, size: 10 },
      ],
      "paper-final-3.pdf",
      12,
      842,
    );
    expect(result.title).toBe("A Practical Guide to Local PDF Intelligence");
    expect(result.authors).toEqual(["Ming Li", "Ada Chen"]);
  });
});
