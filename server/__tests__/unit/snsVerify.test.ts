import {
  buildStringToSign,
  clearCertCache,
  isValidCertUrl,
  isValidSnsHost,
  verifySnsMessage,
  type SnsMessage,
} from "../../services/email/snsVerify";
import { createSnsTestSigner, generateKeyPairSync } from "../utils/snsTestSigner";

const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-unit.pem";

const notification: SnsMessage = {
  Type: "Notification",
  MessageId: "unit-message-1",
  TopicArn: "arn:aws:sns:us-east-1:111122223333:unit-topic",
  Subject: "Amazon SES Email Receipt Notification",
  Message: '{"notificationType":"Received"}',
  Timestamp: "2026-10-01T12:00:00.000Z",
  SigningCertURL: CERT_URL,
};

describe("isValidCertUrl", () => {
  it("accepts https sns.<region>.amazonaws.com .pem URLs", () => {
    expect(isValidCertUrl(CERT_URL)).toBe(true);
    expect(isValidCertUrl("https://sns.eu-west-2.amazonaws.com/x/y.pem", "eu-west-2")).toBe(true);
    expect(isValidCertUrl("https://sns.cn-north-1.amazonaws.com.cn/x.pem")).toBe(true);
  });

  it.each([
    "http://sns.us-east-1.amazonaws.com/x.pem",
    "https://evil.example.test/x.pem",
    "https://sns.us-east-1.amazonaws.com.evil.example.test/x.pem",
    "https://evil.example.test/sns.us-east-1.amazonaws.com/x.pem",
    "https://sns.us-east-1.amazonaws.com@evil.example.test/x.pem",
    "https://user:pw@sns.us-east-1.amazonaws.com/x.pem",
    "https://sns.us-east-1.amazonaws.com:8443/x.pem",
    "https://sns.us-east-1.amazonaws.com/x.crt",
    "https://amazonaws.com/x.pem",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(isValidCertUrl(url)).toBe(false);
  });

  it("refuses a certificate from another region than the topic's", () => {
    expect(isValidCertUrl(CERT_URL, "eu-west-2")).toBe(false);
    expect(isValidSnsHost("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription", "us-east-1")).toBe(true);
    expect(isValidSnsHost(undefined)).toBe(false);
  });
});

describe("buildStringToSign", () => {
  it("lists the Notification keys in the documented order and skips an absent Subject", () => {
    const { Subject: _subject, ...noSubject } = notification;
    expect(buildStringToSign(notification)).toBe(
      `Message\n{"notificationType":"Received"}\nMessageId\nunit-message-1\nSubject\nAmazon SES Email Receipt Notification\n` +
        `Timestamp\n2026-10-01T12:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:111122223333:unit-topic\nType\nNotification\n`
    );
    expect(buildStringToSign(noSubject)).not.toContain("Subject\n");
  });

  it("is null for an unknown type or a missing required field", () => {
    expect(buildStringToSign({ ...notification, Type: "Other" })).toBeNull();
    expect(buildStringToSign({ ...notification, MessageId: undefined })).toBeNull();
  });
});

describe("verifySnsMessage", () => {
  const signer = createSnsTestSigner();
  const fetchCert = jest.fn(async () => signer.publicKeyPem);
  beforeEach(() => {
    clearCertCache();
    fetchCert.mockClear();
  });

  it.each(["1", "2"] as const)("accepts a SignatureVersion %s signature", async (version) => {
    await expect(verifySnsMessage(signer.sign(notification, version), { fetchCert })).resolves.toBeUndefined();
  });

  it("rejects a signature made by another key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = signer.sign(notification, "2", other.privateKey);
    await expect(verifySnsMessage(forged, { fetchCert })).rejects.toMatchObject({ code: "signature_mismatch" });
  });

  it("rejects a message altered after signing", async () => {
    const signed = signer.sign(notification, "2");
    await expect(
      verifySnsMessage({ ...signed, Message: '{"notificationType":"Tampered"}' }, { fetchCert })
    ).rejects.toMatchObject({ code: "signature_mismatch" });
  });

  it("rejects a SHA1 signature presented as version 2 and unknown versions", async () => {
    const signed = signer.sign(notification, "1");
    await expect(verifySnsMessage({ ...signed, SignatureVersion: "2" }, { fetchCert })).rejects.toMatchObject({
      code: "signature_mismatch",
    });
    await expect(verifySnsMessage({ ...signed, SignatureVersion: "3" }, { fetchCert })).rejects.toMatchObject({
      code: "bad_signature_version",
    });
  });

  it("never fetches from a non-AWS certificate URL", async () => {
    const signed = signer.sign({ ...notification, SigningCertURL: "https://evil.example.test/x.pem" }, "2");
    await expect(verifySnsMessage(signed, { fetchCert })).rejects.toMatchObject({ code: "bad_cert_url" });
    expect(fetchCert).not.toHaveBeenCalled();
  });

  it("rejects a missing signature and an unavailable certificate", async () => {
    const { Signature: _sig, ...unsigned } = signer.sign(notification, "2");
    await expect(verifySnsMessage(unsigned, { fetchCert })).rejects.toMatchObject({ code: "no_signature" });
    await expect(
      verifySnsMessage(signer.sign(notification, "2"), {
        fetchCert: async () => {
          throw new Error("network down");
        },
      })
    ).rejects.toMatchObject({ code: "cert_unavailable" });
  });

  it("rejects a certificate that is not a key", async () => {
    await expect(
      verifySnsMessage(signer.sign(notification, "2"), { fetchCert: async () => "not a pem" })
    ).rejects.toMatchObject({ code: "bad_certificate" });
  });

  it("fetches a certificate once and serves later messages from the cache", async () => {
    await verifySnsMessage(signer.sign(notification, "1"), { fetchCert });
    await verifySnsMessage(signer.sign({ ...notification, MessageId: "unit-message-2" }, "2"), { fetchCert });
    expect(fetchCert).toHaveBeenCalledTimes(1);
  });

  it("does not cache a certificate that failed to verify", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await expect(
      verifySnsMessage(signer.sign(notification, "2", other.privateKey), { fetchCert })
    ).rejects.toBeDefined();
    await verifySnsMessage(signer.sign(notification, "2"), { fetchCert });
    expect(fetchCert).toHaveBeenCalledTimes(2);
  });
});
