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

  it("never lets a display name smuggle an address: encoded words are not decoded", () => {
    const encoded = `=?UTF-8?B?${Buffer.from("<admin@company.test>").toString("base64")}?=`;
    expect(parseSingleMailbox(`${encoded} <mallory@attacker.test>`)).toBe("mallory@attacker.test");
  });

  it.each([
    '"<mallory@attacker.test>" <admin@company.test>',
    '"<admin@company.test>" <mallory@attacker.test>',
    '"admin@company.test" <mallory@attacker.test>',
    "(\\) <mallory@attacker.test>) <admin@company.test>",
    "admin@company.test (<mallory@attacker.test>)",
    "mallory@attacker.test (<admin@company.test>)",
    "mallory@attacker.test (admin@company.test)",
    '"a>b" <mallory@attacker.test>',
    '"a\\"b" <mallory@attacker.test>',
    "Ann \\(x <ann@example.test>",
  ])("refuses a quote or comment holding a bracket or address, and any backslash: %s", (value) => {
    expect(parseSingleMailbox(value)).toBeNull();
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
    // A quoted string anywhere in a bare address, and a backslash outside quotes and comments.
    '"x"admin@company.test',
    'admin"@attacker.test"@company.test',
    'admin@company.test"@attacker.test"',
    '\\"<mallory@attacker.test>" <admin@company.test>',
    "Ann\\ <ann@example.test>",
    "Ann [x] <ann@example.test>",
  ])("refuses an ambiguous or malformed header: %s", (value) => {
    expect(parseSingleMailbox(value)).toBeNull();
  });

  it("accepts quoted and encoded display names that contain a comma or non-ASCII text", () => {
    expect(parseSingleMailbox('"Müller, Hans" <h@example.test>')).toBe("h@example.test");
    expect(parseSingleMailbox("=?iso-8859-1?Q?M=FCller=2C_Hans?= <h@example.test>")).toBe("h@example.test");
    expect(parseSingleMailbox("Müller Hans <h@example.test>")).toBe("h@example.test");
    // Unquoted with a literal comma it reads as two mailboxes: refused (fail closed).
    expect(parseSingleMailbox("Müller, Hans <h@example.test>")).toBeNull();
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
    expect(spoof.fromAddress).toBeNull();
  });

  it("cuts a Subject over 2 KB before decoding it", () => {
    const mail = parseEmail(crlf([`Subject: ${"s".repeat(5000)}`, "From: a@b.test", "", "body"]));
    expect(mail.subject.length).toBe(2048);
  });
});

describe("parseEmail header block limits", () => {
  const padding = (n: number) => Array.from({ length: n }, (_, i) => `X-Pad-${i}: padding value`);

  it("refuses a header block over the cap instead of cutting it off (a second From hidden past 64 KB)", () => {
    const raw = crlf([
      "From: <admin@company.test>",
      ...padding(7000),
      "From: <mallory@attacker.test>",
      "Subject: x",
      "",
      "body",
    ]);
    expect(raw.length).toBeGreaterThan(130 * 1024);
    const mail = parseEmail(raw);
    expect(mail.refusal).toBe("header_too_large");
    expect(mail.fromAddress).toBeNull();
    expect(mail.text).toBe("");
  });

  it("reads a header block just under the cap and still sees a late second From", () => {
    const raw = crlf(["From: <a@b.test>", ...padding(2000), "From: <c@d.test>", "Subject: x", "", "body"]);
    expect(raw.length).toBeLessThan(64 * 1024);
    const mail = parseEmail(raw);
    expect(mail.refusal).toBeNull();
    expect(mail.duplicateFrom).toBe(true);
  });

  it("refuses a bare CR (a line break some readers honour and this one does not)", () => {
    const raw = "X-A: y\rFrom: <mallory@attacker.test>\r\nFrom: <admin@company.test>\r\nSubject: x\r\n\r\nbody";
    const mail = parseEmail(raw);
    expect(mail.refusal).toBe("header_malformed");
    expect(mail.fromAddress).toBeNull();
    // A CRLF pair is still an ordinary line break.
    expect(parseEmail("From: <a@b.test>\r\nSubject: x\r\n\r\nbody").refusal).toBeNull();
  });

  it("refuses a header block that mixes CRLF and bare LF, however the separator is written", () => {
    const attacks = [
      "From: <admin@company.test>\r\nX-A: y\n\r\nFrom: <mallory@attacker.test>\r\n\r\nb",
      "From: <admin@company.test>\r\n\nFrom: <mallory@attacker.test>\r\n\r\nb",
      "From: <admin@company.test>\nX-A: y\r\n\nb",
    ];
    for (const raw of attacks) {
      const mail = parseEmail(raw);
      expect([raw, mail.refusal]).toEqual([raw, "header_malformed"]);
      expect(mail.fromAddress).toBeNull();
    }
  });

  it("still accepts all-LF and all-CRLF mail, and mixed endings after the headers", () => {
    for (const raw of [
      "From: <a@b.test>\nSubject: x\n\nbody\nmore",
      "From: <a@b.test>\r\nSubject: x\r\n\r\nbody\r\nmore",
      "From: <a@b.test>\r\nSubject: x\r\n\r\nbody\nmixed\r\nin the body",
    ]) {
      const mail = parseEmail(raw);
      expect([raw, mail.refusal, mail.fromAddress]).toEqual([raw, null, "a@b.test"]);
    }
  });

  it("refuses a NUL in the header block", () => {
    const mail = parseEmail(crlf(["From: <a@b.test>", "X-A: y\u0000z", "", "body"]));
    expect(mail.refusal).toBe("header_malformed");
  });

  it("counts From lines over the whole block, case-insensitively and with a space before the colon", () => {
    expect(parseEmail(crlf(["From: <a@b.test>", "FROM: <c@d.test>", "", "x"])).duplicateFrom).toBe(true);
    expect(parseEmail(crlf(["From: <a@b.test>", "from : <c@d.test>", "", "x"])).duplicateFrom).toBe(true);
    // A folded continuation line is part of the previous header, not a second From.
    expect(parseEmail(crlf(["From: <a@b.test>", "X-A: y", " From: <c@d.test>", "", "x"])).duplicateFrom).toBe(false);
  });
});

describe("parseSingleMailbox on adversarial input just under the 2 KB cap", () => {
  it.each(["a", "<", '"', "(", "\\", "a ", "<a", '"a', "(a", ",", "a@"])("is fast for repeats of %j", (unit) => {
    const value = unit.repeat(Math.floor(2000 / unit.length));
    const start = Date.now();
    expect(parseSingleMailbox(value)).toBeNull();
    expect(Date.now() - start).toBeLessThan(250);
  });
});

describe("parseEmail on adversarial input (linear time)", () => {
  const SIZE = 150 * 1024;
  const BOUND_MS = 250; // the real cost is a few ms
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

  // These stay under both caps (2 KB for From, 64 KB for the header block) and assert the message
  // was really read (refusal === null), so the tokeniser and decoders run on the hostile text.
  it("a From header with no '@', with many '<', with many quotes and with many comments", () => {
    for (const from of ["a".repeat(2000), "<".repeat(2000), '"'.repeat(2000), "(".repeat(2000), "a ".repeat(1000)]) {
      const { ms, mail } = timed(crlf([`From: ${from}`, "Subject: x", "", "body"]));
      expect(mail.refusal).toBeNull();
      expect(ms).toBeLessThan(BOUND_MS);
      expect(mail.fromAddress).toBeNull();
    }
  });

  it("a 60 KB Subject full of encoded-word starts, and a 60 KB header block", () => {
    const subject = timed(crlf([`Subject: ${"=?a?b?".repeat(10 * 1024)}`, "From: a@b.test", "", "x"]));
    expect(subject.mail.refusal).toBeNull();
    expect(subject.mail.fromAddress).toBe("a@b.test");
    expect(subject.mail.subject.length).toBeLessThanOrEqual(2048);
    expect(subject.ms).toBeLessThan(BOUND_MS);

    const lines = Array.from({ length: 5000 }, (_, i) => `X-H${i}: y`);
    const raw = crlf([...lines, "From: a@b.test", "", "x"]);
    expect(raw.length).toBeLessThan(64 * 1024);
    expect(raw.length).toBeGreaterThan(50 * 1024);
    const block = timed(raw);
    expect(block.mail.refusal).toBeNull();
    expect(block.mail.fromAddress).toBe("a@b.test");
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
