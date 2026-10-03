import { jest } from "@jest/globals";
import { inspect } from "util";

const TOKEN = "SECRET-RESET-TOKEN-abc123";
const BODY = JSON.stringify({ html: `https://app.test/auth?mode=reset&token=${TOKEN}` });

function failure() {
  // Shape of MailtrapError({ cause: AxiosError }): the request body sits in cause.config.data.
  const err: any = new Error("Request failed with status code 401");
  err.cause = { message: "axios", config: { data: BODY }, response: { status: 401, config: { data: BODY } } };
  err.config = { data: BODY };
  return err;
}

jest.mock("mailtrap", () => ({
  MailtrapClient: class {
    async send() {
      throw failure();
    }
  },
}));
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    async send() {
      throw failure();
    }
  },
  SendEmailCommand: class {},
}));

function loggedText(): string {
  const parts: string[] = [];
  for (const fn of ["log", "info", "warn", "error", "debug"] as const) {
    const mock = console[fn] as unknown as jest.Mock;
    for (const call of mock.mock?.calls ?? []) {
      parts.push(
        call.map((a: unknown) => (typeof a === "string" ? a : inspect(a, { depth: 10, showHidden: true }))).join(" ")
      );
    }
  }
  return parts.join("\n");
}

describe("email send failures do not log the request body", () => {
  it("Mailtrap sendEmail and sendTestEmail", async () => {
    const mt = await import("../../services/mailtrap");
    const ok = await mt.sendEmail({ to: "a@b.test", from: "f@b.test", fromName: "F", subject: "s", html: BODY, mailtrapToken: "t" });
    expect(ok).toBe(false);
    const t = (mt as any).sendTestEmail;
    if (t) await t("a@b.test", "f@b.test", "F", "t").catch(() => {});
    const text = loggedText();
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("401");
  });

  it("SES sendEmail", async () => {
    const ses = await import("../../services/ses");
    const ok = await ses.sendEmail({ to: "a@b.test", from: "f@b.test", subject: "s", html: BODY, awsAccessKeyId: "k", awsSecretAccessKey: "s" });
    expect(ok).toBe(false);
    expect(loggedText()).not.toContain(TOKEN);
    // Positive: the failure is still reported, with its status.
    expect(loggedText()).toContain("AWS SES email error");
    expect(loggedText()).toContain("401");
  });
});

describe("safeErrorSummary", () => {
  it("keeps an AWS-style error name and says what kind of value a non-Error was", async () => {
    const { safeErrorSummary } = await import("../../utils/safeError");
    const aws: any = new Error("Email address is not verified.");
    aws.name = "MessageRejected";
    aws.$metadata = { httpStatusCode: 400 };
    expect(safeErrorSummary(aws)).toBe("MessageRejected: Email address is not verified. (HTTP 400)");
    expect(safeErrorSummary(new Error("boom"))).toBe("boom");
    expect(safeErrorSummary("secret-token-in-a-string")).toBe("non-Error value thrown (string)");
    expect(safeErrorSummary(null)).toBe("non-Error value thrown (null)");
    expect(safeErrorSummary({ config: { data: TOKEN } })).not.toContain(TOKEN);
  });
});
