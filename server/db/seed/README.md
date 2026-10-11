# Seed data

Everything here is made up (shapes follow the handoff mockup). Locally these CSVs stand in for two things that production replaces:

- `employees.csv`, `projects.csv`: the nightly copy from Vantagepoint (`EMMain`, `PR`). Column names follow the VP fields the validated SQL uses. **The project number format (`2024-0207`) is the mockup's, not a confirmed Vantagepoint format** (handoff open question about keys).
- `users.csv`: the People table. In production sign-in is the company login and Josh sets roles in Admin. `Employee` links a PIC to their Vantagepoint employee code.

`npm run seed` resets the local database to this data.
