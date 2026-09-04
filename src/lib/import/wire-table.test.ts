import { describe, expect, it } from "vitest";
import { parseWireTable } from "./wire-table";

// Every fixture below is the shape of a real wire-instructions email, kept
// verbatim down to the wrapping, because the wrapping is what broke the naive
// column-index reading.

describe("parseWireTable", () => {
  it("reads a table whose row matches the header column for column", () => {
    const table = parseWireTable(
      [
        "Please wire your commitment by EOD NYC-time on *August 11th, 2026 *",
        "",
        "Name Commitment Legal Fees Admin Fees Total (USD)",
        "Bryan Zhang $2,000 $189 0 $2,189",
      ].join("\n"),
    );

    expect(table).toEqual({
      commitment: 2000,
      fees: 189,
      total: 2189,
      sourceQuote: "Bryan Zhang $2,000 $189 0 $2,189",
    });
  });

  it("reads a table with no admin fee column", () => {
    const table = parseWireTable(
      ["Name Commitment Legal Fees Total (USD)", "Bryan Zhang $3,000.0 $283.5 $3,283.5"].join("\n"),
    );

    expect(table?.commitment).toBe(3000);
    expect(table?.fees).toBe(283.5);
    expect(table?.total).toBe(3283.5);
  });

  it("reads a row that omits a column the header declares", () => {
    // The header names four money columns and the row carries three: the admin
    // fee was left blank rather than written as zero. Mapping by index here
    // would call $121 the commitment.
    const table = parseWireTable(
      [
        "Email Address Name Commitment Legal Fees Admin Fees Total",
        "bzhang93@gmail.com",
        "Bryan Zhang $2,000 $121.00 $2,121",
      ].join("\n"),
    );

    expect(table?.commitment).toBe(2000);
    expect(table?.fees).toBe(121);
  });

  it("refuses a row that does not add up", () => {
    expect(
      parseWireTable(
        ["Name Commitment Legal Fees Total (USD)", "Bryan Zhang $2,000 $189 $9,400"].join("\n"),
      ),
    ).toBeNull();
  });

  it("ignores prose that talks about commitments and fees", () => {
    expect(
      parseWireTable(
        [
          "The pro rated legal fees are at 9.9%. For example, if you committed $5,000,",
          "you'll need to wire in $5,495.",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("picks the reader's row out of a table listing several investors", () => {
    const table = parseWireTable(
      [
        "Name Commitment Legal Fees Total (USD)",
        "Dana Okonkwo $10,000 $945 $10,945",
        "Bryan Zhang $2,000 $189 $2,189",
      ].join("\n"),
      ["Bryan Zhang"],
    );

    expect(table?.commitment).toBe(2000);
  });

  it("refuses a multi-row table when it cannot tell which row is the reader's", () => {
    expect(
      parseWireTable(
        [
          "Name Commitment Legal Fees Total (USD)",
          "Dana Okonkwo $10,000 $945 $10,945",
          "Bryan Zhang $2,000 $189 $2,189",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("refuses a fee larger than the investment it sits on", () => {
    expect(
      parseWireTable(
        ["Name Commitment Legal Fees Total (USD)", "Bryan Zhang $1,000 $4,000 $5,000"].join("\n"),
      ),
    ).toBeNull();
  });

  it("returns null when there is no table at all", () => {
    expect(parseWireTable("Just a reminder to send this by tomorrow :)")).toBeNull();
  });
});
