// Turn-by-turn directions for outdoor campus routes.
//
// Takes the route from CampusOutdoorRouting.route() ({coordinates, edges})
// and returns short steps such as "Walk 40 m, then turn left near Rabin
// Building". The same text is shown in the route card and read aloud.
// Works in the browser (CampusRouteInstructions) and in Node tests.
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.CampusRouteInstructions = api;
})(typeof self !== 'undefined' ? self : this, function(){

  const LOOK_METERS = 12;     // how far back/ahead to measure a heading
  const MERGE_METERS = 15;    // bends closer than this count as one turn
  const MIN_STEP_METERS = 8;  // ignore wiggles right after the last step
  const LANDMARK_METERS = 30; // a building this close names the turn
  const PASS_GAP_METERS = 120; // walks longer than this get a "passing" step
  const PASS_METERS = 25;      // how close a building must be to be "passed"

  function toXY(point, refLat){
    const [lat, lng] = point;
    return {
      x: lng * 111320 * Math.cos(refLat * Math.PI / 180),
      y: lat * 110540
    };
  }

  function metersBetween(a, b, refLat){
    const p = toXY(a, refLat), q = toXY(b, refLat);
    return Math.hypot(q.x - p.x, q.y - p.y);
  }

  // Compass bearing in degrees: 0 = north, 90 = east.
  function bearing(a, b, refLat){
    const p = toXY(a, refLat), q = toXY(b, refLat);
    return (Math.atan2(q.x - p.x, q.y - p.y) * 180 / Math.PI + 360) % 360;
  }

  // Signed change of heading in (-180, 180]; positive = right turn.
  function headingChange(from, to){
    let delta = (to - from) % 360;
    if(delta > 180) delta -= 360;
    if(delta <= -180) delta += 360;
    return delta;
  }

  function cleanPoints(coordinates){
    const points = [];
    for(const point of coordinates || []){
      if(!Array.isArray(point) || point.length < 2) continue;
      const lat = Number(point[0]), lng = Number(point[1]);
      if(!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // Duplicates are kept so that segment numbers still match route edges.
      points.push([lat, lng]);
    }
    return points;
  }

  function pointAtDistance(points, cumulative, distance){
    if(distance <= 0) return points[0];
    const total = cumulative[cumulative.length - 1];
    if(distance >= total) return points[points.length - 1];
    let index = 1;
    while(index < cumulative.length && cumulative[index] < distance) index += 1;
    const start = cumulative[index - 1], end = cumulative[index];
    const t = end > start ? (distance - start) / (end - start) : 0;
    const a = points[index - 1], b = points[index];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function distanceToSegment(p, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
      : 0;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  function distanceToPlace(point, place, refLat){
    const p = toXY(point, refLat);
    const polygon = Array.isArray(place.polygon) ? place.polygon : null;
    if(polygon && polygon.length > 2){
      const ring = polygon.map(vertex => toXY(vertex, refLat));
      let inside = false;
      for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
        const a = ring[i], b = ring[j];
        if(((a.y > p.y) !== (b.y > p.y)) &&
          p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if(inside) return 0;
      let best = Infinity;
      for(let i = 1; i < ring.length; i += 1){
        best = Math.min(best, distanceToSegment(p, ring[i - 1], ring[i]));
      }
      return best;
    }
    if(Number.isFinite(place.lat) && Number.isFinite(place.lng)){
      return metersBetween(point, [place.lat, place.lng], refLat);
    }
    return Infinity;
  }

  function placeCenter(place){
    if(Number.isFinite(place.lat) && Number.isFinite(place.lng)) return [place.lat, place.lng];
    if(Array.isArray(place.polygon) && place.polygon.length){
      const sum = place.polygon.reduce((total, vertex) => [total[0] + vertex[0], total[1] + vertex[1]], [0, 0]);
      return [sum[0] / place.polygon.length, sum[1] / place.polygon.length];
    }
    return null;
  }

  function nearestLandmark(point, landmarks, refLat, exclude){
    let best = null, bestDistance = LANDMARK_METERS;
    for(const place of landmarks || []){
      if(!place || !place.name || exclude.has(place.name)) continue;
      const distance = distanceToPlace(point, place, refLat);
      if(distance < bestDistance){
        best = place;
        bestDistance = distance;
      }
    }
    return best ? best.name : null;
  }

  function turnKind(angle){
    const size = Math.abs(angle);
    const side = angle > 0 ? 'right' : 'left';
    if(size >= 140) return `sharp-${side}`;
    if(size >= 55) return side;
    return `slight-${side}`;
  }

  function compassName(degrees){
    const names = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    return names[Math.round(degrees / 45) % 8];
  }

  // Steps for one outdoor route.
  // options: {landmarks:[{name, lat, lng, polygon}], startName, endName}
  function buildOutdoorSteps(route, options = {}){
    const points = cleanPoints(route && route.coordinates);
    if(points.length < 2) return {steps: [], totalMeters: 0};

    const refLat = points[0][0];
    const cumulative = [0];
    for(let i = 1; i < points.length; i += 1){
      cumulative.push(cumulative[i - 1] + metersBetween(points[i - 1], points[i], refLat));
    }
    const total = cumulative[cumulative.length - 1];

    // Segment i joins points[i] and points[i + 1]. Route coordinates are
    // [start, ...graph nodes, end], so graph edge k is segment k + 1.
    const edges = Array.isArray(route.edges) ? route.edges : [];
    const segmentType = index => {
      const edge = edges[index - 1];
      return edge && edge.type ? String(edge.type) : 'path';
    };

    const exclude = new Set([options.startName, options.endName].filter(Boolean));
    const candidates = [];
    for(let i = 1; i < points.length - 1; i += 1){
      const at = cumulative[i];
      if(at < MIN_STEP_METERS || total - at < MIN_STEP_METERS) continue;
      const before = pointAtDistance(points, cumulative, Math.max(0, at - LOOK_METERS));
      const after = pointAtDistance(points, cumulative, Math.min(total, at + LOOK_METERS));
      if(metersBetween(before, points[i], refLat) < 1 || metersBetween(points[i], after, refLat) < 1) continue;
      const angle = headingChange(
        bearing(before, points[i], refLat),
        bearing(points[i], after, refLat)
      );
      candidates.push({index: i, at, angle});
    }

    // One instruction per bend: keep the sharpest point of each cluster.
    const turns = [];
    for(const candidate of candidates){
      if(Math.abs(candidate.angle) < 30) continue;
      const last = turns[turns.length - 1];
      if(last && candidate.at - last.at < MERGE_METERS &&
        Math.sign(last.angle) === Math.sign(candidate.angle)){
        if(Math.abs(candidate.angle) > Math.abs(last.angle)) turns[turns.length - 1] = candidate;
        continue;
      }
      turns.push(candidate);
    }

    // Stairs: where the route enters a flight of steps.
    // A slight bend one way and straight back the other way within a few
    // metres is the path shifting sideways, not a turn worth announcing.
    for(let i = 0; i < turns.length - 1; i += 1){
      const a = turns[i], b = turns[i + 1];
      if(b.at - a.at < 20 && Math.sign(a.angle) !== Math.sign(b.angle) &&
        Math.abs(a.angle) < 55 && Math.abs(b.angle) < 55 &&
        Math.abs(a.angle + b.angle) < 25){
        turns.splice(i, 2);
        i -= 1;
      }
    }

    const events = turns.map(turn => ({
      kind: 'turn',
      turn: turnKind(turn.angle),
      angle: Math.round(turn.angle),
      at: turn.at,
      point: points[turn.index],
      landmark: nearestLandmark(points[turn.index], options.landmarks, refLat, exclude)
    }));
    for(let i = 1; i < points.length - 1; i += 1){
      if(segmentType(i) === 'steps' && segmentType(i - 1) !== 'steps'){
        events.push({kind: 'stairs', at: cumulative[i], point: points[i], landmark: null});
      }
    }
    events.sort((a, b) => a.at - b.at);

    // Long walks get a reassurance step at a building you pass
    // ("Walk 150 m, passing Rabin Building on your left").
    const named = new Set(events.map(event => event.landmark).filter(Boolean));
    for(let round = 0; round < 4; round += 1){
      const marks = [0, ...events.map(event => event.at), total];
      let added = false;
      for(let i = 0; i < marks.length - 1; i += 1){
        const from = marks[i], to = marks[i + 1];
        if(to - from < PASS_GAP_METERS) continue;
        let best = null;
        for(let at = from + 30; at <= to - 30; at += 10){
          const point = pointAtDistance(points, cumulative, at);
          for(const place of options.landmarks || []){
            if(!place || !place.name || exclude.has(place.name) || named.has(place.name)) continue;
            const distance = distanceToPlace(point, place, refLat);
            if(distance <= PASS_METERS && (!best || distance < best.distance)){
              best = {place, distance, at, point};
            }
          }
        }
        if(!best) continue;
        const heading = bearing(
          pointAtDistance(points, cumulative, Math.max(0, best.at - 5)),
          pointAtDistance(points, cumulative, Math.min(total, best.at + 5)),
          refLat
        );
        const center = placeCenter(best.place);
        const side = center && headingChange(heading, bearing(best.point, center, refLat)) < 0 ? 'left' : 'right';
        events.push({kind:'pass', at:best.at, point:best.point, landmark:best.place.name, side});
        named.add(best.place.name);
        added = true;
      }
      events.sort((a, b) => a.at - b.at);
      if(!added) break;
    }

    const steps = [{
      kind: 'start',
      heading: compassName(bearing(points[0], pointAtDistance(points, cumulative, Math.min(total, 20)), refLat)),
      name: options.startName || '',
      at: 0,
      point: points[0],
      meters: 0
    }];
    let lastAt = 0, lastLandmark = null;
    for(const event of events){
      if(event.kind === 'turn' && event.at - lastAt < MIN_STEP_METERS && steps.length > 1) continue;
      if(event.kind === 'pass'){
        steps.push({...event, meters: event.at - lastAt});
        lastAt = event.at;
        lastLandmark = event.landmark;
        continue;
      }
      // Name a building once, not at every bend beside it.
      const landmark = event.landmark && event.landmark !== lastLandmark ? event.landmark : null;
      if(event.landmark) lastLandmark = event.landmark;
      steps.push({...event, landmark, meters: event.at - lastAt});
      lastAt = event.at;
    }
    steps.push({
      kind: 'arrive',
      name: options.endName || '',
      at: total,
      point: points[points.length - 1],
      meters: total - lastAt
    });

    return {steps, totalMeters: total};
  }

  function roundMeters(meters){
    if(meters < 10) return Math.max(5, Math.round(meters / 5) * 5);
    if(meters < 100) return Math.round(meters / 5) * 5;
    return Math.round(meters / 10) * 10;
  }

  const TEXT = {
    en: {
      meters: n => `${n} m`,
      compass: {north:'north', northeast:'northeast', east:'east', southeast:'southeast', south:'south', southwest:'southwest', west:'west', northwest:'northwest'},
      start: (name, dir) => name ? `Start at ${name} and head ${dir}` : `Head ${dir}`,
      turns: {
        left:'turn left', right:'turn right',
        'slight-left':'bear left', 'slight-right':'bear right',
        'sharp-left':'make a sharp left', 'sharp-right':'make a sharp right'
      },
      turn: (d, turn, landmark) => `Walk ${d}, then ${turn}${landmark ? ` near ${landmark}` : ''}`,
      stairs: d => `Walk ${d}, then take the stairs`,
      pass: (d, landmark, side) => `Walk ${d}, passing ${landmark} on your ${side}`,
      arrive: (d, name) => name ? `Walk ${d} to arrive at ${name}` : `Walk ${d} to arrive`,
      compact: {continue:'Continue straight', stairs:'Take the stairs', arrive:name => name ? `Arrive at ${name}` : 'You have arrived'}
    },
    he: {
      meters: n => `${n} מטר`,
      compass: {north:'צפונה', northeast:'לצפון-מזרח', east:'מזרחה', southeast:'לדרום-מזרח', south:'דרומה', southwest:'לדרום-מערב', west:'מערבה', northwest:'לצפון-מערב'},
      start: (name, dir) => name ? `התחל ב${name} והתקדם ${dir}` : `התקדם ${dir}`,
      turns: {
        left:'פנה שמאלה', right:'פנה ימינה',
        'slight-left':'המשך מעט שמאלה', 'slight-right':'המשך מעט ימינה',
        'sharp-left':'פנה בחדות שמאלה', 'sharp-right':'פנה בחדות ימינה'
      },
      turn: (d, turn, landmark) => `לך ${d}, ואז ${turn}${landmark ? ` ליד ${landmark}` : ''}`,
      stairs: d => `לך ${d}, ואז השתמש במדרגות`,
      pass: (d, landmark, side) => `לך ${d}, ותעבור ליד ${landmark} ${side === 'left' ? 'משמאלך' : 'מימינך'}`,
      arrive: (d, name) => name ? `לך ${d} עד ${name}` : `לך ${d} עד היעד`,
      compact: {continue:'המשך ישר', stairs:'השתמש במדרגות', arrive:name => name ? `הגעת אל ${name}` : 'הגעת ליעד'}
    },
    ar: {
      meters: n => `${n} م`,
      compass: {north:'شمالًا', northeast:'نحو الشمال الشرقي', east:'شرقًا', southeast:'نحو الجنوب الشرقي', south:'جنوبًا', southwest:'نحو الجنوب الغربي', west:'غربًا', northwest:'نحو الشمال الغربي'},
      start: (name, dir) => name ? `ابدأ من ${name} واتجه ${dir}` : `اتجه ${dir}`,
      turns: {
        left:'انعطف يسارًا', right:'انعطف يمينًا',
        'slight-left':'انحرف قليلًا إلى اليسار', 'slight-right':'انحرف قليلًا إلى اليمين',
        'sharp-left':'انعطف بحدة إلى اليسار', 'sharp-right':'انعطف بحدة إلى اليمين'
      },
      turn: (d, turn, landmark) => `امشِ ${d}، ثم ${turn}${landmark ? ` قرب ${landmark}` : ''}`,
      stairs: d => `امشِ ${d}، ثم استخدم الدرج`,
      pass: (d, landmark, side) => `امشِ ${d}، مارًّا بجانب ${landmark} على ${side === 'left' ? 'يسارك' : 'يمينك'}`,
      arrive: (d, name) => name ? `امشِ ${d} حتى تصل إلى ${name}` : `امشِ ${d} حتى تصل`,
      compact: {continue:'تابع مباشرة', stairs:'استخدم الدرج', arrive:name => name ? `وصلت إلى ${name}` : 'لقد وصلت'}
    },
    ru: {
      meters: n => `${n} м`,
      compass: {north:'на север', northeast:'на северо-восток', east:'на восток', southeast:'на юго-восток', south:'на юг', southwest:'на юго-запад', west:'на запад', northwest:'на северо-запад'},
      start: (name, dir) => name ? `Начните в точке «${name}» и двигайтесь ${dir}` : `Двигайтесь ${dir}`,
      turns: {
        left:'поверните налево', right:'поверните направо',
        'slight-left':'держитесь левее', 'slight-right':'держитесь правее',
        'sharp-left':'резко поверните налево', 'sharp-right':'резко поверните направо'
      },
      turn: (d, turn, landmark) => `Пройдите ${d}, затем ${turn}${landmark ? ` рядом с ориентиром «${landmark}»` : ''}`,
      stairs: d => `Пройдите ${d}, затем воспользуйтесь лестницей`,
      pass: (d, landmark, side) => `Пройдите ${d}; ориентир «${landmark}» будет ${side === 'left' ? 'слева' : 'справа'}`,
      arrive: (d, name) => name ? `Пройдите ${d} до точки «${name}»` : `Пройдите ${d} до места назначения`,
      compact: {continue:'Продолжайте прямо', stairs:'Поднимитесь по лестнице', arrive:name => name ? `Вы прибыли: ${name}` : 'Вы прибыли'}
    }
  };

  // Text for one step. nameFor(name) may translate building names.
  function formatStep(step, lang = 'en', nameFor = name => name){
    const text = TEXT[lang] || TEXT.en;
    const distance = text.meters(roundMeters(step.meters || 0));
    const name = step.name ? nameFor(step.name) : '';
    if(step.kind === 'start') return text.start(name, text.compass[step.heading] || step.heading);
    if(step.kind === 'turn'){
      return text.turn(distance, text.turns[step.turn] || step.turn, step.landmark ? nameFor(step.landmark) : '');
    }
    if(step.kind === 'stairs') return text.stairs(distance);
    if(step.kind === 'pass') return text.pass(distance, nameFor(step.landmark), step.side);
    if(step.kind === 'arrive') return text.arrive(distance, name);
    return '';
  }

  // Short, glanceable text for the small current-direction banner. The full
  // formatStep wording remains available for the directions list and speech.
  function formatCompactStep(step, lang = 'en', nameFor = name => name){
    const text = TEXT[lang] || TEXT.en;
    const name = step.name ? nameFor(step.name) : '';
    if(step.kind === 'start') return text.start('', text.compass[step.heading] || step.heading);
    if(step.kind === 'turn') return text.turns[step.turn] || step.turn;
    if(step.kind === 'stairs') return text.compact.stairs;
    if(step.kind === 'pass') return text.compact.continue;
    if(step.kind === 'arrive') return text.compact.arrive(name);
    return '';
  }

  return {buildOutdoorSteps, formatStep, formatCompactStep, roundMeters, headingChange};
});
