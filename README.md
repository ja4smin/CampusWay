# CampusWay

CampusWay is an accessible campus navigation app developed as a University of Haifa student project for the Accessibility and Learning Disabilities Unit. It supports the mobility, visual and sensory needs of students with disabilities through connected indoor and outdoor journeys, navigation profiles and multilingual guidance.

Indoor navigation covers six buildings: Terrace (Madriga), Main, Rabin, Student House, Education and Multi-Purpose.

[Open the live app](https://ja4smin.github.io/CampusWay/) · [Open demonstration mode](https://ja4smin.github.io/CampusWay/?demo=1) · [User guide](docs/03-user-guide.md)

![CampusWay campus map with a planned route and directions]![alt text](image.png)

| Indoor navigation | Phone layout | Hebrew interface |
|---|---|---|
| ![Indoor route on a floor plan]![alt text](image-1.png) | ![CampusWay on a phone]![alt text](image-2.png)| ![Hebrew right-to-left interface]![alt text](image-3.png) |

## Features

- Outdoor routing along the mapped campus path network.
- Indoor routing between rooms and across floors, using elevators and stairs.
- Continuous indoor–outdoor journeys and shared indoor connections between buildings.
- Five navigation profiles: General User, Mobility, Visual Impairment, Spatial / Navigation, and Sensory & Wellbeing Support.
- English, Hebrew, Arabic and Russian interfaces.
- Search for rooms, buildings, food places, shops and campus services.
- Services Near Me, including nearest restrooms and smoking areas, selectable quiet spaces, and shelter routing.
- An “I need a break” route to a nearby rest space for Sensory & Wellbeing Support.
- Voice search, spoken guidance, adjustable text size and high contrast.
- Saved favourites and one-time location sharing.
- Demonstration mode with simulated movement.

## Run locally

Install Node.js, then open a terminal in the project folder and run:

```powershell
npx.cmd http-server . -p 8080 -c-1
```

Open:

http://localhost:8080/

Keep the terminal open while using the app. Press Ctrl+C to stop the server.

A static HTTP server is the local preview setup used for this project.

## Admin screen

The campus team can manage problem reports, elevator outages, closures, announcements, place names and opening hours from an admin screen. It runs on one PC with the CampusWay local server, which uses only Node.js and saves to JSON files in `server/db/` (no database account or cloud service):

```powershell
node server/campusway-server.js
```

Then open http://localhost:8080/admin.html (or double-click `start-admin.bat`). The first visit creates the administrator account. See [docs/17-admin-screen.md](docs/17-admin-screen.md).

To also receive reports from the public GitHub Pages site, set up the optional free cloud inbox in [`cloud/`](cloud/README.md); the admin screen's **Cloud inbox** page walks through it.

## Plan a route

Choose your **From** and **To** locations from the search suggestions. A mapped indoor room can be used as either point.

For a journey starting indoors, select **Start indoor route**, review the indoor route, then press **Start**. Outdoor guidance begins automatically when the outdoor route is ready.

Use **Continue outdoors** or **Continue indoors** when prompted to move between parts of the same journey. Completed stages are ticked off in **Your journey**.

Navigation behaviour:

- **Sensor-based indoor navigation:** estimates progress along the planned route using detected steps and calibrated phone heading. Confirm floor changes and arrival when prompted, after physically reaching them.
- **Mobility profile:** avoids mapped stairs and uses manual checkpoint confirmation for indoor progress.
- **Demonstration mode:** simulates indoor and outdoor movement without physically walking. Open the app with `?demo=1` to use it.

Shared elevator journeys between Terrace (Madriga) and Rabin continue between the buildings as part of the same journey.

Select **Cancel journey** to end a journey. In demonstration mode, movement pauses while the confirmation is open and resumes if you choose **No**.

## Accessibility and limitations

Mobility routing excludes mapped stairs. If no mapped step-free route is available, the app reports that instead of drawing an unverified fallback.

Accessibility depends on the accuracy and completeness of the mapped network. A calculated route does not verify current physical conditions.

Indoor sensor navigation is a prototype and estimates position along the planned route. It does not reliably detect whether the user has left that route.

Phone sensor access requires a secure context. Use the HTTPS live app for phone testing; a local network HTTP address may not support sensors.

Speech and voice-search support vary by browser and installed voices.

## Tests

Run the full test suite from the project folder:

```powershell
node --test tests/*.test.cjs
```

Run the navigation integration tests:

```powershell
node --test tests/step-integration.test.cjs
```

Automated tests cover routing, search, sensor logic and journey transitions. They complement manual browser and real-phone testing.

## Project structure

- `index.html` — main campus map and route planning.
- `app/prototype/` — campus data and routing logic.
- `app/ui/` — interface styles and supporting UI code.
- `buildings/` — indoor graph JSON files and floor plans.
- `wayframe/navigation-demo.html` — indoor navigation.
- `wayframe/` — route planning, sensor and checkpoint helpers.
- `tests/` — automated tests.
- `service-worker.js` — offline caching and app updates.
- `docs/` — project documentation, diagrams and screenshots.

## Development notes

The team uses separate branches to review and combine changes before merging them into `main`.

Interface changes should preserve existing routing and journey behaviour. Validation includes automated tests and manual navigation checks.

Offline app files are managed in `service-worker.js` through `CACHE_NAME` and `APP_FILES`.

The interface supports English, Hebrew, Arabic and Russian.

## Documentation

Full project documentation is in the [`docs/`](docs/README.md) folder:

| Topic | Document |
|---|---|
| Overview, goals and coverage | [Project overview](docs/01-project-overview.md) |
| What the app can do | [Features](docs/02-features.md) |
| How to use it | [User guide](docs/03-user-guide.md) |
| Functional and non-functional requirements | [Requirements](docs/04-requirements.md) |
| How it is built | [Architecture](docs/05-architecture.md) |
| Flow diagrams | [User flows](docs/06-user-flows.md) |
| Routing, sensors and instructions | [Routing and navigation algorithms](docs/07-routing-and-navigation-algorithms.md) |
| Data formats and statistics | [Data model](docs/08-data-model.md) |
| Technologies | [Technology stack](docs/09-technology-stack.md) |
| Tests and manual checklist | [Testing](docs/10-testing.md) |
| Running, publishing and updating | [Installation and deployment](docs/11-installation-and-deployment.md) |
| Accessibility design | [Accessibility](docs/12-accessibility.md) |
| WayFrame and mapping a building | [Developer tools and indoor mapping](docs/13-developer-tools-and-mapping.md) |
| What is missing and what is next | [Limitations and future work](docs/14-limitations-and-future-work.md) |
| Terms | [Glossary](docs/15-glossary.md) |
| People and third-party credits | [Team and credits](docs/16-team-and-credits.md) |

See also [`CHANGELOG.md`](CHANGELOG.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Project status

Submission version: October 2026.

CampusWay remains under active development. Mapping coverage, device testing and guidance continue to be refined. Indoor sensor navigation is a prototype.

## Team and credits

- Jasmin Taya ([@ja4smin](https://github.com/ja4smin))
- Hadeel Hamodi ([@hadeel-hamodi](https://github.com/hadeel-hamodi))
- Naseem Muhammad ([@iNaseemMuh](https://github.com/iNaseemMuh))
- Shady Salem ([@ShakyShako](https://github.com/ShakyShako))

**Client:** Accessibility and Learning Disabilities Unit, University of Haifa.

**Supervisor:** Professor Anna Zmansky.

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Map library: [Leaflet](https://leafletjs.com/).
