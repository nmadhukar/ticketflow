const clients: Array<{ credentials: { accessKeyId: string; secretAccessKey: string } }> = [];
const send = jest.fn(async () => ({}));

jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    constructor(config: { credentials: { accessKeyId: string; secretAccessKey: string } }) {
      clients.push(config);
    }
    send = send;
  },
  SendEmailCommand: class {},
}));

describe("SES sender never pairs a stored key id with the server's own secret", () => {
  const saved = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
  beforeEach(() => {
    clients.length = 0;
    send.mockClear();
    process.env.AWS_ACCESS_KEY_ID = "AKIAENVIRONMENT";
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret-value";
  });
  afterAll(() => {
    for (const [k, v] of [["AWS_ACCESS_KEY_ID", saved.id], ["AWS_SECRET_ACCESS_KEY", saved.secret]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const base = { to: "a@b.test", from: "f@b.test", subject: "s", html: "<p>x</p>" };

  it("refuses a stored key id that is not the environment's, when no secret is stored", async () => {
    const { sendEmail } = await import("../../services/ses");
    expect(await sendEmail({ ...base, awsAccessKeyId: "AKIAOTHERHOST" })).toBe(false);
    expect(clients).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends with the environment pair when the stored key id is the environment's own", async () => {
    const { sendEmail } = await import("../../services/ses");
    expect(await sendEmail({ ...base, awsAccessKeyId: "AKIAENVIRONMENT" })).toBe(true);
    expect(clients[0].credentials).toEqual({ accessKeyId: "AKIAENVIRONMENT", secretAccessKey: "env-secret-value" });
  });

  it("sends with a stored pair whatever the environment holds", async () => {
    const { sendEmail } = await import("../../services/ses");
    expect(await sendEmail({ ...base, awsAccessKeyId: "AKIAOTHERHOST", awsSecretAccessKey: "stored-secret" })).toBe(true);
    expect(clients[0].credentials).toEqual({ accessKeyId: "AKIAOTHERHOST", secretAccessKey: "stored-secret" });
  });

  it("with nothing stored at all it still falls back to the environment pair", async () => {
    const { sendEmail } = await import("../../services/ses");
    expect(await sendEmail(base)).toBe(true);
    expect(clients[0].credentials.accessKeyId).toBe("AKIAENVIRONMENT");
  });
});
