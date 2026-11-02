import type { User } from "@shared/schema";
import { storage } from "../storage";
import { keyOwnerBlockReason } from "../services/auth/apiKeys";
import { readAssistantSecrets, readRunMaxSeconds } from "./config";
import { AssistantRuns } from "./runAuth";

/**
 * The process's one run registry, built on first use from the checked configuration: the user is
 * reloaded with storage.getUser and refused with the same rules as an API key owner
 * (keyOwnerBlockReason: inactive, unapproved, system accounts). Imported lazily by the routes, so
 * modules that only describe them never reach the database.
 */
let runs: AssistantRuns<User> | undefined;

export function assistantRuns(): AssistantRuns<User> {
  if (!runs) {
    const secrets = readAssistantSecrets();
    runs = new AssistantRuns<User>({
      sessionSecrets: secrets.session,
      agentSecret: secrets.agent[0],
      runMaxSeconds: readRunMaxSeconds(),
      loadUser: (id) => storage.getUser(id),
      blockReason: (user) => keyOwnerBlockReason(user),
    });
  }
  return runs;
}
