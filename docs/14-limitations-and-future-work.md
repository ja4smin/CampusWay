# 14 · Limitations and future work

> An honest list of what the current version of CampusWay does not do, or does only approximately, followed by ideas for future development.

## 1. Known limitations

### Positioning and navigation

| Limitation | Impact | Why |
|---|---|---|
| Phone Sensors mode estimates position along the **planned route** only | Leaving the route is not detected; the marker can drift | No indoor positioning infrastructure (beacons, Wi-Fi fingerprinting) is available; step counting is relative |
| Fixed step length (0.65 m) | Distance error grows for people with shorter or longer steps | No per-user calibration yet |
| Phone must be held upright in portrait | Position updates pause when the phone is pocketed or tilted | The heading is only reliable in this posture |
| Walking backwards without turning around is not supported | Steps are treated as ambiguous | Direction comes from the phone's heading |
| Sensor mode shows "estimated arrival" rather than an arrival dialog | The user checks the room sign | Arrival cannot be confirmed by sensors |
| Outdoor guidance is not live-tracked | The outdoor route is a map with directions; the user's position is not followed | GPS is only used for the start point |

### Map data and coverage

| Limitation | Details |
|---|---|
| Indoor maps for 6 of 10 buildings | Eshkol Tower, Arts, Bloom, and Welfare and Health are outdoor only |
| Multi-Purpose Building is incomplete | Floor 0 has no connections, floors −1 and 2 are empty, and its stairs and elevators have no connector IDs, so indoor navigation works on floor 1 only; the copy used by campus search (`multi-purpose-graph.js`) is older than the JSON file |
| Step-free gaps | Terrace Building floors 0 and −1 have no mapped elevator, so no step-free route reaches them |
| One scale for all floor plans | Indoor distances and times use 132.6 m × 101.2 m for every drawing, so they are approximate |
| Data quality | Some nodes still have placeholder labels; 84 of 194 stairs and elevator nodes have no connector ID (so they are not linked between floors); some restroom names are machine-translated |
| Outdoor network | Based on an OpenStreetMap snapshot plus hand corrections; it must be refreshed by hand when paths change |
| Duplicate graph copies | `madriga-graph.js` and `multi-purpose-graph.js` must be kept in sync with their JSON files by hand |

### Platform and infrastructure

| Limitation | Details |
|---|---|
| Reports from the public site need the cloud inbox | With the optional free cloud inbox set up, reports from the GitHub Pages site reach the admin screen when the PC fetches them; without it they stay on the reporter's device ([17 · Admin screen](17-admin-screen.md)) |
| Status changes are published with git | The admin screen writes `campus-status.json` on the PC; it reaches the GitHub Pages site after a commit and push |
| Map tiles need internet | Offline, the map shows overlays without streets |
| Large offline package | About 100 MB on the first install, mostly floor plans |
| Session-only preferences | Language and profile are kept per browser session; high contrast and the audio guide are not restored after a reload |
| Browser-dependent features | Voice search, available voices and sensor permissions differ between browsers and devices |

### Languages

- Arabic shows Hebrew names for buildings and places, because Arabic names are not in the data yet.
- A few status and error messages are English only.

## 2. Future work

### Short term

- [ ] Finish the Multi-Purpose Building graph (floor 0 connections, floors −1 and 2, connector IDs) and refresh its JS copy.
- [ ] Map an elevator for Terrace floors 0 and −1, or document the step-free alternative.
- [ ] Add Arabic names for buildings and places.
- [ ] Remember high contrast and the audio guide between visits.
- [ ] Generate the JS graph copies from the JSON files automatically (or load the JSON directly).
- [ ] Add a per-building, per-floor scale (metres per unit) to each graph file.
- [ ] Add a data-validation test: isolated nodes, missing connector IDs, entrances that are not `entrance` nodes, placeholder labels.

### Medium term

- [ ] **Step-length calibration:** walk a known distance once and store the user's step length.
- [ ] **Off-route detection** in sensor mode (e.g. heading persistently differs from every route candidate).
- [ ] **Live outdoor guidance:** follow GPS along the outdoor route and announce turns.
- [x] **Reports and status on one PC:** the CampusWay local server and admin screen ([17](17-admin-screen.md)).
- [x] **Cloud inbox** (a free Cloudflare Worker, [`cloud/`](../cloud/README.md)), so reports from the public site also reach the facilities team.
- [ ] **Accessibility audit** with screen readers (TalkBack, VoiceOver) and with users from each profile group.
- [ ] Move the journey logic (`routeTo`) and the indoor-page logic out of the HTML files into tested modules.
- [ ] Continuous integration (GitHub Actions) to run the tests on every pull request.

### Long term

- [ ] Indoor positioning with Bluetooth beacons or Wi-Fi fingerprinting in key buildings.
- [ ] Map the remaining buildings (Eshkol Tower, Arts, Bloom, Welfare and Health).
- [ ] Crowd and noise information for rest spaces.
- [ ] Timetable integration ("navigate to my next class").
- [x] An admin page for editing the campus status without touching JSON (`admin.html`).
