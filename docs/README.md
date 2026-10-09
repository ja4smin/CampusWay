# CampusWay documentation

This folder holds all of CampusWay's project documentation: what the app does, how to use it, how it is built, and how to work on it. The source code is documented as it stands on the `main` branch (October 2026).

Start with **[01 · Project overview](01-project-overview.md)** if you are new to the project.

## Contents

| # | Document | What it contains |
|---|---|---|
| 01 | [Project overview](01-project-overview.md) | The problem, goals, target users, campus coverage, key numbers, and how the app works at a glance |
| 02 | [Features](02-features.md) | Complete list of features, grouped by area, with screenshots |
| 03 | [User guide](03-user-guide.md) | Step-by-step instructions for using the app, from choosing a language to arriving at a room |
| 04 | [Requirements](04-requirements.md) | Functional and non-functional requirements, plus device, browser and development requirements |
| 05 | [Architecture](05-architecture.md) | System context, components, file structure, page hand-off, storage, PWA and offline design |
| 06 | [User flows](06-user-flows.md) | Flow diagrams for every major journey: route planning, multi-building trips, indoor modes, shelter |
| 07 | [Routing and navigation algorithms](07-routing-and-navigation-algorithms.md) | Outdoor and indoor path finding, accessibility rules, ETA, turn instructions, step and heading detection |
| 08 | [Data model](08-data-model.md) | Campus data, indoor graph JSON schema, live-status file, storage keys, URL parameters, data statistics |
| 09 | [Technology stack](09-technology-stack.md) | Languages, libraries, browser APIs, data sources and tooling |
| 10 | [Testing](10-testing.md) | Automated test suite, how to run it, coverage, and a manual test checklist for real phones |
| 11 | [Installation and deployment](11-installation-and-deployment.md) | Running locally, publishing on GitHub Pages, installing as an app, releasing updates |
| 12 | [Accessibility](12-accessibility.md) | Accessibility profiles, inclusive-design features, and their limits |
| 13 | [Developer tools and indoor mapping](13-developer-tools-and-mapping.md) | WayFrame graph editor, test pages, debug options, and how to map a building |
| 14 | [Limitations and future work](14-limitations-and-future-work.md) | Known limitations of the current version and ideas for further development |
| 15 | [Glossary](15-glossary.md) | Terms used in the code and in these documents |
| 16 | [Team and credits](16-team-and-credits.md) | Contributors and third-party software and data |
| 17 | [Admin screen and local server](17-admin-screen.md) | Managing reports, live status, announcements and content from one PC; where the data is kept; roles and privacy |

## Supporting folders

| Folder | What it contains |
|---|---|
| [`diagrams/`](diagrams/README.md) | Every diagram as editable Mermaid source (`.mmd`) plus PNG and SVG exports for reports and slides |
| [`images/screenshots/`](images/screenshots/README.md) | Screenshots of the app's screens and features |

## Also in the project root

| File | What it contains |
|---|---|
| [`README.md`](../README.md) | Project front page: summary, live link, how to run and test |
| [`CHANGELOG.md`](../CHANGELOG.md) | Development history by milestone |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Team workflow, coding conventions and a pre-merge checklist |
