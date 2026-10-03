import { createSign, generateKeyPairSync } from "crypto";
import { buildStringToSign, type SnsMessage } from "../../services/email/snsVerify";

/**
 * Test-only SNS signer. The key pair is generated when the suite starts and never leaves
 * memory, so no private key is committed. `publicKeyPem` is what the injected cert
 * fetcher returns (a public key verifies exactly like the key inside an AWS certificate).
 */
export function createSnsTestSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  function sign(msg: SnsMessage, version: "1" | "2" = "1", key = privateKey): SnsMessage {
    const withVersion: SnsMessage = { ...msg, SignatureVersion: version };
    const toSign = buildStringToSign(withVersion);
    if (toSign === null) throw new Error("test message is not signable");
    const signature = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256")
      .update(toSign, "utf8")
      .sign(key, "base64");
    return { ...withVersion, Signature: signature };
  }

  return { publicKeyPem, privateKey, sign };
}

export { generateKeyPairSync };
