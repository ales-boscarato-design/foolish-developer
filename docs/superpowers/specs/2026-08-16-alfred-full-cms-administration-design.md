# Alfred Full CMS Administration Design

## Purpose

Restore and extend Alfred's ability to administer the complete Foolish Payload
CMS without depending on an interactive administrator password or an arbitrary
shell. Alfred must be able to manage every current and future CMS collection,
including products, media, customers, orders, marketing content,
subscriptions, customer files, Pro members, promotions, and CMS users.

This capability restoration is an urgent completion of credential-separation
work and must be delivered before the dependency-upgrade roadmap resumes.

## Current problem

Credential hardening replaced Alfred's previous administrative access with a
read credential and an order endpoint limited to five operational fields. The
replacement covered routine order handling but omitted catalog, media,
customer, and full-record administration. Alfred is therefore unable to do
work that belongs to its backoffice role.

The failure is architectural: per-collection machine endpoints require every
new capability to be anticipated and implemented separately. That model will
continue producing omissions as the CMS evolves.

## Chosen architecture

Payload already supports API-key authentication on the `users` auth
collection. A dedicated Alfred machine user will authenticate with:

```text
Authorization: users API-Key <machine-key>
```

The key is consumed only by deterministic Alfred tools. It is stored in the
Raspberry Pi service environment with mode `0600` and in the existing local
GPG vault for recovery. It is not written to prompts, tool output, logs,
documentation, or Git.

Because existing CMS collection access rules grant full business operations
to `req.user`, the machine user receives the same CMS coverage as an
interactive administrator. New collections using the repository's normal
authenticated-user access pattern become available without adding a new
endpoint or credential.

The existing restricted order endpoint remains available for routine order
state changes. It is a convenience path, not Alfred's maximum permission.

## Alfred tool surface

The deterministic backoffice module will expose these operations:

- `foolish_cms_collections`: discover configured collection slugs and the
  machine user's effective permissions through Payload's authenticated
  `/api/access` endpoint.
- `foolish_cms_list`: list and filter records with pagination, sorting,
  depth, and locale parameters.
- `foolish_cms_get`: retrieve one record by ID.
- `foolish_cms_create`: create a record in any collection.
- `foolish_cms_update`: update any fields on any record.
- `foolish_cms_delete`: delete a record from any collection.
- `foolish_cms_media_upload`: upload images, video, PDF, ZIP, and other file
  types accepted by the Payload `media` collection.

Collection names are validated syntactically but are not hard-coded in an
allowlist. Payload remains the authority for whether a collection exists and
whether an operation is valid.

The create and update tools accept Payload-compatible JSON. They support the
CMS localization parameters `it`, `en`, `de`, `fr`, and `es`, so Alfred can
maintain complete multilingual product content. Relationships and rich-text
documents are passed in Payload's native representation.

Media upload uses multipart form data and a local file path available to the
Alfred service account. It validates file existence and regular-file status
before making a request. Payload remains responsible for MIME, size, image
processing, and collection validation.

## Operational awareness

Capability is not removed to enforce safety. Awareness is implemented at the
action boundary:

- Reads execute immediately.
- Creates and updates return a preview unless `confirm=true` is supplied.
- Deletion requires `confirm=true` and an exact confirmation string containing
  the collection and record ID.
- Tool results identify the operation, collection, record ID, and changed
  field names without exposing credentials.
- Every confirmed external write appends a mode-`0600` JSONL audit record on
  Alfred containing timestamp, action, collection, record ID, changed field
  names, HTTP outcome, and an optional user-provided reason.
- API errors return status and a bounded, sanitized Payload error description.
- Retries are not automatic for non-idempotent creates. A failed create is
  reconciled by querying the intended unique field before any retry.

These requirements do not prevent Alfred from performing any CMS operation;
they make the operation deliberate and traceable.

## Scope boundaries

"Product pages" in this work means every product record and related CMS
content: localized names and descriptions, SEO fields, pricing, variants,
images, videos, reseller content, visibility, ordering, and relationships.

Changing storefront React components, page layout, routing, or deployment is
source-code administration rather than CMS administration. That work remains
in the repository/deployment workflow and is not silently performed through a
CMS tool.

PEC configuration and transmission are outside this change and remain as-is.

## Credential lifecycle

1. Generate a cryptographically random API key locally without printing it.
2. Authenticate to Payload using the recoverable human administrator
   credential and create a dedicated machine user with API-key access enabled.
3. Save the key encrypted in the existing GPG vault.
4. Synchronize it to Alfred as `FOOLISH_CMS_API_KEY` using the protected
   environment-sync path.
5. Restart Alfred only after preflight verifies that the URL and API-key
   variable are present.
6. Verify `/api/users/me` and representative collection reads through API-key
   authentication.
7. Keep existing read and restricted-order credentials during rollout. Remove
   a superseded credential only after all smoke tests pass and its consumers
   have been audited.

The machine user is named clearly as infrastructure and is not used for human
CMS sessions.

## Testing strategy

### Unit tests

Python tests cover:

- authorization header construction without credential disclosure;
- URL, collection, ID, locale, pagination, and query validation;
- preview behavior for every write tool;
- exact delete confirmation;
- multipart upload construction and missing-file failures;
- bounded/sanitized error reporting;
- audit records for success and failure;
- no retry of ambiguous creates.

HTTP calls are mocked. Tests must fail before implementation and pass after
the minimum implementation is added.

### Local verification

- Python syntax/compile and focused test suite.
- Alfred preflight tests with variable names only, never values.
- Existing Storefront and CMS TypeScript checks remain green.
- The dirty dependency-upgrade worktree is preserved and excluded from this
  capability commit.

### Production smoke tests

After deployment:

1. Authenticate the machine user and read its identity.
2. List every current CMS collection.
3. Create a uniquely named temporary customer, read it, update it, and delete
   it.
4. Upload a generated harmless test image and retain its media record for the
   product test.
5. Create an inactive temporary product using that media, read and update all
   supported locales, then delete the product and finally the media record.
6. Read and preview a complete correction to an existing order without
   confirming the write, avoiding customer notifications.
7. Confirm that routine `foolish_order_get`, `foolish_orders_list`, and the
   restricted update path still work.
8. Confirm that the audit log contains the temporary write sequence and no
   secrets.

Temporary records use an unmistakable `alfred-smoke-<timestamp>` identifier
and are removed during the same test. If cleanup fails, the record IDs are
reported immediately for manual cleanup.

## Deployment and rollback

Deployment order:

1. Provision and verify the Payload machine user.
2. Deploy the tested Alfred tool module and skill instructions to the
   Raspberry Pi.
3. Synchronize the API key through protected stdin.
4. Restart `nanobot-foolish.service` and verify health/tool registration.
5. Execute production smoke tests.
6. Update `agent.md` with evidence and resume the dependency roadmap.

Rollback consists of restoring the previous Alfred tool module and service
environment, restarting the service, and disabling the machine user's API key.
The existing read and restricted-order tools remain available throughout the
rollout, so rollback does not remove current order observability.

## Acceptance criteria

- Alfred can read, create, update, and delete records in every current Payload
  collection, including `products`, `media`, `customers`, `orders`, and
  `users`.
- Alfred can upload media and attach it to a multilingual product.
- Alfred can correct every order field, while routine state updates keep their
  simpler workflow.
- New authenticated CMS collections require no Alfred code change.
- Confirmed writes are deliberate and audited; credentials never appear in
  logs or tool results.
- Temporary production smoke-test records are removed.
- Existing order, Stripe, Packlink, Brevo, Railway, and Telegram capabilities
  continue working.
- The roadmap records verifiable deployment evidence before credential work is
  considered complete.
