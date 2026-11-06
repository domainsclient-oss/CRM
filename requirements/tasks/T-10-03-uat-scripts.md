# T-10-03 — UAT scripts (UC-01..UC-13)

For pilot testers on **staging**, after T-10-02 setup (`pnpm uat:seed`, see [phase-10-plan.md](phase-10-plan.md)).

Record each step as **Pass**, **Fail** or **Blocked**, with notes and screenshots of failures. For every failure, write down the request ID shown in the error message: it lets us find the server log.

The timing sheet (§3) measures goal G-2.

## 1. Before you start

| You need | From |
|---|---|
| Staging URLs: `www`, `console`, `partners`, workspace addresses | Operator |
| A platform staff Google account (UC-01, UC-12, UC-13) | Operator |
| Mailbox access for each test email address (invitations, reset, alerts) | Tester |
| DNS access for the custom-domain workspace (UC-02) | Pilot agency |
| Razorpay test-mode keys and test cards (UC-10) | Pilot agency — **blocked until Phase 6b** |
| A CSV of 200–500 test contacts, no real personal data (UC-09) | Tester |

Use test data only. Don't enter real customer data on staging.

## 2. Scripts

### UC-01 · Provision an agency (Platform Super Admin)

1. Sign in at `console.` with Google.
   - **Expected:** a new-device alert email arrives.
2. Create the agency: name, short name, owner email, workspace limit, seat limit.
   - **Expected:** a confirmation appears, and the owner receives an invitation.
3. As the agency owner, accept the invitation and sign in at `partners.`.
   - **Expected:** the agency console shows the agency with 0 workspaces.
4. In the agency console, set branding defaults: app name, colours, logo.
   - **Expected:** the preview updates. A colour with too little contrast is refused, and a fix is suggested.
5. Set the agency base domain.
   - **Expected:** it is saved.
6. Payment gateway: **blocked (Phase 6b).**

### UC-02 · Provision a workspace with a custom domain (Platform Super Admin, or an entitled Agency Admin)

1. Create a workspace for a client.
   - **Expected:** the platform address works immediately, and the owner receives an invitation.
2. Add the custom domain (e.g. `crm.client.example`).
   - **Expected:** the DNS records to set are shown.
3. Ask the agency to set the DNS records, then press **Check now** until the domain is Active.
   - Don't time the DNS propagation.
4. Make the custom domain the main address.
   - **Expected:** the old address redirects to the new one.
5. Add an agency subdomain to a second workspace.
   - **Expected:** it becomes Active after DNS is set.

### UC-03 · Accept the invitation, brand the workspace, invite the team (Workspace Owner)

1. Open the invitation link and create an account (or sign in with Google).
   - **Expected:** you land on the workspace dashboard on the workspace's own address.
2. Settings → Branding: change the app name and logo. This works only if the agency allows it.
   - **Expected:** the change is visible to members within a minute.
3. Settings → Members: invite an Admin, a Manager, a Member and a Viewer.
   - **Expected:** each person receives an email, and the seat count updates.
4. As the Owner, try to make yourself a Viewer.
   - **Expected:** this is refused. Ownership moves only through Transfer ownership.

### UC-04 · Lead → contact + company + deal (Member)

1. Create a lead with a company name and email.
2. Qualify it, then choose **Convert lead**: a new contact, a new company and a deal with an amount.
   - **Expected:** the contact, company and deal exist and are linked, and the lead shows Converted.
3. Create a contact with the same email address a colleague's contact uses.
   - **Expected:** a duplicate warning appears without revealing the other contact.

### UC-05 · Pipeline (Member / Manager)

1. Open the pipeline board and drag a deal to the next stage.
   - Also do it with the keyboard, using **Move to stage**.
   - **Expected:** the column totals update, and the timeline shows the stage change.
2. Mark one deal **Won** (set the contact to Customer) and another **Lost** (with a reason).
   - **Expected:** both appear in the reports.
3. Manager: reopen the lost deal into a stage.

### UC-06 · Tasks and reminders (Member)

1. Create a task due in 10 minutes, linked to a deal.
   - **Expected:** a reminder notification arrives in the app (and by email if enabled).
2. Complete the task from My tasks, then use **Undo**.

### UC-07 · Activities and timeline (Member)

1. Log a call, a meeting and a note with Markdown formatting on a contact.
   - **Expected:** the timeline lists newest first. The Markdown renders safely; script tags are shown as text.
2. Delete your own note. Try to delete a colleague's note.
   - **Expected:** a Member can delete only their own; a Manager or Admin can delete any.

### UC-08 · Dashboard and reports (Manager)

1. Open the dashboard and filter by owner.
   - **Expected:** the totals match the deals you created.
2. Open Reports, change the date range and export each report as CSV.
   - **Expected:** the CSV opens in a spreadsheet, and cells starting with `=` are not run as formulas.
3. As a Member, open the dashboard.
   - **Expected:** it shows only your own records ("Showing your records").

### UC-09 · Import and export (Admin / Manager)

1. Settings → Import: upload the CSV, check the suggested column mapping, review the preview errors, choose a duplicate handling option and run the import.
   - **Expected:** a notification arrives when it finishes, and the error report can be downloaded.
   - **Note:** files over about 4 MB fail on staging until OQ-26 is decided.
2. Export a filtered contact list.
   - **Expected:** the file is listed under Recent imports and exports, and its download link expires after 24 hours.

### UC-10 · Subscribe and pay (Workspace Owner)

**Blocked until Phase 6b** (Razorpay, PayPal and Stripe test mode).

### UC-11 · Data-subject request (Workspace Admin)

1. Settings → Privacy: export one contact's data.
   - **Expected:** you get JSON and CSV files containing only that contact's data.
2. Erase the contact. A sign-in from the last 5 minutes is required.
   - **Expected:** the contact is gone. Deals and tasks show "[erased]", and the audit log shows the erasure without the contact's name.

### UC-12 · Suspend or delete (Platform Super Admin / Agency Admin)

1. Agency console: suspend a workspace.
   - **Expected:** its members are signed out of it within about a minute and see "suspended".
   - Reactivate it.
2. Platform console: suspend the agency.
   - **Expected:** all of its workspaces become unavailable.
   - Reactivate it.
3. Owner: Settings → Workspace → Delete workspace (type its short name).
   - **Expected:** only the Owner can still enter, and only to cancel. Cancel the deletion.

### UC-13 · Audit review (Owner/Admin, Platform Super Admin)

1. Workspace: Settings → Audit log. Filter by user and by action, then export CSV.
   - **Expected:** every action from UC-03 to UC-12 appears, with no record contents.
2. Platform console: review the platform audit for the agency and workspace changes.

## 3. Timing sheet (G-2)

| Measure | Target | Start | Stop | Result |
|---|---|---|---|---|
| Operator provisions agency + first client workspace with custom domain | < 30 min, DNS propagation excluded | UC-01 step 1 | UC-02 step 4 (domain shown as main address; propagation wait subtracted) | |
| Client owner accepts invite and creates a first deal | < 15 min | Opens invitation email | Deal saved | |

## 4. Sign-off

At least 3 pilot workspaces (checklist F2).

| Workspace | Tester | Date | UCs passed | Open SEV1/SEV2 | Signature |
|---|---|---|---|---|---|
| | | | | | |
