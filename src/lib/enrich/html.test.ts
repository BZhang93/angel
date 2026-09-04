import { describe, expect, it } from "vitest";
import { htmlToText, pageTitle } from "./html";
import { isPrivateAddress } from "./net-guard";

describe("htmlToText", () => {
  it("drops scripts, styles and chrome, keeping the prose", () => {
    const text = htmlToText(
      "<head><title>T</title></head><nav>Home About</nav><script>var x=1</script><style>p{}</style><p>ARR reached $1.2M this quarter.</p><footer>© Acme</footer>",
    );
    expect(text).toBe("ARR reached $1.2M this quarter.");
  });

  it("keeps paragraph breaks and decodes entities", () => {
    expect(htmlToText("<p>Runway &amp; burn</p><p>Next round</p>")).toBe("Runway & burn\nNext round");
  });

  it("truncates rather than returning an unbounded page", () => {
    const text = htmlToText(`<p>${"word ".repeat(50_000)}</p>`, { maxChars: 100 });
    expect(text.length).toBeLessThan(160);
    expect(text).toContain("[truncated]");
  });
});

describe("pageTitle", () => {
  it("reads the title when there is one", () => {
    expect(pageTitle("<html><head><title>Acme — Investment Memo</title></head></html>")).toBe(
      "Acme — Investment Memo",
    );
    expect(pageTitle("<html><body>no title</body></html>")).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("blocks loopback, private ranges and cloud metadata", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2600:1f16::1")).toBe(false);
  });
});
