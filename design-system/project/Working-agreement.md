# Working agreement

> **Since the Toolbox moved into a GitHub repo, the repo copy of the design system is the master.** Change it there, then refresh the published design-system artifact. The steps below describe the earlier single-page workflow.

How to design with this system, for Josh and for Claude in any chat.

## Telling Claude to use it
Start a task with: "Use the Toolbox design system" and paste this artifact's link (https://claude.ai/artifact/Xv2u5mQf49mezVrq74cBZx). Claude should read README.md, tokens.json and components/bundle.css, and the READMEs of any components the screen uses, before writing UI.

## Rules for any app
1. Colors, sizes, spacing, radii and shadows come from tokens. No hex values and no raw `nx-*` colors in app code.
2. UI is built from the classes in `components/bundle.css` (`.btn`, `.txt`, `.field`, `.chip`, `.banner`, `.dlg`, `.menu`, `.seg`, `.plist` and so on). Do not restyle them in the app.
3. Icons come from `Toolbox.ICONS`. Preferences use `Toolbox.pref` (keys are `toolbox:*`).
4. If the screen needs something the system lacks, build it in the app with tokens only, flag it as a candidate, and promote it here once a second app uses it.

## Changing the design
1. Say what changed and why ("make primary buttons the brand blue", "tighten page gutters").
2. Edit the system first: token values in `tokens.json` (the page's token editor does this too), rules in `components/bundle.css`, rules of use in the READMEs. Add a line to the Changelog.
3. Sync every app: run `tools/build_css.py`, replace the app's embedded tokens and component CSS with the output, and replace icons or helpers if `bundle.js` changed.
4. Run `tools/audit.py <app.html>` on each app. It must report no missing tokens, no redefined core tokens and no hard-coded colors outside the allowed list.

Never fix a look in one app only. If an app differs from the system, the app is wrong or the system needs an update; decide which, then make both agree.
