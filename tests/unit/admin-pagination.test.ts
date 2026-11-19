import { describe, expect, it } from "vitest";
import { pageNumbers, paginate } from "@/components/dashboard/AdminPagination";

describe("admin pagination", () => {
  it("works out the page, rows to skip and the range shown", () => {
    expect(paginate(undefined, 47, 20)).toEqual({ page: 1, pageCount: 3, skip: 0, from: 1, to: 20 });
    expect(paginate("3", 47, 20)).toEqual({ page: 3, pageCount: 3, skip: 40, from: 41, to: 47 });
  });

  it("clamps nonsense and out-of-range pages", () => {
    expect(paginate("99", 47, 20).page).toBe(3);
    expect(paginate("-4", 47, 20).page).toBe(1);
    expect(paginate("abc", 47, 20).page).toBe(1);
    expect(paginate("2", 0, 20)).toEqual({ page: 1, pageCount: 1, skip: 0, from: 0, to: 0 });
  });

  it("shows the first, last and nearby pages with gaps", () => {
    expect(pageNumbers(6, 20)).toEqual([1, "gap", 4, 5, 6, 7, 8, "gap", 20]);
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
  });
});
