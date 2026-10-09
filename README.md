# CampusWay

CampusWay is a University of Haifa student project for indoor and outdoor campus navigation, with multilingual guidance and accessibility profiles.

[Open the live app](https://ja4smin.github.io/CampusWay/)

![CampusWay campus map with a planned route and directions](docs/images/screenshots/main-03-outdoor-route.png)

| Indoor navigation | Phone layout | Hebrew interface |
|---|---|---|
| ![Indoor route on a floor plan](docs/images/screenshots/indoor-02-route-floor-plan.png) | ![CampusWay on a phone](docs/images/screenshots/mobile-03-route-directions.png) | ![Hebrew right-to-left interface](docs/images/screenshots/main-12-hebrew-rtl.png) |

## Features

- Outdoor routing along the mapped campus path network.
- Indoor routing between rooms and across floors.
- Connected journeys between buildings.
- English, Hebrew, Arabic and Russian interfaces.
- Accessibility profiles, including Mobility and Spatial routing.
- Search for rooms, buildings, food places, shops and campus services.
- Voice search and voice guidance.
- Saved favourites.

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

Choose the start and destination on the main campus screen. A mapped indoor room can be used as either point.

Open indoor navigation when the planned journey offers it. The indoor page restores the route automatically.

Indoor navigation modes:

- **Auto:** simulates movement for previews and demonstrations.
- **Phone Sensors:** estimates progress along the planned route from detected steps and calibrated phone heading.
- **Manual / Wheelchair:** advances between checkpoints when the user confirms reaching them.

Elevator and stairs transitions in Phone Sensors mode require user confirmation. Shared elevator journeys preserve the pending ride when switching between buildings.

## Accessibility and limitations

Mobility routing excludes mapped stairs. If no mapped step-free route is available, the app reports that instead of drawing an unverified fallback.

Accessibility depends on the accuracy and completeness of the mapped network. A calculated route does not verify current physical conditions.

Indoor sensor positioning is an estimate. It does not detect whether the user has left the planned route, and it requires testing on real phones.

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

CampusWay is a student project under active development. Mapping coverage, device testing and guidance continue to be refined.

## Team

- Jasmin Taya ([@ja4smin](https://github.com/ja4smin))
- Hadeel Hamodi ([@hadeel-hamodi](https://github.com/hadeel-hamodi))
- Naseem Muhammad
- Shady Salem

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Map library: [Leaflet](https://leafletjs.com/).
