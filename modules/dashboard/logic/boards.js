/* ===== My dashboards: which ones a person has =====
   Pure. Tested from tests/fixtures/boards.json.
   There are two dashboards, each with its own curated dashparts and its own saved arrangement:
   - the PIC dashboard, for anyone who is principal in charge on at least one active project in Vantagepoint
   - the PM dashboard, for anyone who is project manager on at least one active project
   Someone who is both gets both; someone who is neither gets none. It follows the projects, not the Compass role, so a PIC
   who also manages a project sees the PM dashboard too, and it goes away when they no longer manage one.
   The Admin always has both, to see what people see and to curate the dashparts. */
'use strict';

const BOARDS = ['pic', 'pm'];
const BOARD_LABEL = { pic: 'PIC dashboard', pm: 'PM dashboard' };

/* person = { role, picProjects, pmProjects }: the counts of active Vantagepoint projects where they are PIC and PM */
function boardsFor(person) {
  if (!person) return [];
  if (person.role === 'admin') return BOARDS.slice();
  return BOARDS.filter(b => (b === 'pic' ? person.picProjects : person.pmProjects) > 0);
}

const boardsApi = { BOARDS, BOARD_LABEL, boardsFor };
if (typeof module !== 'undefined' && module.exports) module.exports = boardsApi;
else if (typeof window !== 'undefined') window.CompassDashboard = Object.assign(window.CompassDashboard || {}, boardsApi);
