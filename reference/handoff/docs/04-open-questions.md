# Open questions: do not guess

**Ask Josh or Kent.** Where a default is noted, build it behind a setting.

1. **Stack and hosting** (Kent): language, database (Postgres vs SQL Server), where the monthly job runs, SSO provider, how Vantagepoint is reached (ODBC/SQL, read-only service account, network path).
2. **Marketing director access:** the decided rule says BD + Pipeline; the mockup Admin roles text also says Turnaround. Confirm. Default: BD + Pipeline only.
3. **BD and Pipeline source queries do not exist yet.** Revenue billed by PIC and by market sector, contracted forecast through Dec 31, and MWIP/pursuit data (where do pursuits live: Vantagepoint opportunities, a CRM, a spreadsheet?). Josh has the Turnaround SQL only.
4. **MWIP in BD:** is the "MWIP backlog" column stored raw and weighted at calculation time, or already weighted? The mock's Total projected is the plain sum of the displayed columns, which suggests the column is the weighted value. Confirm before building.
5. **Home "Firm snapshot":** utilization YTD (and target) and net profit % have no defined source. Build as optional tiles hidden until a source exists.
6. **First-run history:** Turnaround charts compare to last year and "since last month." Are prior months' runs imported from the Excel workbook, or does history start at go-live?
7. **PIC identity mapping:** map Vantagepoint `Principal` employee code to a SSO user. Who maintains it (People tab)? Projects whose PIC is blank: default "leave out and warn".
8. **Projects with multiple overhead rates** can't be profit-calculated by the validated query; they are reported as warnings. Does Josh want a fallback rule?
9. **Email:** how does Josh's one daily email send (SMTP relay / Graph API / company mail)? "Open in Outlook" = mailto vs Outlook web deep link; confirm what works on the firm's setup.
10. **Final module/product name** ("Compass" is working) and a vector logo.
11. **Data retention** for plan logs and archived runs (default: forever).
12. **Peer-review suggestions** from an earlier AI review of the draft engine are not yet decided. Ask Josh before adopting anything from `reference/`.
