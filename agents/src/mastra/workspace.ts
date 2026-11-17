/**
 * The project workspace: the files the helpdesk agent works from, and the skills it can load.
 *
 * Studio's Workspaces page browses this tree and lists the skills it discovers, so the helpdesk
 * procedure in `skills/helpdesk-resolution/SKILL.md` is visible and editable there instead of
 * living only in a prompt string.
 *
 * Read-only on purpose: the agent reads its procedures and reference notes, it never writes to
 * the source tree. Everything it changes goes through TicketFlow tools, where the app authorises
 * it as the signed-in user.
 */
import { LocalFilesystem, Workspace } from '@mastra/core/workspace';

/** The agents package root: this file lives in `src/mastra/`, so the root is two levels up. */
const rootPath = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export const helpdeskWorkspace = new Workspace({
  id: 'ticketflow-helpdesk',
  name: 'TicketFlow helpdesk',
  filesystem: new LocalFilesystem({ basePath: rootPath, readOnly: true }),
  // Every SKILL.md under skills/ is discovered here and listed in Studio.
  skills: ['skills'],
});

/** Passed to `new Mastra({ workspace })` so Studio shows the page. */
export const workspace = helpdeskWorkspace;
