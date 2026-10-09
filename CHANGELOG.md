# Changelog

The development history of CampusWay, grouped by milestone and summarised from the Git commit history. CampusWay is deployed continuously from `main`; the service-worker cache name (`campusway-vNN`) changes with each release (currently `campusway-v41`).

## 2026-10-09 · Admin screen and local server

**Added**
- `admin.html`: reports inbox, live status editor (elevator outages, indoor closures on the floor plan, outdoor zones, noisy areas) with route-impact previews, announcements and emergency mode, place names and opening hours, map data-health checks, usage insights, admin accounts with roles, activity log and status-file history.
- `server/campusway-server.js`: a local server with no dependencies that serves the app and saves reports, admin accounts, usage counts and the audit log as JSON files in `server/db/` (git-ignored). `start-admin.bat` starts it on Windows.
- The app sends problem reports and anonymous usage counts to the local server when it is opened from it, and shows reporters the status of their reports; nothing changes on GitHub Pages.
- Announcement and emergency banners on the campus map and indoor pages; name corrections from the status file.
- 55 new tests: emergency shelter routing, live status in routing, campus reachability, map data integrity, shared links, opening hours and offline caching (320 in total).
- Admin **Tests** page: runs the automated tests on the PC and shows passes, failures and error details (administrators only).
- Admin **Storage** page with a 10 GB limit for the PC's data and storage and daily caps for the cloud inbox.
- Cloud inbox (`cloud/`): a free Cloudflare Worker + D1 that collects reports and usage counts from the public site. The PC server fetches them every 5 minutes and sends report statuses back; the admin screen's **Cloud inbox** page walks through the setup.

**Fixed**
- Nearest shelter for the Mobility profile: no longer picks an entrance or shelter that has no step-free route (it used to fall back to a straight-line guess, sending wheelchair users towards routes the app then refused to draw); says honestly when no step-free shelter exists.
- Nearest shelter and journey times now respect live elevator outages and closures, like the indoor page; closed shelters are never offered.
- Searching for a route that only stairs could reach took over a second each time (a mapping diagnostic compared every pair of path points); the shelter search is about 14× faster.
- Shared links to a place with several branches (Pilpelet Cafe) opened the wrong branch; such links now name the building (old links still work).

## 2026-10-04 – 2026-10-06 · Polish, integration and documentation

**Added**
- Finished Education and Science indoor graph; updated Multi-Purpose indoor graph.
- Voice search for the starting point; rest-space previews on the map.
- Project README.
- Translated floor-plan toggle in indoor navigation; the schematic map is the default view.
- Translated indoor turn instructions and new direction icons.

**Changed**
- Merged the *Enhance-UI-UX* branch (interface and experience improvements).
- Favourites are the default tab; standalone indoor shortcuts hidden from the campus screen.
- Compact shelter button on phones; building labels shown at closer zoom.
- Simplified indoor route controls; manual destination arrival needs one confirmation; removed redundant outdoor exit confirmations.

**Fixed**
- Shared-elevator rides are preserved across building transfers (with tests); stale route guidance is cleared.
- Sensor pause recovery and reverse-direction retries (Hadeel's branch integrated).

## 2026-10-01 – 2026-10-03 · Search, favourites and multi-building journeys

**Added**
- Persistent favourites for rooms and places.
- Multilingual place search; audio tools; translated map popups and destination labels.
- Expanded place search and starting points; better service labels.
- Comparison of shared indoor transfers (stairs vs elevator); automatic indoor route display.

**Changed**
- Integrated the route planner, wheelchair navigation and sensor improvements into one flow.
- Unified indoor graph sources (one Rabin graph; Student House was unified on 2026-09-28).

**Fixed**
- Indoor transition hand-off logic; navigation resumes across shared building transfers.
- Sensor calibration and stairs floor confirmation.

## 2026-09-26 – 2026-09-30 · Accessibility profiles and campus-wide routing

**Added**
- *Mobility* routes that safely avoid stairs; step-free wheelchair checkpoint navigation.
- *Spatial* routing with fewer turns; suggested rest spaces (*Mental Health Support*).
- Multi-building routing Main → Terrace, with full ETA across buildings.
- Indoor routing to campus food places and to the Yozma shop; shops and indoor shelter services; service filters.
- Terrace gym routing; Student House routes and entrances; outdoor elevator and stairs markers.
- Cross-building routes resume after indoor navigation.

**Changed**
- Many updates to the outdoor routing graph, campus paths and building entrances (Main, Rabin, Terrace, Multi-Purpose, Student House).
- App updates activate without reopening tabs.

**Fixed**
- Same-building indoor routing and outdoor transitions; Madriga ↔ Main routing chain; starting-room search.

## 2026-09-24 – 2026-09-25 · Continuous room-to-room navigation

**Added**
- Continuous room-to-room navigation flow (indoor → outdoor → indoor).
- Room search for starting points; verified entrance hand-offs for all mapped buildings.
- Main ↔ Rabin bridge routing; Terrace (Madriga) ↔ Rabin indoor transfer.
- Accessible entrance filtering for outdoor routes; WayFrame remembers the last selected floor.

**Fixed**
- Calibrated turnarounds and recovery after temporary phone tilt in sensor navigation.
- Indoor distance calibration.

## 2026-09-19 – 2026-09-23 · Outdoor routing, PWA and floor plans

**Added**
- OpenStreetMap-based outdoor routing with a campus correction layer and pedestrian crossings; route distance used for walking ETA.
- Progressive Web App with offline support (service worker, manifest); local OSM data.
- Floor-plan backgrounds in indoor navigation for all buildings (by Hadeel).
- Nearby campus services; indoor services in search and navigation.
- Room search with indoor hand-off for Main, Rabin and Student House; then Education and Multi-Purpose.
- Multilingual indoor navigation.

**Changed**
- OpenStreetMap base tiles restored on the campus map (pull request #1 by Hadeel).
- Step detection shared between pages and tuned for slower walking.
- Expanded offline cache.

## 2026-09-12 – 2026-09-18 · Phone sensors and the first connected app

**Added**
- Indoor navigation with route testing.
- Phone step detection, tuned with real sensor readings: cadence validation, orientation-stability filtering, smooth movement.
- Heading sensor test and standalone sensor test page; live map rotation with phone heading.
- Accessible (step-free) indoor routing.
- Main app published and connected to indoor navigation, with room search, mobile layout and return to the campus map.

**Changed**
- Indoor navigation uses real-world distances.

## 2026-08-26 – 2026-09-10 · Mapping foundation

**Added**
- **WayFrame** node plotter for drawing indoor graphs: undo/redo, zoom, node editing, published-graph loading, remembered building.
- Node types: food, gym, restroom, shelter, library, museum, parking, clinic.
- Building folder structure and floor plans for Main, Multi-Purpose, Rabin, Student House, Education and Terrace.
- Indoor graphs for Terrace (Madriga), Main Building and Rabin Building; Rabin room-number prefixes.
