import { isConfirmationReply, isNotFixedReply } from "../../services/tickets/confirmationWording";

describe("customer confirmation wording", () => {
  it("reads a thank-you or 'it works' as a confirmation", () => {
    expect(isConfirmationReply("Thanks, that fixed it!")).toBe(true);
    expect(isConfirmationReply("It works now, thank you")).toBe(true);
    expect(isConfirmationReply("Yes, that solved it")).toBe(true);
  });

  it("never treats 'still broken' as a confirmation, even with a thank-you", () => {
    expect(isConfirmationReply("Thanks, but it is still not working")).toBe(false);
    expect(isConfirmationReply("Still broken after the steps")).toBe(false);
    expect(isNotFixedReply("Still broken after the steps")).toBe(true);
  });

  it("ignores a reply that says nothing either way", () => {
    expect(isConfirmationReply("")).toBe(false);
    expect(isConfirmationReply("Here is a screenshot")).toBe(false);
    expect(isNotFixedReply("Here is a screenshot")).toBe(false);
  });
});
