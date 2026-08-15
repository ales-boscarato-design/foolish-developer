# Alfred Full CMS Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Alfred complete authenticated CRUD and media-upload access to every current and future Foolish Payload CMS collection through deterministic, audited tools.

**Architecture:** A focused asynchronous Python client authenticates as a dedicated Payload `users` machine account using an API key. Thin nanobot tools expose collection discovery, list/get/create/update/delete, and media upload; Payload remains the source of truth for schemas and access, while Alfred enforces preview/confirmation and writes a sanitized local audit trail.

**Tech Stack:** Python 3.13, `httpx` 0.28, stdlib `unittest`, nanobot tool loader, Payload CMS 3 API-key REST API, systemd user service, GPG secret vault.

**Spec:** `docs/superpowers/specs/2026-08-16-alfred-full-cms-administration-design.md`

## Global Constraints

- Do not print API keys, passwords, authorization headers, customer payloads, or decrypted secret files.
- Preserve the existing dirty CMS dependency write-set; stage and commit only files belonging to this capability.
- Reads execute immediately; creates and updates require `confirm=true`; deletes additionally require the exact string `DELETE <collection> <record-id>`.
- Do not automatically retry non-idempotent creates.
- Keep the existing read secret and restricted order secret until every production smoke test passes.
- PEC configuration and transmission remain unchanged.
- Use `apply_patch` for source edits and protected stdin/GPG for secret movement.
- Temporary production records must be inactive, uniquely prefixed `alfred-smoke-<timestamp>`, and removed in the same smoke-test run.

---

### Task 1: Payload admin client reads and validation

**Files:**
- Create: `/home/ab/nano-py/staging/nanobot/foolish/cms_admin.py`
- Create: `/home/ab/nano-py/tests/test_cms_admin.py`

**Interfaces:**
- Produces: `PayloadCMSAdminClient(base_url, api_key, *, audit_path=None, transport=None)`.
- Produces: async methods `permissions()`, `list_records(collection, *, params=None)`, and `get_record(collection, record_id, *, params=None)` returning decoded dictionaries.
- Produces: `CMSAdminError(status_code, message)` with sanitized bounded messages.

- [ ] **Step 1: Write failing read-client tests**

Create stdlib `unittest.IsolatedAsyncioTestCase` tests using
`httpx.MockTransport`. Assert that:

```python
async def handler(request: httpx.Request) -> httpx.Response:
    self.assertEqual(request.headers["Authorization"], "users API-Key test-key")
    self.assertNotIn("test-key", str(request.url))
    return httpx.Response(200, json={"collections": {"products": {"read": {"permission": True}}}})

client = PayloadCMSAdminClient(
    "https://cms.example.test/admin/",
    "test-key",
    transport=httpx.MockTransport(handler),
)
self.assertIn("products", (await client.permissions())["collections"])
```

Also assert rejection of invalid collection slugs, empty IDs, invalid locales,
limits outside `1..100`, non-object JSON responses, and an HTTP error body
containing `password`, `token`, and `authorization` keys. The raised error must
contain the status but none of those values.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd /home/ab/nano-py
PYTHONPATH=/home/ab/nano-py/staging python3 -m unittest -v tests.test_cms_admin
```

Expected: import failure because `nanobot.foolish.cms_admin` does not exist.

- [ ] **Step 3: Implement the minimal read client**

Implement:

```python
class PayloadCMSAdminClient:
    def __init__(self, base_url, api_key, *, audit_path=None, transport=None): ...
    async def permissions(self) -> dict[str, Any]: ...  # GET /api/access
    async def list_records(self, collection, *, params=None) -> dict[str, Any]: ...
    async def get_record(self, collection, record_id, *, params=None) -> dict[str, Any]: ...
```

Normalize a trailing `/admin` from the base URL, validate collection slugs with
`^[a-z][a-z0-9-]{0,127}$`, URL-quote record IDs, accept only locale values
`it|en|de|fr|es|all`, and use `Authorization: users API-Key <key>`. Recursively
redact dictionary keys matching `secret|token|key|password|authorization`, then
bound serialized error detail to 500 characters.

- [ ] **Step 4: Run read-client tests and verify GREEN**

Run the Task 1 command. Expected: all Task 1 tests pass.

- [ ] **Step 5: Compile the client**

Run:

```bash
PYTHONPATH=/home/ab/nano-py/staging python3 -m py_compile /home/ab/nano-py/staging/nanobot/foolish/cms_admin.py
```

Expected: exit 0 and no output.

---

### Task 2: Confirmed writes, upload, and audit

**Files:**
- Modify: `/home/ab/nano-py/staging/nanobot/foolish/cms_admin.py`
- Modify: `/home/ab/nano-py/tests/test_cms_admin.py`

**Interfaces:**
- Consumes: `PayloadCMSAdminClient` and `CMSAdminError` from Task 1.
- Produces: async methods `create_record`, `update_record`, `delete_record`, and `upload_media`.
- Produces: JSONL audit records at `audit_path` with keys `timestamp`, `action`, `collection`, `record_id`, `fields`, `status`, and `reason`.

- [ ] **Step 1: Add failing write and audit tests**

Assert these exact behaviors:

```python
self.assertEqual(
    await client.create_record("products", {"name": "Smoke"}, confirm=False),
    {"preview": True, "action": "create", "collection": "products", "fields": ["name"]},
)
```

No HTTP request or audit record occurs for a preview. With `confirm=True`, POST
to `/api/products`; PATCH uses `/api/products/<quoted-id>`; delete is rejected
unless `confirmation == "DELETE products <id>"`; confirmed DELETE records the
returned record ID. Audit files must be mode `0600`, exclude field values and
credentials, and include failed HTTP outcomes.

For upload, create a temporary PNG fixture and assert POST `/api/media` receives
a multipart `file` part. Missing paths, directories, and preview calls must not
open a network request.

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 1 unittest command. Expected: failures for missing write methods.

- [ ] **Step 3: Implement write methods without automatic retries**

Implement signatures:

```python
async def create_record(self, collection, data, *, params=None, confirm=False, reason="") -> dict: ...
async def update_record(self, collection, record_id, data, *, params=None, confirm=False, reason="") -> dict: ...
async def delete_record(self, collection, record_id, *, confirm=False, confirmation="", reason="") -> dict: ...
async def upload_media(self, local_path, *, alt="", confirm=False, reason="") -> dict: ...
```

Use one HTTP attempt per invocation. For multipart upload, send `file` plus an
optional `alt` text field. Audit in a `finally` path after a confirmed network
attempt, recording only metadata and the HTTP/error status.

- [ ] **Step 4: Run all client tests and verify GREEN**

Run the Task 1 unittest command. Expected: all tests pass.

- [ ] **Step 5: Compile and inspect for credential logging**

Run:

```bash
python3 -m py_compile /home/ab/nano-py/staging/nanobot/foolish/cms_admin.py
rg -n "print\(|logger\..*api_key|Authorization.*logger" /home/ab/nano-py/staging/nanobot/foolish/cms_admin.py
```

Expected: compile exit 0; search returns no credential logging.

---

### Task 3: Nanobot CMS tool surface and skill instructions

**Files:**
- Create: `/home/ab/nano-py/staging/nanobot/agent/tools/foolish_cms.py`
- Modify: `/home/ab/nano-py/foolish-backoffice/SKILL.md`
- Create: `/home/ab/nano-py/staging/scripts/foolish-preflight.py`
- Modify: `/home/ab/nano-py/tests/test_cms_admin.py`

**Interfaces:**
- Consumes: `PayloadCMSAdminClient` from Tasks 1-2 and env vars `FOOLISH_PAYLOAD_URL`, `FOOLISH_CMS_API_KEY`.
- Produces tools `foolish_cms_collections`, `foolish_cms_list`, `foolish_cms_get`, `foolish_cms_create`, `foolish_cms_update`, `foolish_cms_delete`, and `foolish_cms_media_upload`.

- [ ] **Step 1: Add failing tool-contract tests**

Load the tool module with lightweight stubs for `Tool`, `ToolResult`, and
`tool_parameters`, then assert all seven classes have `_scopes = {"core"}`;
read tools report `read_only=True`; write tools report `exclusive=True`; and
`enabled()` requires both URL and API key. Assert tool execution delegates
preview and confirmation flags unchanged to a mocked client.

- [ ] **Step 2: Run tests and verify RED**

Run the Task 1 unittest command. Expected: import failure for
`nanobot.agent.tools.foolish_cms`.

- [ ] **Step 3: Implement thin tool classes**

Each `execute()` method must instantiate the client from environment variables,
delegate to one client method, and return pretty JSON. Convert `CMSAdminError`
to `self.error("Payload CMS operation failed with HTTP <status>: <safe detail>")`.
Use JSON-schema object parameters for arbitrary record data and query params.

- [ ] **Step 4: Update Alfred's backoffice instructions**

Document that Alfred is a full Payload administrator, that collection tools
are preferred over shell/curl, that product/media/customer/order/user work is
in scope, and that preview/confirmation is mandatory for writes. Keep existing
Stripe, Packlink, invoicing, and communication rules unchanged.

- [ ] **Step 5: Add the API-key preflight requirement**

Copy the current remote preflight behavior into the staged script and require
the names `FOOLISH_PAYLOAD_URL` and `FOOLISH_CMS_API_KEY` without printing
their values. Preserve all existing checks.

- [ ] **Step 6: Run local tests and compile every staged module**

Run:

```bash
cd /home/ab/nano-py
PYTHONPATH=/home/ab/nano-py/staging python3 -m unittest -v tests.test_cms_admin
python3 -m py_compile staging/nanobot/foolish/cms_admin.py staging/nanobot/agent/tools/foolish_cms.py staging/scripts/foolish-preflight.py
```

Expected: all tests pass and compile exits 0.

---

### Task 4: Provision and synchronize the Payload machine identity

**Files:**
- Create: `/home/ab/nano-py/scripts/provision-alfred-cms-user.py`
- Modify: `/home/ab/nano-py/scripts/sync-foolish-env.sh`
- Create outside Git via GPG: `/home/ab/.foolish-secrets/alfred-cms-machine.gpg.asc`

**Interfaces:**
- Consumes administrator URL/email/password only for provisioning.
- Produces a dedicated Payload user and encrypted recovery bundle containing machine email, random password, and API key.
- Produces remote env var `FOOLISH_CMS_API_KEY` without terminal output.

- [ ] **Step 1: Write a provisioning dry-run test**

Add a `--dry-run` mode that validates all required environment names and emits
only JSON booleans and the target email. Test with dummy values and assert no
dummy password or key appears in stdout/stderr.

- [ ] **Step 2: Implement idempotent provisioning**

The script logs in at `/api/users/login`, queries the machine email, creates it
when absent, or rotates its API key when present. Send `enableAPIKey=true`, a
random machine password, and the caller-provided random API key. Output only
`{"ok": true, "created": <bool>, "user_id": "..."}`.

- [ ] **Step 3: Extend protected environment synchronization**

Update `sync-foolish-env.sh` to decrypt
`alfred-cms-machine.gpg.asc`, validate a non-empty `FOOLISH_CMS_API_KEY`, append
only that value to the remote temporary environment, and unset decrypted shell
variables before exit. Do not add the key to `.env.foolish-pi`.

- [ ] **Step 4: Validate scripts before production mutation**

Run:

```bash
python3 -m py_compile /home/ab/nano-py/scripts/provision-alfred-cms-user.py
bash -n /home/ab/nano-py/scripts/sync-foolish-env.sh
```

Expected: exit 0.

- [ ] **Step 5: Generate, encrypt, and provision credentials**

Generate a random password and API key without echoing them, encrypt the
recovery bundle to the same GPG recipient used by the existing Foolish vault,
then run the provisioning script with administrator credentials decrypted only
into process environment. Verify the result JSON reports `ok=true`.

- [ ] **Step 6: Verify API-key authentication before deploying tools**

Call `/api/users/me` and `/api/access` using the key from the encrypted bundle,
printing only identity ID, machine email, `canAccessAdmin`, and collection
permission booleans. Expected: authenticated machine identity and CRUD
permission on all business collections and `users`.

---

### Task 5: Deploy Alfred and run production smoke tests

**Files:**
- Deploy: `/home/nanobot-admin/foolish-core/nanobot/foolish/cms_admin.py`
- Deploy: `/home/nanobot-admin/foolish-core/nanobot/agent/tools/foolish_cms.py`
- Deploy: `/home/nanobot-admin/foolish-core/scripts/foolish-preflight.py`
- Deploy: `/home/nanobot-admin/foolish-core/nanobot/skills/foolish-backoffice/SKILL.md`
- Create temporarily: `/home/nanobot-admin/.nanobot/smoke/alfred-smoke-<timestamp>.png`

**Interfaces:**
- Consumes tested staged files and synchronized environment.
- Produces seven registered Alfred CMS tools and verified full CMS administration.

- [ ] **Step 1: Back up the exact remote files being replaced**

Copy each existing target to a timestamped mode-`0600` rollback directory under
`/home/nanobot-admin/.nanobot/rollback/`. Record paths, not contents.

- [ ] **Step 2: Install staged files atomically**

Transfer over SSH stdin to temporary files, run remote `py_compile`, then use
`install -m 0644` to replace code/skill targets. Install the preflight script
mode `0755`.

- [ ] **Step 3: Synchronize environment and restart once**

Run `sync-foolish-env.sh`, then `systemctl --user restart
nanobot-foolish.service`. Verify active/enabled state, health endpoint, and
startup log registration of all seven new tool names.

- [ ] **Step 4: Execute read-only smoke tests**

Through the deployed client, verify `/api/users/me`, `/api/access`, collection
discovery, product listing, customer listing, and order listing. Print only
counts, IDs of temporary records, and permission booleans.

- [ ] **Step 5: Execute and clean up write smoke tests**

Using the deployed client and `confirm=True`:

1. Create, read, update, and delete `alfred-smoke-<timestamp>@invalid.example` in `customers`.
2. Upload a generated 1x1 PNG.
3. Create an inactive `products` record with this exact minimal shape:

   ```json
   {
     "name": "Alfred smoke <timestamp>",
     "slug": "alfred-smoke-<timestamp>",
     "section": "tattoo",
     "active": false,
     "basePrice": 1,
     "images": [{"image": "<temporary-media-id>", "alt": "Alfred CMS smoke test"}]
   }
   ```

4. PATCH `name` and `shortDescription` through locales `it`, `en`, `de`,
   `fr`, and `es`, then GET each locale and assert its localized smoke string.
5. Delete the product, then delete the media record.
6. Preview, without confirming, a full update to one existing order.

Use a `try/finally` cleanup path. If cleanup fails, report exact temporary IDs
and keep working until they are removed.

- [ ] **Step 6: Verify audit and existing capabilities**

Assert audit records exist for each confirmed temporary write, are mode `0600`,
and contain no API key or record field values. Re-run
`foolish_order_get`, `foolish_orders_list`, restricted order-update preview,
Stripe observation, and Alfred health checks.

- [ ] **Step 7: Roll back on any failed acceptance check**

If any tool registration, authentication, cleanup, audit, or existing-capability
check fails, restore the rollback files and previous environment, restart the
service, and retain the machine user disabled until the failure is fixed.

---

### Task 6: Repository verification, roadmap, and handoff

**Files:**
- Modify: `agent.md`
- Update checkboxes: `docs/superpowers/plans/2026-08-16-alfred-full-cms-administration.md`

**Interfaces:**
- Consumes production evidence from Task 5.
- Produces a verifiable roadmap record and clean capability commit without dependency files.

- [ ] **Step 1: Run repository verification**

Run:

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
```

Expected: both exit 0. If the pre-existing dependency write-set causes a
failure, diagnose it separately and do not hide it in the Alfred commit.

- [ ] **Step 2: Update roadmap evidence**

Add a Phase 0 entry recording machine-user authentication, seven registered
tools, full collection permissions, temporary product/customer/media CRUD,
multilingual update, cleanup, audit verification, and regression checks.
Change the next action back to the dependency roadmap only after all checks
pass.

- [ ] **Step 3: Check repository scope**

Run:

```bash
git status --short
git diff --check
git diff -- agent.md docs/superpowers/plans/2026-08-16-alfred-full-cms-administration.md
```

Expected: Alfred documentation changes are separate from the existing CMS
dependency files and `.codex/` remains untracked.

- [ ] **Step 4: Commit only Alfred documentation**

Run:

```bash
git add agent.md docs/superpowers/plans/2026-08-16-alfred-full-cms-administration.md
git commit -m "feat: restore full Alfred CMS administration"
```

Do not stage `cms/Dockerfile`, `cms/package*.json`, `cms/next-env.d.ts`,
`cms/src/payload-types.ts`, or `.codex/` in this commit.

- [ ] **Step 5: Push the completed documentation commits**

Push `main` to `ales-boscarato-design/foolish-developer` only after verifying
the remote URL and commit scope. Confirm the push does not include the dirty
dependency write-set.
