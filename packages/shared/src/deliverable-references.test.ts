import { describe, expect, it } from "vitest";
import {
  buildDeliverableReferenceHref,
  parseDeliverableReferenceHref,
} from "./deliverable-references.js";

describe("deliverable references", () => {
  it("parses company-relative and absolute deliverable detail links", () => {
    expect(parseDeliverableReferenceHref("/deliverables/deliverable-123")).toEqual({
      deliverableId: "deliverable-123",
    });
    expect(parseDeliverableReferenceHref("/PAP/deliverables/deliverable-456")).toEqual({
      deliverableId: "deliverable-456",
    });
    expect(
      parseDeliverableReferenceHref("https://paperclip.ing/PAP/deliverables/deliverable-789#preview"),
    ).toEqual({
      deliverableId: "deliverable-789",
    });
    expect(parseDeliverableReferenceHref("https://paperclip.ing/projects/deliverable-789")).toBeNull();
  });

  it("builds company-relative deliverable detail links", () => {
    expect(buildDeliverableReferenceHref("deliverable-123")).toBe("/deliverables/deliverable-123");
  });
});
