const CampusOutdoorRouting = (() => {

  // University of Haifa / Mount Carmel routing area
  const BOUNDS = {
    south: 32.7570,
    west: 35.0140,
    north: 32.7680,
    east: 35.0250
  };

  // Lower cost = preferred walking route
  const TYPE_COST = {
    footway: 1.00,
    pedestrian: 1.00,
    path: 1.05,
    living_street: 1.20,
    steps: 1.30,
    service: 2.50,
    residential: 3.00
  };

  const graph = new Map();
  const coordinates = new Map();

  let loaded = false;
  let loadingPromise = null;

  let rawOsmData = null;

  // --------------------------------------------------
// CampusWay outdoor graph corrections
// --------------------------------------------------

// Verified missing walkway connections can be added here.
// Keep this empty until a connection has been confirmed.
const CAMPUS_CORRECTIONS = [
  {
    fromNode: 2102963372,
    toNode: 1446999286,
    type: 'footway'
  }
];

  // --------------------------------------------------
  // Distance between two GPS coordinates in meters
  // --------------------------------------------------

  function distance(a, b) {

    const R = 6371000;

    const lat1 = a[0] * Math.PI / 180;
    const lat2 = b[0] * Math.PI / 180;

    const dLat =
      (b[0] - a[0]) * Math.PI / 180;

    const dLon =
      (b[1] - a[1]) * Math.PI / 180;

    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(
      Math.sqrt(x),
      Math.sqrt(1 - x)
    );
  }


  // --------------------------------------------------
  // Add connection between two OSM nodes
  // --------------------------------------------------

  function addEdge(aId, bId, type) {

    if(
      !coordinates.has(aId) ||
      !coordinates.has(bId)
    ){
      return;
    }

    if(!graph.has(aId)){
      graph.set(aId, []);
    }

    if(!graph.has(bId)){
      graph.set(bId, []);
    }

    const a = coordinates.get(aId);
    const b = coordinates.get(bId);

    const meters = distance(a, b);

    const multiplier =
      TYPE_COST[type] || 2;

    graph.get(aId).push({
      node: bId,
      weight: meters * multiplier,
      meters,
      type
    });

    graph.get(bId).push({
      node: aId,
      weight: meters * multiplier,
      meters,
      type
    });
  }

function removeEdge(aId, bId){

  if(graph.has(aId)){
    graph.set(
      aId,
      graph.get(aId).filter(
        edge => edge.node !== bId
      )
    );
  }

  if(graph.has(bId)){
    graph.set(
      bId,
      graph.get(bId).filter(
        edge => edge.node !== aId
      )
    );
  }
}


  function addCampusNode(id, lat, lng){

  coordinates.set(
    id,
    [lat, lng]
  );

  if(!graph.has(id)){
    graph.set(id, []);
  }
}

function findClosestEdge(lat, lng){

  const point = [lat, lng];

  let best = null;
  let bestDistance = Infinity;

  const checked = new Set();

  for(const [nodeA, edges] of graph.entries()){

    const a = coordinates.get(nodeA);
    if(!a) continue;

  for(const edge of edges){

  const nodeB = edge.node;

  // Ignore CampusWay custom correction edges.
  // We only want to find the original OSM path underneath the point.
  if(
    String(nodeA).startsWith('campus_') ||
    String(nodeB).startsWith('campus_')
  ){
    continue;
  }

      const key = [String(nodeA), String(nodeB)]
        .sort()
        .join('-');

      if(checked.has(key)){
        continue;
      }

      checked.add(key);

      const b = coordinates.get(nodeB);
      if(!b) continue;

      // Approximate locally as a flat plane.
      const x = point[1];
      const y = point[0];

      const x1 = a[1];
      const y1 = a[0];

      const x2 = b[1];
      const y2 = b[0];

      const dx = x2 - x1;
      const dy = y2 - y1;

      const lengthSquared =
        dx * dx + dy * dy;

      if(lengthSquared === 0){
        continue;
      }

      let t =
        ((x - x1) * dx +
         (y - y1) * dy) /
        lengthSquared;

      t = Math.max(0, Math.min(1, t));

      const projected = [
        y1 + t * dy,
        x1 + t * dx
      ];

      const d =
        distance(point, projected);

      if(d < bestDistance){

        bestDistance = d;

        best = {
          nodeA,
          nodeB,
          coordinateA: a,
          coordinateB: b,
          projectedCoordinate: projected,
          distanceMeters: d,
          type: edge.type
        };
      }
    }
  }

  return best;
}

  // --------------------------------------------------
// Apply verified CampusWay corrections to OSM graph
// --------------------------------------------------

function applyCampusCorrections(){



// Carmel Gate crossing — campus side
addCampusNode(
  'campus_carmel_crossing_campus',
  32.75922876009188,
  35.02143144607545
);

// Insert gate side into the existing service-road segment
removeEdge(
  1447013831,
  1387533543
);


// Insert campus side into the existing footway
removeEdge(
  1446999275,
  1446999294
);

addEdge(
  1446999275,
  'campus_carmel_crossing_campus',
  'footway'
);

addEdge(
  'campus_carmel_crossing_campus',
  1446999294,
  'footway'
);

// ==================================================
// CARMEL GATE — ADDITIONAL WALKING PATH
// ==================================================

addCampusNode(
  'campus_carmel_path_1',
  32.75897782327304,
  35.02154342830181
);

addCampusNode(
  'campus_carmel_path_2',
  32.759147558142494,
  35.021310076117516
);

// Carmel path — intermediate point between path 2 and path 3
addCampusNode(
  'campus_carmel_path_2_5',
  32.7596308214307,
  35.02070356160403
);

addCampusNode(
  'campus_carmel_path_3',
  32.759864275568546,
  35.02045042812825
);

addCampusNode(
  'campus_carmel_path_4',
  32.76002822880308,
  35.020339787006385
);

// Carmel path 2 → campus side of the crossing
addEdge(
  'campus_carmel_path_2',
  'campus_carmel_crossing_campus',
  'footway'
);

// Carmel Gate OSM path → custom path 1
addEdge(
  2065458945,
  'campus_carmel_path_1',
  'footway'
);

// Custom path 1 → custom path 2
addEdge(
  'campus_carmel_path_1',
  'campus_carmel_path_2',
  'footway'
);

// Path 2 → intermediate point
addEdge(
  'campus_carmel_path_2',
  'campus_carmel_path_2_5',
  'footway'
);

// Intermediate point → path 3
addEdge(
  'campus_carmel_path_2_5',
  'campus_carmel_path_3',
  'footway'
);

// Carmel path 3 → Carmel path 4
addEdge(
  'campus_carmel_path_3',
  'campus_carmel_path_4',
  'footway'
);

// Carmel path 4 → existing OSM path
addEdge(
  'campus_carmel_path_4',
  7676581028,
  'footway'
);

// Carmel path 2.5 → existing OSM path
addEdge(
  'campus_carmel_path_2_5',
  1446999294,
  'footway'
);

// --------------------------------------------------
// Main Building <-> Education Building zebra crossing
// Verified physically on campus
// --------------------------------------------------

// ==================================================
// MAIN BUILDING — MAIN ENTRANCE
// ==================================================

// Main Building main entrance
addCampusNode(
  'campus_main_entrance',
  32.762029618113814,
  35.01840457320214
);

// Path point beside the Main entrance
addCampusNode(
  'campus_main_entrance_path',
  32.76198944133903,
  35.01835159957409
);

// Main entrance → entrance path
addEdge(
  'campus_main_entrance',
  'campus_main_entrance_path',
  'footway'
);

// Education side of the Main ↔ Education zebra crossing
addCampusNode(
  'campus_main_education_crossing_west',
  32.761717,
  35.018604
);

// Split existing west-side footway
removeEdge(
  9255990877,
  9255990878
);


// Main side of the Main ↔ Education zebra crossing
addCampusNode(
  'campus_main_education_crossing_east',
  32.76176078580541,
  35.01864949241281
);

addEdge(
  'campus_main_education_crossing_east',
  'campus_main_entrance_path',
  'footway'
);
// Split existing east-side segment
removeEdge(
  7674525963,
  7674525964
);


// Connect both sides through the verified zebra crossing
addEdge(
  'campus_main_education_crossing_west',
  'campus_main_education_crossing_east',
  'footway'
);

// --------------------------------------------------
// Education-side zebra approach
// --------------------------------------------------

addCampusNode(
  'campus_main_education_crossing_approach',
  32.76174358727667,
  35.01856734976173
);

// New approach → Education side of zebra
addEdge(
  'campus_main_education_crossing_approach',
  'campus_main_education_crossing_west',
  'footway'
);

// New approach → existing OSM node
addEdge(
  'campus_main_education_crossing_approach',
  9255990878,
  'footway'
);

// --------------------------------------------------
// Rabin Floor 7 exit -> outdoor plaza
// --------------------------------------------------

addCampusNode(
  'campus_rabin_floor7_exit',
  32.7611893,
  35.0203915
);

addCampusNode(
  'campus_rabin_floor7_plaza',
  32.7609968,
  35.0201634
);

addEdge(
  'campus_rabin_floor7_exit',
  'campus_rabin_floor7_plaza',
  'footway'
);

addCampusNode(
  'campus_rabin_floor7_right_path',
  32.7610884,
  35.0200528
);

addEdge(
  'campus_rabin_floor7_plaza',
  'campus_rabin_floor7_right_path',
  'footway'
);

addCampusNode(
  'campus_rabin_floor7_lower_path',
  32.7610547,
  35.0198543
);

addEdge(
  'campus_rabin_floor7_right_path',
  'campus_rabin_floor7_lower_path',
  'footway'
);

addCampusNode(
  'campus_rabin_floor7_street',
  32.7610031,
  35.0197058
);

addEdge(
  'campus_rabin_floor7_lower_path',
  'campus_rabin_floor7_street',
  'footway'
);

addCampusNode(
  'campus_rabin_floor7_street_join',
  32.761000844805366,
  35.019637016563756
);
removeEdge(
  1447013840,
  2102958523
);

addEdge(
  1447013840,
  'campus_rabin_floor7_street_join',
  'service'
);

addEdge(
  'campus_rabin_floor7_street_join',
  2102958523,
  'service'
);

addEdge(
  'campus_rabin_floor7_street',
  'campus_rabin_floor7_street_join',
  'footway'
);

// --------------------------------------------------
// Main -> Multi-Purpose sidewalk
// --------------------------------------------------

addCampusNode(
  'campus_multi_sidewalk_top',
  32.7600705,
  35.0205183
);

// Multi-Purpose sidewalk → lower Madriga path
addEdge(
  'campus_multi_sidewalk_top',
  'campus_madriga_downhill_1',
  'footway'
);

// Lower Madriga path → existing OSM street
addEdge(
  'campus_madriga_downhill_1',
  7676581029,
  'footway'
);

addEdge(
  'campus_multi_sidewalk_top',
  1446999294,
  'footway'
);

// Madriga upper bump
addCampusNode(
  'campus_madriga_upper_bump',
  32.76041069119393,
  35.02074413001538
);

// ==================================================
// MADRIGA UPPER BUMP JUNCTION
// ==================================================

// Junction beside the upper bump
addCampusNode(
  'campus_madriga_upper_bump_junction',
  32.76037826724371,
  35.020787883549936
);

// Junction → upper bump
addEdge(
  'campus_madriga_upper_bump_junction',
  'campus_madriga_upper_bump',
  'footway'
);

// Junction → lower existing OSM street node
addEdge(
  'campus_madriga_upper_bump_junction',
  7676581029,
  'footway'
);

// Junction → upper existing OSM street node
addEdge(
  'campus_madriga_upper_bump_junction',
  7676581030,
  'footway'
);

// --------------------------------------------------
// Terrace Building Floor 1 standard approach
// Uses the physical bump / step near the building
// --------------------------------------------------



addCampusNode(
  'campus_madriga_upper_path_2',
  32.760687,
  35.0210254
);



// Madriga Floor 1 — Entrance 1
addCampusNode(
  'campus_madriga_floor1_entrance',
  32.76074663081821,
  35.0210782326758
);

// Madriga Floor 1 — Entrance 2
addCampusNode(
  'campus_madriga_floor1_entrance_2',
  32.76069263808956,
  35.021016374230385
);

addEdge(
  'campus_madriga_upper_path_2',
  'campus_madriga_floor1_entrance_2',
  'footway'
);

// --------------------------------------------------
// Terrace Building Floor 1 accessible approach
// Step-free alternative for Mobility profile
// --------------------------------------------------
addCampusNode(
  'campus_madriga_access_straight',
  32.75969059477067,
  35.02244800329209
);

addCampusNode(
  'campus_madriga_access_turn',
  32.7598484864191,
  35.02225488424302
);

addCampusNode(
  'campus_madriga_access_mid',
  32.760550,
  35.021330
);

addEdge(
  1446999286,
  'campus_madriga_access_straight',
  'footway'
);

addEdge(
  'campus_madriga_access_straight',
  'campus_madriga_access_turn',
  'footway'
);

addEdge(
  'campus_madriga_access_turn',
  'campus_madriga_access_mid',
  'footway'
);

// Accessible path → corrected Madriga Floor 1 Entrance 1
addEdge(
  'campus_madriga_access_mid',
  'campus_madriga_floor1_entrance',
  'footway'
);

// --------------------------------------------------
// Outdoor network connection correction
// --------------------------------------------------
addEdge(
  2102958523,
  1447013838,
  'footway'
);

// --------------------------------------------------
// Terrace Building Floor -1 / Gym downhill approach
// Custom path from the junction downhill to the
// Floor -1 entrance
// --------------------------------------------------


// Corrected Madriga lower path point
addCampusNode(
  'campus_madriga_downhill_1',
  32.760128179509074,
  35.02048278227449
);


// Madriga lower path → existing OSM street
addEdge(
  'campus_madriga_downhill_1',
  7676581029,
  'footway'
);

// New Madriga upper-path junction
addCampusNode(
  'campus_madriga_upper_path_junction',
  32.76068136023086,
  35.021034646779306
);


// New junction → upper bump
addEdge(
  'campus_madriga_upper_path_junction',
  'campus_madriga_upper_bump',
  'footway'
);

// New junction → existing upper-path node
addEdge(
  'campus_madriga_upper_path_junction',
  'campus_madriga_upper_path_2',
  'footway'
);

// Connect Multi-Purpose sidewalk directly to the Madriga lower path
addEdge(
  'campus_multi_sidewalk_top',
  'campus_madriga_downhill_1',
  'footway'
);

addCampusNode(
  'campus_madriga_floor_minus1_entrance',
  32.760864,
  35.021283
);

// Madriga Floor -1 entrance → existing OSM path
addEdge(
  'campus_madriga_floor_minus1_entrance',
  7676581031,
  'footway'
);



// --------------------------------------------------
// Multi-Purpose Building Floor 1 entrance (n2)
// Connects the Terrace-side pedestrian route to the
// Multi-Purpose Building entrance
// --------------------------------------------------
// ==================================================
// MADRIGA ↔ MULTI-PURPOSE CONNECTION
// ==================================================

// Existing approach points
addCampusNode(
  'campus_multi_entrance_approach_1',
  32.76036501571282,
  35.02147167921067
);

addCampusNode(
  'campus_multi_entrance_approach_2',
  32.76033794874998,
  35.02143412828446
);

addCampusNode(
  'campus_multi_entrance_approach_3',
  32.76023870314921,
  35.02127051353455
);


// Correct Multi-Purpose connection point.
// Replaces the old campus_multi_access_entrance position.
addCampusNode(
  'campus_multi_access_entrance',
  32.760402655694335,
  35.02152448520065
);


// Keep the existing lower approach connection.
addEdge(
  'campus_multi_entrance_approach_1',
  'campus_multi_entrance_approach_2',
  'footway'
);

addEdge(
  'campus_multi_entrance_approach_2',
  'campus_multi_entrance_approach_3',
  'footway'
);

// --------------------------------------------------
// Madriga / Gym path -> Student House Floor 1
// Continues along the pedestrian street instead of
// turning into the Madriga Floor -1 entrance
// --------------------------------------------------

addCampusNode(
  'campus_student_path_turn',
  32.7612645,
  35.0217117
);

// Existing OSM Student House path → remaining custom Student path
addEdge(
  7676581033,
  'campus_student_path_turn',
  'footway'
);

addCampusNode(
  'campus_student_path_6',
  32.761475,
  35.021520
);

addCampusNode(
  'campus_student_path_7',
  32.761548,
  35.021473
);

addCampusNode(
  'campus_student_path_8',
  32.761642,
  35.021372
);

addCampusNode(
  'campus_student_floor1_entrance',
  32.761715533931685,
  35.021285265684135
);

addEdge(
  'campus_student_path_turn',
  'campus_student_path_6',
  'footway'
);

addEdge(
  'campus_student_path_6',
  'campus_student_path_7',
  'footway'
);

addEdge(
  'campus_student_path_7',
  'campus_student_path_8',
  'footway'
);

addEdge(
  'campus_student_path_8',
  'campus_student_floor1_entrance',
  'footway'
);

// Approach 1 → corrected Multi-Purpose point.
addEdge(
  'campus_multi_entrance_approach_1',
  'campus_multi_access_entrance',
  'footway'
);

// Terrace-side walkway → Multi-Purpose entrance approach.
addEdge(
  'campus_madriga_access_mid',
  'campus_multi_access_entrance',
  'footway'
);

// --------------------------------------------------
// Floor 6 / Teacher Buffet → stairs
// --------------------------------------------------

addCampusNode(
  'campus_floor6_buffet_path_1',
  32.762246,
  35.019877
);

addCampusNode(
  'campus_floor6_buffet_path_2',
  32.762205,
  35.019925
);

addCampusNode(
  'campus_floor6_buffet_path_3',
  32.762169,
  35.019973
);

addCampusNode(
  'campus_floor6_buffet_path_4',
  32.762141,
  35.020010
);

addCampusNode(
  'campus_floor6_buffet_path_5',
  32.762049,
  35.020163
);

addCampusNode(
  'campus_floor6_buffet_stairs_1_bottom',
  32.762025,
  35.020222
);

addCampusNode(
  'campus_floor6_buffet_path_6',
  32.762030,
  35.020269
);

addCampusNode(
  'campus_floor6_buffet_path_7',
  32.762049,
  35.020305
);

addCampusNode(
  'campus_floor6_buffet_long_stairs_top',
  32.762059,
  35.020293
);

addCampusNode(
  'campus_floor6_buffet_long_stairs_bottom',
  32.762102,
  35.020233
);



// --------------------------------------------------
// Walking path from Floor 6
// --------------------------------------------------

addEdge(
  'campus_floor6_buffet_path_1',
  'campus_floor6_buffet_path_2',
  'footway'
);

addEdge(
  'campus_floor6_buffet_path_2',
  'campus_floor6_buffet_path_3',
  'footway'
);

addEdge(
  'campus_floor6_buffet_path_3',
  'campus_floor6_buffet_path_4',
  'footway'
);

addEdge(
  'campus_floor6_buffet_path_4',
  'campus_floor6_buffet_path_5',
  'footway'
);


// --------------------------------------------------
// First broad stairs
// --------------------------------------------------

addEdge(
  'campus_floor6_buffet_path_5',
  'campus_floor6_buffet_stairs_1_bottom',
  'steps'
);


// --------------------------------------------------
// Between the two stair sections
// --------------------------------------------------

addEdge(
  'campus_floor6_buffet_stairs_1_bottom',
  'campus_floor6_buffet_path_6',
  'footway'
);

addEdge(
  'campus_floor6_buffet_path_6',
  'campus_floor6_buffet_path_7',
  'footway'
);

addEdge(
  'campus_floor6_buffet_path_7',
  'campus_floor6_buffet_long_stairs_top',
  'footway'
);


// --------------------------------------------------
// Long stairs
// --------------------------------------------------

addEdge(
  'campus_floor6_buffet_long_stairs_top',
  'campus_floor6_buffet_long_stairs_bottom',
  'steps'
);

// ==================================================
// FLOOR 6 BUFFET STREET → OSM NETWORK
// ==================================================
// Connect the existing Floor 6 buffet street node
// directly to the existing OSM pedestrian node.

addEdge(
  'campus_floor6_buffet_street',
  1936600045,
  'footway'
);
// --------------------------------------------------
// Teacher Buffet entrance
// --------------------------------------------------

// Actual Teacher Buffet entrance
addCampusNode(
  'campus_floor6_buffet_entrance',
  32.76261380046798,
  35.01934535801411
);


addCampusNode(
  'campus_floor6_buffet_path_start',
  32.76264044382852,
  35.01938190311194
);

addEdge(
  'campus_floor6_buffet_path_start',
  'campus_floor6_buffet_path_1',
  'footway'
);

addEdge(
  'campus_floor6_buffet_path_start',
  'campus_floor6_buffet_entrance',
  'footway'
);

// ==================================================
// EDUCATION BUILDING — ENTRANCE PATH
// ==================================================

// Path point from the Education-side zebra approach
addCampusNode(
  'campus_education_entrance_path',
  32.761998181551235,
  35.01823073253036
);

// Zebra approach → Education entrance path
addEdge(
  'campus_main_education_crossing_approach',
  'campus_education_entrance_path',
  'footway'
);


// Education Building entrance
addCampusNode(
  'campus_education_entrance',
  32.76199099202191,
  35.01822151243687
);

// Entrance path → Education Building entrance
addEdge(
  'campus_education_entrance_path',
  'campus_education_entrance',
  'footway'
);

// --------------------------------------------------
// Education Building — upper path connection
// --------------------------------------------------

addCampusNode(
  'campus_education_upper_path',
  32.76225672227881,
  35.01790568232537
);

// Upper path → Education entrance path
addEdge(
  'campus_education_upper_path',
  'campus_education_entrance_path',
  'footway'
);

// Upper Education path → existing OSM node
addEdge(
  'campus_education_upper_path',
  1936600040,
  'footway'
);

// Upper Education path → existing OSM node
addEdge(
  'campus_education_upper_path',
  9255990879,
  'footway'
);

// ==================================================
// HEALTH BUILDING — ENTRANCE
// ==================================================

// Path point outside the Health Building
addCampusNode(
  'campus_health_entrance_path',
  32.76263635569437,
  35.01741886138917
);

// Health Building entrance
addCampusNode(
  'campus_health_entrance',
  32.76262733360449,
  35.01740377396346
);

// Path → Health Building entrance
addEdge(
  'campus_health_entrance_path',
  'campus_health_entrance',
  'footway'
);

// Health entrance path → existing OSM path
addEdge(
  'campus_health_entrance_path',
  7674525969,
  'footway'
);

addEdge(
  9255990877,
  'campus_main_education_crossing_approach',
  'footway'
);

// ==================================================
// SHOPS — WALKING PATH
// ==================================================

addCampusNode(
  'campus_shops_path_1',
  32.762087839162284,
  35.01831136643887
);

addCampusNode(
  'campus_shops_path_2',
  32.7622003688219,
  35.01817117956316
);

addCampusNode(
  'campus_shops_path_3',
  32.762261797225605,
  35.018097795546055
);

addCampusNode(
  'campus_shops_path_4',
  32.76231959521031,
  35.01802437007428
);

// --------------------------------------------------
// Connect the shops walking path
// --------------------------------------------------

addEdge(
  'campus_shops_path_1',
  'campus_shops_path_2',
  'footway'
);

addEdge(
  'campus_shops_path_2',
  'campus_shops_path_3',
  'footway'
);

addEdge(
  'campus_shops_path_3',
  'campus_shops_path_4',
  'footway'
);


// Main Building entrance → shops walking path
addEdge(
  'campus_main_entrance',
  'campus_shops_path_1',
  'footway'
);
// --------------------------------------------------
// Connect the shops walking path
// --------------------------------------------------

addEdge(
  'campus_shops_path_1',
  'campus_shops_path_2',
  'footway'
);

addEdge(
  'campus_shops_path_2',
  'campus_shops_path_3',
  'footway'
);

addEdge(
  'campus_shops_path_3',
  'campus_shops_path_4',
  'footway'
);

addEdge(
  'campus_shops_path_4',
  'campus_shops_path_5',
  'footway'
);

// Shops walking path → existing OSM path
addEdge(
  'campus_shops_path_4',
  1447013850,
  'footway'
);

// --------------------------------------------------
// Main entrance area — additional walking path
// --------------------------------------------------

addCampusNode(
  'campus_main_entrance_path_2',
  32.76200311554159,
  35.018428713083274
);

addCampusNode(
  'campus_main_entrance_path_3',
  32.76193826878911,
  35.01850917935372
);

// --------------------------------------------------
// Main entrance — lower path
// --------------------------------------------------

addCampusNode(
  'campus_main_entrance_path_4',
  32.761760644833885,
  35.018649995327
);

// Main entrance → path 2
addEdge(
  'campus_main_entrance',
  'campus_main_entrance_path_2',
  'footway'
);

// Path 2 → path 3
addEdge(
  'campus_main_entrance_path_2',
  'campus_main_entrance_path_3',
  'footway'
);

// Main entrance path → existing OSM node
addEdge(
  'campus_main_entrance_path_3',
  1447013848,
  'footway'
);

// Existing OSM node → final Main entrance path point
addEdge(
  1447013848,
  'campus_main_entrance_path_4',
  'footway'
);

// Remove the incorrect OSM connection
removeEdge(
  7674525968,
  7674525967
);

// Remove the incorrect OSM connection
removeEdge(
  1936599988,
  1447013839
);

// ==================================================
// SHOPS / SERVICES — ROUTING NODES
// ==================================================

// Pilates
addCampusNode(
  'campus_pilates',
  32.7619496126406,
  35.01851761915848
);

// Main entrance path → Pilates
addEdge(
  'campus_main_entrance_path_3',
  'campus_pilates',
  'footway'
);

// ==================================================
// SHOPS — ROUTING NODES AND PATH CONNECTIONS
// ==================================================

// --------------------------------------------------
// CopyMedia
// --------------------------------------------------

addCampusNode(
  'campus_copy_media',
  32.762012171708015,
  35.01843857639663
);

// Main entrance path 2 → CopyMedia
addEdge(
  'campus_main_entrance_path_2',
  'campus_copy_media',
  'footway'
);


// --------------------------------------------------
// Cafe Joe
// --------------------------------------------------

addCampusNode(
  'campus_cafe_joe',
  32.76209941318289,
  35.01832407982546
);

// Shops path 1 → Cafe Joe
addEdge(
  'campus_shops_path_1',
  'campus_cafe_joe',
  'footway'
);


// --------------------------------------------------
// Kravitz
// --------------------------------------------------

addCampusNode(
  'campus_kravitz',
  32.762213795867176,
  35.018188773780736
);

// Shops path 2 → Kravitz
addEdge(
  'campus_shops_path_2',
  'campus_kravitz',
  'footway'
);


// --------------------------------------------------
// Delta
// --------------------------------------------------

addCampusNode(
  'campus_delta',
  32.762326499120036,
  35.01803209861204
);

addEdge(
  'campus_shops_path_4',
  'campus_delta',
  'footway'
);

// --------------------------------------------------
// 700
// --------------------------------------------------

addCampusNode(
  'campus_700',
  32.76227022909617,
  35.01810845451287
);

// Shops path 3 → 700
addEdge(
  'campus_shops_path_3',
  'campus_700',
  'footway'
);

// ==================================================
// MAIN BUILDING FLOOR 600 → STUDENT HOUSE
// ==================================================


// --------------------------------------------------
// MAIN FLOOR 600 → ELEVATOR / STAIRS AREA
// --------------------------------------------------

addCampusNode(
  'campus_main_floor600_garden_junction',
  32.76193319382387,
  35.01979261636735
);

addCampusNode(
  'campus_main_floor600_stairs_approach',
  32.76212110831576,
  35.02004289999605
);

addEdge(
  'campus_main_floor600_path_4',
  'campus_main_floor600_junction',
  'footway'
);


// --------------------------------------------------
// 3. ACCESSIBLE ROAD TOWARD STUDENT HOUSE
//
// Remaining mapped portion of the step-free route.
// --------------------------------------------------

addCampusNode(
  'campus_floor6_access_road_3',
  32.761546931732376,
  35.02112567424775
);

// Corrected accessible road → existing OSM path
addEdge(
  'campus_floor6_access_road_3',
  1936600008,
  'footway'
);

// --------------------------------------------------
// Main Floor 600 — garden junction → stairs approach
// → outside elevator
// --------------------------------------------------

addEdge(
  'campus_main_floor600_garden_junction',
  'campus_main_floor600_stairs_approach',
  'footway'
);

addEdge(
  'campus_main_floor600_stairs_approach',
  'campus_main_floor600_elevator',
  'footway'
);

// --------------------------------------------------
// 4. PEDESTRIAN GAP AFTER THE ACCESSIBLE ROAD
//
// Leave the road through the pedestrian gap and
// continue toward Student House.
// --------------------------------------------------

addCampusNode(
  'campus_floor6_access_gap',
  32.7616302,
  35.0211684
);

addEdge(
  'campus_floor6_access_road_3',
  'campus_floor6_access_gap',
  'footway'
);


addCampusNode(
  'campus_floor6_access_path_1',
  32.7616689,
  35.0211633
);

addEdge(
  'campus_floor6_access_gap',
  'campus_floor6_access_path_1',
  'footway'
);


addCampusNode(
  'campus_floor6_access_path_2',
  32.7617006,
  35.0211358
);

addEdge(
  'campus_floor6_access_path_1',
  'campus_floor6_access_path_2',
  'footway'
);


// --------------------------------------------------
// 5. MAIN FLOOR 600 EXIT → OUTDOOR CORRIDOR
//
// Connect the Main Building Floor 600 exit to the
// first point of the walking path toward Student House.
// --------------------------------------------------

addCampusNode(
  'campus_main_floor600_exit',
  32.761944,
  35.019778
);


// --------------------------------------------------
// 6. ELEVATOR BRANCH
//
// From the Floor 600 corridor to the elevator door.
// --------------------------------------------------

addCampusNode(
  'campus_main_floor600_elevator',
  32.762211,
  35.020120
);

// The elevator comes out at the same point where
// the long stairs end, so reuse that existing node.
addEdge(
  'campus_main_floor600_elevator',
  'campus_floor6_buffet_long_stairs_bottom',
  'elevator'
);

// ==================================================
// MAIN FLOOR 600 — GARDEN CAFÉ ENTRANCE PATH
// ==================================================
//
// Garden Café entrance → new path point →
// existing small stairs.
// Reuses the existing stairs/elevator route.
// ==================================================

addCampusNode(
  'campus_main_garden_path',
  32.761839024972105,
  35.019914656877525
);

// New path point → top of the small stairs
addEdge(
  'campus_main_garden_path',
  'campus_floor6_buffet_path_5',
  'footway'
);


// --------------------------------------------------
// Street point after the long stairs
// --------------------------------------------------
addCampusNode(
  'campus_floor6_buffet_street',
  32.762157055904055,
  35.02030726522208
);

// Long stairs → new street point
addEdge(
  'campus_floor6_buffet_long_stairs_bottom',
  'campus_floor6_buffet_street',
  'footway'
);

// Floor 600 buffet street → existing OSM walking network
addEdge(
  'campus_floor6_buffet_street',
  7674525954,
  'footway'
);

// Health/Education-side OSM path connection
addEdge(
  1447013850,
  7674525968,
  'footway'
);

// --------------------------------------------------
// Floor 600 stairs approach → outside elevator
// --------------------------------------------------

addEdge(
  'campus_main_floor600_stairs_approach',
  'campus_main_floor600_elevator',
  'footway'
);


// ==================================================
// MAIN ↔ RABIN BRIDGE
// ==================================================
// Physical bridge path connecting the Main Building side
// to the Rabin Building side.


addCampusNode(
  'campus_main_rabin_bridge_1',
  32.76178009890341,
  35.01993980258704
);

addCampusNode(
  'campus_main_rabin_bridge_2',
  32.76164673976182,
  35.020172148942954
);

addCampusNode(
  'campus_main_rabin_bridge_3',
  32.761621364849695,
  35.02021841704846
);

addCampusNode(
  'campus_main_rabin_bridge_4',
  32.76160867739092,
  35.02024121582509
);

addCampusNode(
  'campus_main_rabin_bridge_5',
  32.761537909532095,
  35.02019159495831
);

addCampusNode(
  'campus_main_rabin_bridge_6',
  32.7614978735074,
  35.020229816436775
);

// ==================================================
// MAIN ↔ RABIN BRIDGE CONNECTIONS
// ==================================================


addEdge(
  'campus_main_rabin_bridge_1',
  'campus_main_rabin_bridge_2',
  'footway'
);

addEdge(
  'campus_main_rabin_bridge_2',
  'campus_main_rabin_bridge_3',
  'footway'
);

addEdge(
  'campus_main_rabin_bridge_3',
  'campus_main_rabin_bridge_4',
  'footway'
);

addEdge(
  'campus_main_rabin_bridge_4',
  'campus_main_rabin_bridge_5',
  'footway'
);

addEdge(
  'campus_main_rabin_bridge_5',
  'campus_main_rabin_bridge_6',
  'footway'
);

// ==================================================
// MAIN GARDEN → RABIN BRIDGE
// ==================================================
// Connect the existing Main garden path directly to
// the existing first node of the Rabin bridge.

addEdge(
  'campus_main_garden_path',
  'campus_main_rabin_bridge_1',
  'footway'
);
// ==================================================
// RABIN-SIDE BRIDGE WALKWAY
// ==================================================

addCampusNode(
  'campus_rabin_walkway_1',
  32.761607267673156,
  35.02024121582509
);

addCampusNode(
  'campus_rabin_walkway_2',
  32.761546931732376,
  35.02035655081273
);

addCampusNode(
  'campus_rabin_walkway_3',
  32.76148941519,
  35.02042159438134
);

addCampusNode(
  'campus_rabin_walkway_4',
  32.761384531987694,
  35.0205684453249
);

addCampusNode(
  'campus_rabin_walkway_5',
  32.761346187560314,
  35.020649582147605
);

addCampusNode(
  'campus_rabin_walkway_6',
  32.761314045895226,
  35.020687133073814
);

addCampusNode(
  'campus_rabin_walkway_7',
  32.76127908477267,
  35.02071931958199
);

addCampusNode(
  'campus_rabin_walkway_9',
  32.76115333739573,
  35.020874887704856
);

// ==================================================
// RABIN-SIDE WALKWAY CONNECTIONS
// ==================================================S

addEdge(
  'campus_rabin_walkway_1',
  'campus_rabin_walkway_2',
  'footway'
);

addEdge(
  'campus_rabin_walkway_2',
  'campus_rabin_walkway_3',
  'footway'
);

addEdge(
  'campus_rabin_walkway_3',
  'campus_rabin_walkway_4',
  'footway'
);

addEdge(
  'campus_rabin_walkway_4',
  'campus_rabin_walkway_5',
  'footway'
);

addEdge(
  'campus_rabin_walkway_5',
  'campus_rabin_walkway_6',
  'footway'
);

addEdge(
  'campus_rabin_walkway_6',
  'campus_rabin_walkway_7',
  'footway'
);

addEdge(
  'campus_rabin_walkway_7',
  'campus_rabin_bridge_path_6',
  'footway'
);

addEdge(
  'campus_rabin_bridge_path_6',
  'campus_rabin_walkway_9',
  'footway'
);

// ==================================================
// RABIN BRIDGE PATH → EXISTING OSM NETWORK
// ==================================================
addEdge(
  'campus_rabin_bridge_path_11',
  7674525954,
  'footway'
);

// ==================================================
// RABIN STAIRS 1 CONNECTIONS
// ==================================================
// Stairs connect the two walkway points on either side.

addEdge(
  'campus_rabin_walkway_2',
  'campus_rabin_stairs_1',
  'steps'
);

addEdge(
  'campus_rabin_stairs_1',
  'campus_rabin_walkway_3',
  'steps'
);

 // --------------------------------------------------
 // Accessible ramp: street <-> Rabin Floor 6 plaza
 // Provides step-free access toward Student House Floor 4
 // --------------------------------------------------

// ==================================================
// RABIN BRIDGE → RABIN PATH
// ==================================================
// Continuation from the Main ↔ Rabin bridge toward
// the Rabin Building side.


addCampusNode(
  'campus_rabin_bridge_path_6',
  32.76120521525885,
  35.02080716192722
);

addCampusNode(
  'campus_rabin_bridge_path_8',
  32.76148377631132,
  35.02098888158799
);

addCampusNode(
  'campus_rabin_bridge_path_9',
  32.76164335644062,
  35.02087689936162
);

addCampusNode(
  'campus_rabin_bridge_path_10',
  32.761839024972105,
  35.02065025269986
);

addCampusNode(
  'campus_rabin_bridge_path_11',
  32.76186158039477,
  35.02068310976029
);

// Additional Rabin-side path point
addCampusNode(
  'campus_rabin_bridge_path_12',
  32.761347,
  35.020649
);

// ==================================================
// RABIN PLAZA / MADRIGA STAIR NODES
// ==================================================
// Routing nodes placed exactly at the existing
// stair icons shown on the campus map.

addCampusNode(
  'campus_rabin_stairs_1',
  32.76151986512884,
  35.020382702350624
);

addCampusNode(
  'campus_rabin_stairs_2',
  32.76145445413631,
  35.020460486412055
);

addCampusNode(
  'campus_rabin_stairs_3',
  32.761255965313104,
  35.020739436149604
);

addCampusNode(
  'campus_rabin_stairs_4',
  32.76116799853403,
  35.020854771137245
);

// ==================================================
// RABIN PLAZA → MADRIGA STAIR CONNECTIONS
// ==================================================

// Upper walkway → first stairs
addEdge(
  'campus_rabin_walkway_7',
  'campus_rabin_stairs_3',
  'steps'
);

// First stairs → middle walkway point
addEdge(
  'campus_rabin_stairs_3',
  'campus_rabin_bridge_path_6',
  'steps'
);


// Second stairs → lower walkway
addEdge(
  'campus_rabin_stairs_4',
  'campus_rabin_walkway_9',
  'steps'
);

// ==================================================
// RABIN WALKWAY → FLOOR 6 PLAZA ENTRANCE
// ==================================================

addEdge(
  'campus_rabin_walkway_7',
  'campus_rabin_floor6_plaza',
  'footway'
);

// ==================================================
// AROMA OUTSIDE APPROACH
// ==================================================

addCampusNode(
  'campus_aroma_outside_approach',
32.761313482006265, 35.020813196897514
);

// Aroma approach → Rabin/plaza walkway
addEdge(
  'campus_aroma_outside_approach',
  'campus_rabin_walkway_7',
  'footway'
);

// ==================================================
// AROMA OUTSIDE ENTRANCE
// ==================================================
// Outdoor counterpart of the Aroma entrance shown
// in the Rabin indoor graph.

addCampusNode(
  'campus_aroma_outside_entrance',
  32.76129374589024,
  35.0208292901516
);
// Aroma outside entrance → plaza approach
addEdge(
  'campus_aroma_outside_entrance',
  'campus_aroma_outside_approach',
  'footway'
);

// ==================================================
// AROMA → UPPER RABIN PATH
// ==================================================
// Uses existing nodes only. No new nodes are created.

addEdge(
  'campus_aroma_outside_approach',
  'campus_rabin_bridge_path_8',
  'footway'
);

addEdge(
  'campus_rabin_bridge_path_8',
  'campus_rabin_bridge_path_9',
  'footway'
);

addEdge(
  'campus_rabin_bridge_path_9',
  'campus_rabin_bridge_path_10',
  'footway'
);

addEdge(
  'campus_rabin_bridge_path_10',
  'campus_rabin_bridge_path_11',
  'footway'
);

// ==================================================
// UPPER RABIN PATH → EXISTING OSM NETWORK
// ==================================================
// Connect the mapped Rabin walkway back into the
// existing OSM pedestrian network.

addEdge(
  'campus_rabin_bridge_path_11',
  1936600008,
  'footway'
);
// --------------------------------------------------
// Student House <-> Main upper connector
// This OSM edge is mapped as service, but the physical
// level change is stairs + nearby elevator.
// Keep it usable for mobility through the elevator.
// --------------------------------------------------

removeEdge(
  7674525954,
  1936600008
);

addEdge(
  7674525954,
  1936600008,
  'elevator'
);

// --------------------------------------------------
// DORM - MiniMarket
// --------------------------------------------------

// Carmel Gate / Multi-Purpose approach path
addCampusNode(
  'campus_carmel_multipurpose_path_1',
  32.758962033966434,
  35.021737217903144
);

addCampusNode(
  'campus_carmel_multipurpose_path_2',
  32.75849173690675,
  35.02242118120194
);

addCampusNode(
  'campus_carmel_multipurpose_path_3',
  32.75837669983782,
  35.022342056036
);

addCampusNode(
  'campus_carmel_multipurpose_path_4',
  32.75852782693699,
  35.02213418483735
);

addCampusNode(
  'campus_carmel_multipurpose_path_5',
  32.75872632184173,
  35.02186194062234
);

// connections
addEdge(
  'campus_carmel_multipurpose_path_5',
  2065458971,
  'footway'
);

addEdge(
  'campus_carmel_multipurpose_path_5',
  'campus_carmel_multipurpose_path_4',
  'footway'
);

addEdge(
  'campus_carmel_multipurpose_path_4',
  'campus_carmel_multipurpose_path_3',
  'footway'
);

addEdge(
  'campus_carmel_multipurpose_path_3',
  'campus_carmel_multipurpose_path_2',
  'footway'
);

addEdge(
  'campus_carmel_multipurpose_path_2',
  'campus_carmel_multipurpose_path_1',
  'footway'
);

addEdge(
  'campus_carmel_multipurpose_path_2',
  2102963357,
  'footway'
);

addEdge(
  2102963357,
  1387533537,
  'footway'
);

addCampusNode(
  'campus_minimarket_path',
  32.7592422937429,
  35.02321444451809
);

addCampusNode(
  'campus_minimarket_entrance',
  32.75915841326848,
  35.0230796635151
);

addEdge(
  'campus_minimarket_path',
  'campus_minimarket_entrance',
  'footway'
);

addEdge(
  'campus_minimarket_path',
  1387533546,
  'footway'
);

// Additional walking path - main building
addCampusNode(
  'campus_extra_walk_1',
  32.76140483197199,
  35.01996997743846
);

addCampusNode(
  'campus_extra_walk_2',
  32.761661964705645,
  35.01960217952729
);

addCampusNode(
  'campus_extra_walk_3',
  32.76177699753029,
  35.01972422003747
);

addCampusNode(
  'campus_extra_walk_4',
  32.76182380005856,
  35.01965515315533
);

addEdge(
  'campus_extra_walk_3',
  'campus_main_rabin_bridge_1',
  'footway'
);

addCampusNode(
  'campus_smoking_spot_1',
  32.761700872883566,
  35.01953255099758
);

addEdge(
  'campus_smoking_spot_1',
  'campus_extra_walk_2',
  'footway'
);

addEdge('campus_extra_walk_1', 'campus_extra_walk_2', 'footway');
addEdge('campus_extra_walk_2', 'campus_extra_walk_3', 'footway');
addEdge('campus_extra_walk_3', 'campus_extra_walk_4', 'footway');

addCampusNode(
  'campus_rabin_floor5_entrance',
  32.76116743464413,
  35.02082761377097
);

addCampusNode(
  'campus_rabin_floor5_junction',
  32.76117702077177,
  35.02084186300636
);

addEdge(
  'campus_rabin_floor5_junction',
  'campus_rabin_stairs_4',
  'steps'
);

addEdge(
  'campus_rabin_floor5_junction',
  'campus_rabin_bridge_path_6',
  'footway'
);

addEdge(
  'campus_rabin_floor5_junction',
  'campus_rabin_floor5_entrance',
  'footway'
);

addEdge(
  'campus_extra_walk_1',
  1447013842,
  'footway'
);

addCampusNode(
  'campus_main_floor600_garden_link',
32.76187454976023, 35.019863724344056
);

addEdge(
  'campus_main_floor600_garden_link',
  'campus_main_floor600_garden_junction',
  'footway'
);

addEdge(
  'campus_main_floor600_garden_link',
  'campus_main_floor600_exit',
  'footway'
);

addCampusNode(
  'campus_main_garden_walk_1',
  32.761776151701234,
  35.019724576209875
);

addEdge(
  'campus_main_garden_walk_1',
  'campus_main_floor600_garden_link',
  'footway'
);

addEdge(
  'campus_main_garden_path',
  'campus_main_floor600_garden_link',
  'footway'
);

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  for(const correction of CAMPUS_CORRECTIONS){

    const {
      fromNode,
      toNode,
      type = 'footway'
    } = correction;

    if(
      !coordinates.has(fromNode) ||
      !coordinates.has(toNode)
    ){
      console.warn(
        'CampusWay correction references missing OSM node:',
        correction
      );

      continue;
    }

    addEdge(
      fromNode,
      toNode,
      type
    );
  }
}

  // --------------------------------------------------
  // Find closest OSM routing node
  // --------------------------------------------------

  function nearestNode(lat, lon, options = {}) {

    let best = null;
    let bestDistance = Infinity;

    const point = [lat, lon];
    const avoidSteps = options.avoidSteps === true;

    for(const [id, coord] of coordinates.entries()){

      if(!graph.has(id)){
        continue;
      }

      if(
        avoidSteps &&
        !(graph.get(id) || []).some(edge => edge.type !== 'steps')
      ){
        continue;
      }

      const d = distance(point, coord);

      if(d < bestDistance){
        bestDistance = d;
        best = id;
      }
    }

    return best;
  }

  function inspectNearestNode(lat, lon){

  const node = nearestNode(lat, lon);

  if(node === null){
    return null;
  }

  const result = {
    node,
    coordinate: coordinates.get(node),
    distanceMeters: distance(
      [lat, lon],
      coordinates.get(node)
    ),
    connections: graph.get(node) || []
  };

  console.log('Nearest outdoor routing node:', result);

  return result;
}

  function connectedComponent(startNode){

  const visited = new Set();
  const queue = [startNode];

  while(queue.length){

    const current = queue.shift();

    if(visited.has(current)){
      continue;
    }

    visited.add(current);

    for(const edge of graph.get(current) || []){

      if(!visited.has(edge.node)){
        queue.push(edge.node);
      }
    }
  }

  return visited;
}
function getDebugGraph(){

  const nodes = [];

  for(const [id, coord] of coordinates.entries()){

    if(!graph.has(id)){
      continue;
    }

    nodes.push({
      id,
      coordinate: coord,
      connections: graph.get(id).map(edge => ({
        node: edge.node,
        type: edge.type
      }))
    });
  }

  return nodes;
}

function closestNodesBetweenComponents(componentA, componentB){

  let best = null;
  let bestDistance = Infinity;

  for(const nodeA of componentA){

    const coordA = coordinates.get(nodeA);

    if(!coordA) continue;

    for(const nodeB of componentB){

      const coordB = coordinates.get(nodeB);

      if(!coordB) continue;

      const d = distance(coordA, coordB);

      if(d < bestDistance){

        bestDistance = d;

        best = {
          nodeA,
          coordinateA: coordA,
          nodeB,
          coordinateB: coordB,
          distanceMeters: d
        };
      }
    }
  }

  return best;
}

  // --------------------------------------------------
  // Dijkstra
  // --------------------------------------------------

  // --------------------------------------------------
  // Live restrictions (campus status file)
  // --------------------------------------------------
  // blockedAreas: polygons of [lat, lng] to walk around ("no-go zones").
  // avoidElevator: the outdoor elevator is out of service.
  let restrictions = {blockedAreas: [], avoidElevator: false};

  function setRestrictions(next = {}){
    restrictions = {
      blockedAreas: Array.isArray(next.blockedAreas)
        ? next.blockedAreas.filter(area => Array.isArray(area) && area.length > 2)
        : [],
      avoidElevator: next.avoidElevator === true
    };
  }

  function pointInArea(lat, lon, area){
    let inside = false;
    for(let i = 0, j = area.length - 1; i < area.length; j = i++){
      const [latA, lonA] = area[i];
      const [latB, lonB] = area[j];
      if(((latA > lat) !== (latB > lat)) &&
        lon < (lonB - lonA) * (lat - latA) / (latB - latA) + lonA){
        inside = !inside;
      }
    }
    return inside;
  }

  function edgeIsBlocked(fromId, edge){
    if(restrictions.avoidElevator && edge.type === 'elevator') return true;
    if(!restrictions.blockedAreas.length) return false;
    const a = coordinates.get(fromId);
    const b = coordinates.get(edge.node);
    if(!a || !b) return false;
    const midLat = (a[0] + b[0]) / 2;
    const midLon = (a[1] + b[1]) / 2;
    return restrictions.blockedAreas.some(area =>
      pointInArea(midLat, midLon, area) ||
      pointInArea(b[0], b[1], area)
    );
  }

function shortestPath(start, end, options = {}) {
  const noisyNodeIds = new Set();

if(
  options.avoidNoise === true &&
  typeof CampusStatus !== 'undefined'
){
  for(const area of CampusStatus.noiseAreas){
    if(!area.noisy && !area.crowded) continue;

    if(area.until){
      const expires = Date.parse(area.until);
      if(!Number.isFinite(expires) || expires <= Date.now()) continue;
    }

    for(const id of (area.outdoorNodeIds || [])){
      noisyNodeIds.add(String(id));
    }
  }
}
    const result = CampusRoutePlanner.findPath({
      nodeIds: () => graph.keys(),
      neighbors: nodeId => {
  const edges = graph.get(nodeId) || [];

  if(!noisyNodeIds.size) return edges;

  return edges.map(edge => {
    const passesNoisyArea =
      noisyNodeIds.has(String(nodeId)) ||
      noisyNodeIds.has(String(edge.node));

    return passesNoisyArea
      ? {...edge, weight: edge.weight * 5}
      : edge;
  });
},
      edgeTarget: edge => edge.node,
      edgeWeight: edge => edge.weight,
      edgeAllowed: (edge, fromId) => !(
        options.avoidSteps &&
        edge.type === 'steps'
      ) && !edgeIsBlocked(fromId, edge),
      point: nodeId => {
        const coordinate = coordinates.get(nodeId);
        if(!coordinate) return null;
        const [lat, lon] = coordinate;
        const referenceLatitude =
          (BOUNDS.south + BOUNDS.north) / 2;
        return {
          x: lon * 111320 * Math.cos(referenceLatitude * Math.PI / 180),
          y: lat * 110540,
          floor: 'outdoor'
        };
      }
    }, start, end, {
      preferFewerTurns: options.preferFewerTurns === true
    });

    if(!result) return null;

    const nodes = result.nodes;
    const edges = result.edges;

    const realDistance =
      edges.reduce(
        (sum, edge) =>
          sum + edge.meters,
        0
      );

    return {
      nodes,
      edges,
      distance: realDistance
    };
  }


  // --------------------------------------------------
  // Load pedestrian network from OpenStreetMap
  // --------------------------------------------------

  function load(){

    if(loaded){
      return Promise.resolve();
    }

    if(loadingPromise){
      return loadingPromise;
    }

loadingPromise =
  fetch('app/prototype/campus-osm.json')

        .then(response => {

      if(!response.ok){
        throw new Error(
          'Local campus OSM data returned HTTP ' +
          response.status
        );
      }

          return response.json();
        })

        .then(data => {

          rawOsmData = data;

          graph.clear();
          coordinates.clear();

          const ways =
            data.elements.filter(
              element =>
                element.type === 'way'
            );

          const nodes =
            data.elements.filter(
              element =>
                element.type === 'node'
            );

          nodes.forEach(node => {

            coordinates.set(
              node.id,
              [node.lat, node.lon]
            );

          });

          ways.forEach(way => {

            if(
              !Array.isArray(way.nodes) ||
              way.nodes.length < 2
            ){
              return;
            }

            const type =
              way.tags?.highway ||
              'unknown';

            for(
              let i = 0;
              i < way.nodes.length - 1;
              i++
            ){

              addEdge(
                way.nodes[i],
                way.nodes[i + 1],
                type
              );
            }
          });

          applyCampusCorrections();

          loaded = true;

          console.log(
            `Campus outdoor routing loaded: ${ways.length} walkways / ${graph.size} routing nodes`
          );
        })

        .catch(error => {

          loadingPromise = null;

          console.error(
            'Campus outdoor routing failed:',
            error
          );

          throw error;
        });

    return loadingPromise;
  }


  // --------------------------------------------------
  // Public route function
  // --------------------------------------------------

async function route(
  startLat,
  startLng,
  endLat,
  endLng,
  options = {}
){
  await load();

const routeOptions = {
  avoidSteps: options.avoidSteps === true,
  preferFewerTurns: options.preferFewerTurns === true,
  avoidNoise: options.avoidNoise === true
};

  const startNode =
    nearestNode(
      startLat,
      startLng,
      routeOptions
    );

  const endNode =
    nearestNode(
      endLat,
      endLng,
      routeOptions
    );

  if(
    startNode === null ||
    endNode === null
  ){
    return null;
  }

  const result =
    shortestPath(
      startNode,
      endNode,
      routeOptions
    );

  if(!result){
    const startComponent =
      connectedComponent(startNode);

    // Both ends are connected: only the restrictions (no steps, closed
    // areas) block the way, so there is no gap to report.
    if(startComponent.has(endNode)){
      console.warn('No route with the current restrictions', {
        startNode, endNode,
        avoidSteps: routeOptions.avoidSteps,
        blockedAreas: restrictions.blockedAreas.length
      });
      return null;
    }

    const endComponent =
      connectedComponent(endNode);

    // The closest gap compares every pair of nodes, so it is only worked out
    // for a small island (it is a hint for mapping, not for users).
    const closestGap =
      Math.min(startComponent.size, endComponent.size) <= 200
        ? closestNodesBetweenComponents(
          startComponent,
          endComponent
        )
        : null;

    console.warn(
      'No connected OSM route found',
      {
        startNode,
        startCoordinate:
          coordinates.get(startNode),
        startComponentSize:
          startComponent.size,

        endNode,
        endCoordinate:
          coordinates.get(endNode),
        endComponentSize:
          endComponent.size,

        closestGap
      }
    );

    return null;
  }

  return {
    coordinates: [
      [startLat, startLng],

      ...result.nodes.map(
        node => coordinates.get(node)
      ),

      [endLat, endLng]
    ],

    distance: result.distance,
    edges: result.edges,
    startNode,
    endNode
  };
}


  // --------------------------------------------------
  // Public API
  // --------------------------------------------------

return {
  load,
  route,
  distance,
  setRestrictions,
  inspectNearestNode,
  getDebugGraph,
  findClosestEdge,
  getRawOsmData: () => rawOsmData,

  inspectNode: function(nodeId){
    return {
      node: nodeId,
      coordinate: coordinates.get(nodeId),
      connections: graph.get(nodeId) || []
    };
  },

  isLoaded: () => loaded
};

})();
