import { describe, expect, it } from "vitest";
import { isNoiseTranscript } from "@/modules/speech/echo";

describe("noise and echo transcripts", () => {
  it("drops the phantom lines from the customer complaint", () => {
    // Saved as "customer" lines in conversation …d653, none of them said by the customer.
    for (const phantom of ["¿Cuál", "¿Qué", "¿Qué? ¿Qué? ¿Qué?", "de", "A", "la", "y", "Pai", "de la chaise", "la acción de", "Voy a aceptar el usuario", "जी", ""]) {
      expect(isNoiseTranscript(phantom), phantom).toBe(true);
    }
  });

  it("keeps real answers, however short", () => {
    for (const real of [
      "হ্যাঁ",
      "না",
      "হ্যাঁ, বলো।",
      "ok",
      "Large",
      "01796444356",
      "Mirpur 1200, Dhaka",
      "ki ki product ache?",
      "Acha cotton kurti dekhna chahti",
      "Koto taka mot?",
      "I want a bag",
      "Show me leather sandals in size 42",
      "A 3/4 Roshan Manzil, Sector 2, Road Number 2, Mirpur 2, Dhaka 1202",
      "hello",
    ]) {
      expect(isNoiseTranscript(real), real).toBe(false);
    }
  });
});
