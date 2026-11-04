# Assistant database: saved staff conversations

The in-app assistant can save **staff** conversations (the ticket assistant) so they can be read
again later. Customer conversations are never saved. Saving is off unless
`ASSISTANT_STAFF_HISTORY=true`.

Saved conversations live in TicketFlow's PostgreSQL, in their own schema `mastra`, written by
their own database role. That role owns `mastra` and nothing else: it cannot read any TicketFlow
table, create databases or create roles. The app keeps its own database user.

Conversations are deleted 30 days after their last message (`ASSISTANT_HISTORY_RETENTION_DAYS`,
1 to 365). A saved conversation contains what the assistant's lookups returned at the time; the app
withholds one from a user who has since lost access to a ticket it mentions.

## Switch it on

1. Choose a password of at least 24 characters, using only letters, digits and `. _ ~ -` (it goes
   into a URL as-is):
   `openssl rand -base64 32 | tr -d '/+='`
2. Create the role and schema, as the database owner. In Docker Compose the app container has the
   owner's `DATABASE_URL`:

   ```sh
   docker compose run --rm -e MASTRA_DB_PASSWORD='<password>' app \
     node scripts/db/provision-assistant-db.mjs
   ```

   It prints the role and schema it set up and then connects as the role to prove it owns `mastra`
   and cannot read TicketFlow's tables. Running it again is safe: it only sets the password again.
   `MASTRA_DB_USER` changes the role name (default `ticketflow_mastra`).
3. In `.env`:

   ```sh
   ASSISTANT_STAFF_HISTORY=true
   MASTRA_DATABASE_URL=postgres://ticketflow_mastra:<password>@postgres:5432/<database>
   ```

   The same `ASSISTANT_STAFF_HISTORY` reaches both services: the app then sends only each new
   message, and the agents service keeps the conversation.
4. `docker compose up -d`. The agents service creates its tables in `mastra` on first start and its
   `/ready` reports `history: "ok"`.

## Switch it off

Set `ASSISTANT_STAFF_HISTORY=false` and restart. Saved conversations are no longer used or shown,
and nothing is deleted at once. Keep `MASTRA_DATABASE_URL` set: the agents service then goes on
deleting each conversation at the end of its retention period. To delete them all now, see Remove.

The app shows saved conversations to staff only while its own switch is on AND the agents service
reports them working (its `/ready` says `history: "ok"`). How staff messages are sent follows the
agents service alone: with memory there, only each new message is sent; without, the whole
conversation is. A mismatch between the two services' settings therefore never makes the assistant
forget the conversation, and a brief probe failure changes nothing (the last answer stands).

With history off, a bad `MASTRA_DATABASE_URL` does not stop the agents service (the customer
assistant keeps working); it logs that saved conversations are not being deleted.

## Back up and restore

`scripts/db/backup.sh [dir]` dumps the whole database (every schema, so `mastra` is included) and
the roles without passwords. Keep the files off this host.

To restore into the Compose database (this replaces what is there):

1. Stop `app` and `agents`.
2. Run the provisioning step above (it creates the role that owns `mastra`, and sets its password).
3. `scripts/db/restore.sh <file.dump> --yes`
4. `docker compose up -d`.

## Upgrade

The agents service creates or updates its own tables in `mastra` when it starts (`@mastra/pg`).
The app's migrations and `drizzle-kit push` only manage the `public` schema and never touch
`mastra`.

## Remove

Deletes every saved conversation:

```sql
DROP SCHEMA mastra CASCADE;
REVOKE CONNECT ON DATABASE <database> FROM ticketflow_mastra;
DROP ROLE ticketflow_mastra;
```

Then set `ASSISTANT_STAFF_HISTORY=false`.
