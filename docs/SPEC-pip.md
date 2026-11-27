# Projects in Pursuit (PiP)

The PiP form, moved from a spreadsheet into Compass. A principal or project manager fills it in when the firm starts tracking a pursuit. The PiP admins review it, return it with a note if something needs to change, and mark it created once they have entered it in Vantagepoint. The form also asks the few scope questions the sustainability team needs for AIA 2030 reporting.

Sources: the admin's draft worksheet `PIP Worksheet_V2.xlsx` (fields and the Data Points lists, the stage to probability rule) and an employee's HTML concept "Project in Pursuit: intake prototype" (the AIA 2030 questions and rule, the review step). Both are outside the repo. Decisions: Josh, 2026-11-26 (`docs/DECISIONS.md`).

Code: rules `modules/pip/logic/form.js` and `workflow.js` (tested from `modules/pip/tests/fixtures/*.json`), server `server/pip.js`, screens `modules/pip/ui/`. Routes `#/pip`, `#/pip/new`, `#/pip/<id>`, `#/pip/<id>/edit`. Admin tab **Projects in Pursuit**.

## 1. Who sees and does what (`workflow.js`, tested)

| Who | Sees the module | Submits | Reviews |
|---|---|---|---|
| A principal or PM: Compass role PIC or PM, or principal or PM on at least one active Vantagepoint project | yes | yes | no |
| A PiP admin (Admin setting `pip.admins`; the seed picks Karen, Camille and Casey) | yes | no | yes |
| Someone the Admin added as a viewer (`pip.viewers`, for example the sustainability team) | yes | no | no |
| The Admin | yes | yes | yes |
| Everyone else (Finance, Marketing, System admin, unless picked above) | **no**: not in the side bar, and the API refuses | | |

Everyone who sees the module sees the full list and every PiP in full.

## 2. The home page (`#/pip`)

- **New PiP** button in the header (only for people who submit).
- **Submitted, not yet in Vantagepoint:** every PiP that is New, In review or Returned, **however old**, oldest first.
- **Last 30 days:** PiPs created in Vantagepoint or withdrawn in the last `pip.recentDays` days (30), newest first.
- Columns: PiP number, project (with an AIA 2030 chip when flagged), client, estimated fee, estimated start, submitted (or decided) date and by whom, status (with the Vantagepoint number once created).
- A PiP admin sees **Review this PiP** on New and In review rows. Whoever submitted a returned PiP sees **Fix and resubmit**. Everyone else sees **Open**.
- A switch narrows the list to **AIA 2030 flagged** PiPs (Reportable or Needs review).

## 3. The form (`#/pip/new`)

Four cards on one page: **Pursuit, Client, Project, Team and fee**. A side panel shows the AIA 2030 status as you type, how many required answers are done, and what is still missing (click one to jump to it). **Review** checks everything; errors show under their fields. A complete form opens the **Review** step: a compact read-only view of everything, then **Notes for the reviewers** (optional) and **Submit**.

An unsent new PiP is kept in this browser for this person, so a reload does not lose it. **Clear the form** starts over.

### Fields (* required)

| Card | Fields |
|---|---|
| Pursuit | Project name*, Stage*, Probability*, Source*, Responsibility*, Direct award* (Yes/No) |
| Client | Primary client* (type to search the Vantagepoint list, or **add a new client**: legal name*, main address), Primary contact (that client's contacts, **new contact**: name*, email, phone, mailing address, or none yet) |
| Project | Project type*, Deliverable*, the AIA 2030 scope questions* (only for renovations and tenant improvements), Description*, project site (street, city, state, ZIP) and estimated gross area (only while the project may be reportable), Construction budget, RFP release, Proposal due, Shortlist and Interview dates |
| Team and fee | Office*, Principal*, Project manager*, Project architect, Delivery method*, Compensation type*, **Estimated fee (gross, including consultants)***, Master contract value, Estimated start*, Estimated completion*; **Urgency** is worked out, not entered |

People are picked by typing: the list narrows and only an exact pick counts, so each name maps to one Vantagepoint employee. The principal list is the people who are principal on a Vantagepoint project (or have the PIC role). The project architect list is limited to licensed architects **once Vantagepoint says who they are** (open question PIP3); until then anyone can be picked.

### Rules (`form.js`, tested)

- **Stages:** the open Vantagepoint stages only (Research, Go NoGo Process, Fee Proposal Only (No Marketing), Marketing Proposal, Shortlisted, Negotiation, Awarded, Awarded with Interview). No Go, Cancelled and Lost are not used at intake.
- **Probability follows the stage**, strictly. The form offers only the stage's values and the server refuses anything else. Admin setting `pip.stageProbabilities`, default from the worksheet's Data Points labels:

| Stage | Allowed |
|---|---|
| Research | 10% |
| Go NoGo Process, Fee Proposal Only, Marketing Proposal | 20% |
| Shortlisted | 30% or 40% |
| Negotiation | 50%, 60% or 70% |
| Awarded, Awarded with Interview ("Contracting") | 80% or 90% (open question PIP1) |

  100% is never offered: a signed project gets a project number, not a PiP.
- **Urgency** from the estimated start date, routed to Vantagepoint's options: within 6 months (or already past) **0-6 Months**, within 12 **6-12 Months**, later **12+ Months**. Recorded on the day the PiP is sent.
- **$1M:** a fee at or over `pip.cfoThreshold` ($1,000,000) shows a warning ("coordinate with the CFO") and the CFO is told when it is submitted. It never blocks.
- Money is whole dollars; the completion date cannot be before the start; an entered email must look like one.
- Answers to questions that were not asked are dropped on the server (scope answers, new client or contact fields, the site fields once not reportable).

### AIA 2030 (`aia2030()`, the concept's rule unchanged; Josh: fixed until he says otherwise)

| Deliverable | Status |
|---|---|
| New Construction, Expansion/Infill | Reportable (whole building) |
| Modernization/Renovation/Remodel | asks: will our scope change the heating, cooling or ventilation systems? how much of the walls and roof? Reportable if HVAC Yes or "a quarter or more"; Needs review if either is Not sure; Not reportable if No and Minor |
| Tenant Improvement | asks: will we design the lighting? Yes Reportable (interiors), Not sure Needs review, No Not reportable |
| Sustainability, Bridging/Criteria Documents | Needs review |
| Feasibility Study, Master Plan, Programming | Not reportable |

Responsibility (Prime, Consultant...) has no effect for now. Nothing else happens in Compass for AIA 2030: no digest, no champion. The sustainability team reads the flagged PiPs (as viewers).

## 4. Statuses (`workflow.js`, tested)

| Action | From | To | Who | Needs |
|---|---|---|---|---|
| Submit | | New | a principal or PM | a complete form |
| Start the review | New | In review | PiP admin | |
| Return with a note | New, In review | Returned | PiP admin | a note |
| Change and resubmit | Returned | New | **the person who submitted it** | a complete form |
| Mark created in Vantagepoint | New, In review | Created in Vantagepoint | PiP admin | the Vantagepoint project number |
| Withdraw | New, In review, Returned | Withdrawn | the submitter or a PiP admin | a reason |

Created and Withdrawn are final. Nothing is deleted. Every action quotes the status the person saw; if it moved meanwhile, nothing changes and they are asked to reload.

Once created, the page says whether the number is already in Compass's nightly copy of Vantagepoint.

## 5. Emails (queued; not sent yet)

| When | Who |
|---|---|
| Submitted or resubmitted | the principal and the PM on the form, the primary PiP admin (`pip.primaryAdmin`), and the CFO (`pip.cfo`) when the fee is at or over the threshold |
| Returned | whoever submitted it, with the note and a link |

Nothing else sends an email. The emails sit in `pip_notifications` and are listed in each PiP's history; Kent wires the sending to the firm's mail automation. They come from Compass, never in anyone's name.

## 6. Admin > Projects in Pursuit

- **Who reviews and who is told:** the PiP admins, the primary PiP admin, the CFO, the CFO amount.
- **Who else may look:** viewers; how many days the recent list covers.
- **Probability by stage:** a checkbox per stage and percent (10 to 90). Every stage needs at least one.

All are effective-dated settings like every other, in the audit log.

## 7. Not built, and open

See `docs/OPEN-QUESTIONS.md` (PIP1 to PIP6). Not built: sending the emails; an export of PiPs; a confirmation email when a PiP is created in Vantagepoint (not asked for).
