import { describe, expect, it } from "vitest";
import { spokenPhone } from "@/lib/digits";
import { translateShoppingTerms } from "@/modules/catalog/query-terms";

describe("phone numbers as heard by speech recognition", () => {
  it("turns spoken digit words into a number", () => {
    expect(spokenPhone("জিরো ওয়ান 794283380")).toBe("01794283380");
    expect(spokenPhone("শূন্য এক ৭৯৪২৮৩৩৮০")).toBe("01794283380");
    expect(spokenPhone("zero one seven nine four 283380")).toBe("01794283380");
    expect(spokenPhone("+880 1712-345678")).toBe("+8801712345678");
  });

  it("leaves text that isn't a phone number alone", () => {
    expect(spokenPhone("জানি না")).toBe("জানি না");
  });
});

describe("Bangla shopping words", () => {
  it("maps to the catalog's English terms", () => {
    expect(translateShoppingTerms("ব্যাগ আর জামা")).toBe("bag clothing");
    expect(translateShoppingTerms("ঘড়ি লাগবে")).toBe("watch");
    expect(translateShoppingTerms("কাপড়")).toBe("clothing");
    expect(translateShoppingTerms("hello")).toBe("");
  });
});

describe("finding a phone number in a sentence", () => {
  it("picks the mobile number out of what the customer said", async () => {
    const { findPhoneNumber, isBdMobile } = await import("@/lib/digits");
    expect(findPhoneNumber("কারণ হচ্ছে আল ইমরান হোসেন আর ফোন নম্বর হচ্ছে জিরো ওয়ান 794283380।")).toBe("01794283380");
    expect(findPhoneNumber("my number is 017 1234 5678")).toBe("01712345678");
    expect(findPhoneNumber("I want 2 bags for 2500 taka")).toBeNull();
    expect(isBdMobile("জিরো ওয়ান 794283380")).toBe(true);
    expect(isBdMobile("12345")).toBe(false);
  });
});

describe("repeated digits", () => {
  it("understands double and triple", async () => {
    const { findPhoneNumber, spokenPhone } = await import("@/lib/digits");
    expect(
      findPhoneNumber("নাম হচ্ছে আল ইমরান এবং ফোন হচ্ছে জিরো ওয়ান সেভেন নাইন ফোর টু এইট ডাবল থ্রি এইট জিরো।"),
    ).toBe("01794283380");
    expect(spokenPhone("zero one seven triple five 12345")).toBe("01755512345");
  });
});
