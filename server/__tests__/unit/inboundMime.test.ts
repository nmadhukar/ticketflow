import { decodeEncodedWords, parseAddress, parseEmail } from "../../services/email/mime";

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

describe("parseAddress", () => {
  it("reads the mailbox out of common From shapes", () => {
    expect(parseAddress("Ann Lee <ann@example.test>")).toBe("ann@example.test");
    expect(parseAddress('"Lee, Ann" <Ann@Example.test>')).toBe("Ann@Example.test");
    expect(parseAddress("ann@example.test")).toBe("ann@example.test");
    expect(parseAddress("=?UTF-8?Q?Andr=C3=A9?= <andre@example.test>")).toBe("andre@example.test");
    expect(parseAddress("no address here")).toBeNull();
    expect(parseAddress(undefined)).toBeNull();
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
