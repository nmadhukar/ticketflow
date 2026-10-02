import { decodeEncodedWords, parseEmail, parseSingleMailbox } from "../../services/email/mime";

const crlf = (lines: string[]) => lines.join("\r\n");

describe("decodeEncodedWords", () => {
  it("decodes B and Q words, joins adjacent words and keeps plain text", () => {
    expect(decodeEncodedWords("=?UTF-8?B?Q2Fmw6k=?=")).toBe("Café");
    expect(decodeEncodedWords("=?utf-8?Q?Caf=C3=A9_au_lait?=")).toBe("Café au lait");
    expect(decodeEncodedWords("=?UTF-8?Q?Hello_?= =?UTF-8?Q?World?=")).toBe("Hello World");
    expect(decodeEncodedWords("=?ISO-8859-1?Q?Andr=E9?= plain")).toBe("André plain");
    expect(decodeEncodedWords("Re: printer")).toBe("Re: printer");
  });
});

describe("parseSingleMailbox", () => {
  it("reads the mailbox out of common From shapes", () => {
    expect(parseSingleMailbox("Ann Lee <ann@example.test>")).toBe("ann@example.test");
    expect(parseSingleMailbox('"Lee, Ann" <Ann@Example.test>')).toBe("Ann@Example.test");
    expect(parseSingleMailbox("ann@example.test")).toBe("ann@example.test");
    expect(parseSingleMailbox("ann@example.test (Ann Lee)")).toBe("ann@example.test");
    expect(parseSingleMailbox("Ann (the (nested) one) <ann@example.test>")).toBe("ann@example.test");
    expect(parseSingleMailbox("=?UTF-8?Q?Andr=C3=A9?= <andre@example.test>")).toBe("andre@example.test");
    expect(parseSingleMailbox("<ann@example.test>")).toBe("ann@example.test");
    expect(parseSingleMailbox("Ann <ann@example.test>,")).toBe("ann@example.test");
  });

  it("takes the real mailbox, not an address smuggled into the display name", () => {
    // A quoted display name that looks like another address.
    expect(parseSingleMailbox('"<admin@company.test>" <mallory@attacker.test>')).toBe("mallory@attacker.test");
    expect(parseSingleMailbox('"admin@company.test" <mallory@attacker.test>')).toBe("mallory@attacker.test");
    // The same, base64 encoded: the display name is never decoded for an address.
    const encoded = `=?UTF-8?B?${Buffer.from("<admin@company.test>").toString("base64")}?=`;
    expect(parseSingleMailbox(`${encoded} <mallory@attacker.test>`)).toBe("mallory@attacker.test");
    // A comment that looks like an address.
    expect(parseSingleMailbox("mallory@attacker.test (<admin@company.test>)")).toBe("mallory@attacker.test");
  });

  it.each([
    "no address here",
    "",
    "a@b.test, c@d.test",
    "A <a@b.test>, C <c@d.test>",
    "admin@company.test <mallory@attacker.test>",
    "Group: a@b.test, c@d.test;",
    '"unterminated <a@b.test>',
    "Name (unterminated comment <a@b.test>",
    "Name <a@b.test",
    "Name a@b.test>",
    "<<a@b.test>>",
    '"quoted"@local.test',
    "<a@b.test> trailing <c@d.test>",
    "<a b@c.test>",
    "<a@b@c.test>",
    "=?UTF-8?B?YWRtaW5AY29tcGFueS50ZXN0?=",
  ])("refuses an ambiguous or malformed header: %s", (value) => {
    expect(parseSingleMailbox(value)).toBeNull();
  });

  it("refuses a header over 2 KB and an undefined one", () => {
    expect(parseSingleMailbox(`<${"a".repeat(3000)}@b.test>`)).toBeNull();
    expect(parseSingleMailbox(undefined)).toBeNull();
  });
});

describe("parseEmail sender handling", () => {
  it("reports a duplicate From header and refuses to read a sender from a spoofed one", () => {
    const dup = parseEmail(crlf(["From: a@b.test", "From: c@d.test", "Subject: x", "", "body"]));
    expect(dup.duplicateFrom).toBe(true);
    const spoof = parseEmail(crlf(['From: "<admin@company.test>" <mallory@attacker.test>', "Subject: x", "", "body"]));
    expect(spoof.fromAddress).toBe("mallory@attacker.test");
  });

  it("cuts a Subject over 2 KB before decoding it", () => {
    const mail = parseEmail(crlf([`Subject: ${"s".repeat(5000)}`, "From: a@b.test", "", "body"]));
    expect(mail.subject.length).toBe(2048);
  });
});

describe("parseEmail on adversarial input (linear time)", () => {
  const SIZE = 150 * 1024;
  const BOUND_MS = 1000; // the real cost is a few ms; loose enough for a busy CI box
  const timed = (raw: string) => {
    const start = Date.now();
    const mail = parseEmail(raw);
    return { ms: Date.now() - start, mail };
  };

  it("quoted-printable text full of trailing spaces", () => {
    const body = `${" ".repeat(SIZE)}x`; // a long run of spaces never followed by a newline
    const spaced = ("a" + " ".repeat(40) + "\r\n").repeat(Math.floor(SIZE / 43));
    for (const text of [body, spaced]) {
      const { ms } = timed(
        crlf(["From: a@b.test", "Content-Type: text/plain", "Content-Transfer-Encoding: quoted-printable", "", text])
      );
      expect(ms).toBeLessThan(BOUND_MS);
    }
  });

  it("html with many '<' and no '>', and many unclosed <script", () => {
    for (const html of ["<".repeat(SIZE), "<a".repeat(SIZE / 2), "<script ".repeat(SIZE / 8), "<style>".repeat(SIZE / 7)]) {
      const { ms } = timed(crlf(["From: a@b.test", "Content-Type: text/html", "", html]));
      expect(ms).toBeLessThan(BOUND_MS);
    }
  });

  it("a From header with no '@', with many '<', with many quotes and with many comments", () => {
    for (const from of ["a".repeat(SIZE), "<".repeat(SIZE), '"'.repeat(SIZE), "(".repeat(SIZE), "a ".repeat(SIZE / 2)]) {
      const { ms, mail } = timed(crlf([`From: ${from}`, "Subject: x", "", "body"]));
      expect(ms).toBeLessThan(BOUND_MS);
      expect(mail.fromAddress).toBeNull();
    }
  });

  it("a Subject full of encoded-word starts, and a huge header block", () => {
    const subject = timed(crlf([`Subject: ${"=?a?b?".repeat(SIZE / 6)}`, "From: a@b.test", "", "x"]));
    expect(subject.ms).toBeLessThan(BOUND_MS);
    const block = timed(crlf([...Array.from({ length: SIZE / 12 }, (_, i) => `X-H${i}: y`), "From: a@b.test", "", "x"]));
    expect(block.ms).toBeLessThan(BOUND_MS);
  });

  it("a multipart body with thousands of parts", () => {
    const parts = Array.from({ length: 5000 }, () => ["--b", "Content-Type: application/octet-stream", "", "zz"]).flat();
    const { ms } = timed(crlf(["From: a@b.test", 'Content-Type: multipart/mixed; boundary="b"', "", ...parts, "--b--"]));
    expect(ms).toBeLessThan(BOUND_MS);
  });
});

describe("parseEmail", () => {
  it("reads a single-part message with folded and encoded headers", () => {
    const mail = parseEmail(
      crlf([
        "From: Ann <ann@example.test>",
        "Subject: =?UTF-8?B?UHJpbnRlciBjYWbDqQ==?=",
        "  continued",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Line one",
        "Line two",
        "",
      ])
    );
    expect(mail.fromAddress).toBe("ann@example.test");
    expect(mail.subject).toBe("Printer café continued");
    expect(mail.text).toBe("Line one\nLine two");
  });

  it("decodes quoted-printable and base64 bodies in their charset", () => {
    const qp = parseEmail(
      crlf([
        "Subject: qp",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Caf=C3=A9 is a long=",
        " line",
      ])
    );
    expect(qp.text).toBe("Café is a long line");

    const b64 = parseEmail(
      crlf([
        "Subject: b64",
        "Content-Type: text/plain; charset=iso-8859-1",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("Andr\xe9", "latin1").toString("base64"),
      ])
    );
    expect(b64.text).toBe("André");
  });

  it("picks the text/plain part of nested multipart and skips attachments", () => {
    const mail = parseEmail(
      crlf([
        "Subject: nested",
        'Content-Type: multipart/mixed; boundary="outer"',
        "",
        "preamble that is not a part",
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "the plain body",
        "--inner",
        "Content-Type: text/html",
        "",
        "<p>the html body</p>",
        "--inner--",
        "--outer",
        "Content-Type: text/plain; name=notes.txt",
        "Content-Disposition: attachment; filename=notes.txt",
        "",
        "ATTACHMENT TEXT",
        "--outer--",
        "epilogue text",
      ])
    );
    expect(mail.text).toBe("the plain body");
  });

  it("falls back to the html part reduced to text when there is no text/plain", () => {
    const mail = parseEmail(
      crlf(["Subject: html only", "Content-Type: text/html; charset=utf-8", "", "<p>Hello <b>there</b></p><script>x()</script>"])
    );
    expect(mail.text).toBe("Hello there");
  });

  it("returns empty text and no sender for a message without either", () => {
    const mail = parseEmail(crlf(["Subject: nothing", "", ""]));
    expect(mail.text).toBe("");
    expect(mail.fromAddress).toBeNull();
  });
});
