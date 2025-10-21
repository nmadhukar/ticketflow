### Comments: Internal vs Customer-Visible

**Gap**

- No flag to distinguish internal notes from customer-visible comments.

**Requirements**

- Add `isInternal` boolean on comments; only agents/managers/admins can read internal notes; customers see only non-internal comments.

**Approach**

1. DB/ORM
   - Add `task_comments.is_internal BOOLEAN DEFAULT false` and schema field.
2. API
   - Create comment accepts `{ content, isInternal }`; enforce role: customers cannot create internal notes.
   - GET comments filters based on requester role.
3. UI
   - Toggle when adding a comment (visible only to non-customer roles).

**Acceptance Criteria**

- Customers never see internal notes.
- Agents/managers/admins can create and view internal notes.

**Risks/Notes**

- Migrate existing comments as `isInternal=false`.
