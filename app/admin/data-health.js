// CampusWay admin: checks on the indoor map data, and the effect of closures
// and elevator outages on what can be reached.
//
// The indoor graph is built the same way as wayframe/navigation-demo.html:
// same-floor connections, plus stairs and elevators that share a connectorId
// linked between consecutive floors. Step-free routing skips stairs nodes.
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.CampusDataHealth = api;
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const DESTINATION_TYPES = ['room', 'restroom', 'food', 'landmark', 'shelter', 'library', 'clinic', 'museum', 'gym', 'parking'];
  const PLACEHOLDER_LABEL = /^(?:|node|new node|room|corridor|untitled|unnamed|label|tbd|todo|test|x+|\?+|-+|n\d+|node\s*\d+)$/i;

  function cid(node){
    const value = String(node && node.connectorId || '').trim();
    return !value || ['null', 'none', 'no', 'n/a'].includes(value.toLowerCase()) ? '' : value;
  }

  function elevatorNumber(value){
    const match = String(value ?? '').match(/\d+/);
    return match ? String(Number(match[0])) : String(value ?? '').trim().toLowerCase();
  }

  // floorminus1 → -1, floor600 → 600
  function floorNumber(floorId){
    const text = String(floorId).replace(/^floor/, '');
    if(/^minus\d+$/.test(text)) return -Number(text.slice(5));
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
  }

  function floorName(floorId){
    const number = floorNumber(floorId);
    return `Floor ${number}`;
  }

  function allNodes(graph){
    const nodes = [];
    Object.entries(graph && graph.floors || {}).forEach(([floorId, floor]) => {
      (floor.nodes || []).forEach(node => nodes.push({...node, floor:node.floor || floorId}));
    });
    return nodes;
  }

  // options: {accessible, closed:Set(nodeIds), elevatorOut:(connectorId) => bool}
  function buildIndoorGraph(graph, options = {}){
    const closed = options.closed || new Set();
    const elevatorOut = options.elevatorOut || (() => false);
    const accessible = options.accessible === true;
    const nodes = allNodes(graph);
    const by = new Map(nodes.map(node => [node.id, node]));
    const adj = new Map(nodes.map(node => [node.id, []]));

    Object.values(graph && graph.floors || {}).forEach(floor => {
      (floor.connections || []).forEach(connection => {
        const a = by.get(connection.from), b = by.get(connection.to);
        if(!a || !b) return;
        if(closed.has(a.id) || closed.has(b.id)) return;
        if(accessible && (a.type === 'stairs' || b.type === 'stairs')) return;
        adj.get(a.id).push(b.id);
        adj.get(b.id).push(a.id);
      });
    });

    const groups = new Map();
    nodes.forEach(node => {
      const connector = cid(node);
      if(accessible && node.type === 'stairs') return;
      if(!connector || !['stairs', 'elevator'].includes(node.type)) return;
      if(node.type === 'elevator' && elevatorOut(connector)) return;
      if(closed.has(node.id)) return;
      const key = `${node.type}:${connector}`;
      if(!groups.has(key)) groups.set(key, new Map());
      const perFloor = groups.get(key);
      if(!perFloor.has(node.floor)) perFloor.set(node.floor, []);
      perFloor.get(node.floor).push(node);
    });
    groups.forEach(perFloor => {
      const floors = [...perFloor.keys()].sort((a, b) => floorNumber(a) - floorNumber(b));
      for(let i = 0; i < floors.length - 1; i += 1){
        const aList = perFloor.get(floors[i]), bList = perFloor.get(floors[i + 1]);
        const a = aList[aList.length - 1], b = bList[bList.length - 1];
        adj.get(a.id).push(b.id);
        adj.get(b.id).push(a.id);
      }
    });
    return {by, adj, nodes};
  }

  function reachableFrom(built, startIds){
    const seen = new Set();
    const queue = startIds.filter(id => built.adj.has(id));
    queue.forEach(id => seen.add(id));
    while(queue.length){
      const id = queue.shift();
      for(const next of built.adj.get(id) || []){
        if(!seen.has(next)){ seen.add(next); queue.push(next); }
      }
    }
    return seen;
  }

  function entranceIds(graph, entrances){
    const ids = new Set(allNodes(graph).filter(node => node.type === 'entrance').map(node => node.id));
    (entrances || []).forEach(entrance => {
      if(entrance && entrance.nodeId && !entrance.onlyForService) ids.add(entrance.nodeId);
    });
    return [...ids];
  }

  function isDestination(node){
    return DESTINATION_TYPES.includes(node.type);
  }

  function describe(node){
    return {id:node.id, floor:node.floor, label:node.label || '', type:node.type, x:node.x, y:node.y};
  }

  // Destinations that become unreachable from the building's entrances when
  // going from `before` to `after` ({closed:Set, elevatorOut:fn}).
  function impact(graph, entrances, before, after){
    const starts = entranceIds(graph, entrances);
    const byId = new Map(allNodes(graph).map(node => [node.id, node]));
    const result = {};
    for(const accessible of [false, true]){
      const a = reachableFrom(buildIndoorGraph(graph, {...before, accessible}), starts.filter(id => !(before.closed || new Set()).has(id)));
      const b = reachableFrom(buildIndoorGraph(graph, {...after, accessible}), starts.filter(id => !(after.closed || new Set()).has(id)));
      const lost = [...a].filter(id => !b.has(id))
        .map(id => byId.get(id))
        .filter(node => node && isDestination(node))
        .map(describe);
      result[accessible ? 'stepFree' : 'general'] = lost;
    }
    return result;
  }

  function analyzeBuilding(key, graph, options = {}){
    const entrances = options.entrances || [];
    const issues = [];
    const add = (severity, code, message, nodes = [], extra = {}) => issues.push({severity, code, message, nodes:nodes.map(describe), building:key, ...extra});
    const nodes = allNodes(graph);
    const floors = Object.keys(graph && graph.floors || {}).sort((a, b) => floorNumber(a) - floorNumber(b));

    // Ids and connections
    const seen = new Map();
    const duplicates = [];
    nodes.forEach(node => {
      if(seen.has(node.id)) duplicates.push(node);
      seen.set(node.id, node);
    });
    if(duplicates.length) add('error', 'duplicate-id', `${duplicates.length} node id(s) are used more than once.`, duplicates);

    const degree = new Map(nodes.map(node => [node.id, 0]));
    let connections = 0;
    const broken = [];
    floors.forEach(floorId => {
      (graph.floors[floorId].connections || []).forEach(connection => {
        const a = seen.get(connection.from), b = seen.get(connection.to);
        if(!a || !b){ broken.push(connection); return; }
        connections += 1;
        if(a.floor !== b.floor) broken.push(connection);
        degree.set(a.id, degree.get(a.id) + 1);
        degree.set(b.id, degree.get(b.id) + 1);
      });
    });
    if(broken.length){
      add('error', 'broken-connection', `${broken.length} connection(s) point to a missing node or another floor.`, [], {connections:broken.slice(0, 50)});
    }

    // Floors
    floors.filter(floorId => !(graph.floors[floorId].nodes || []).length).forEach(floorId => {
      add('info', 'empty-floor', `${floorName(floorId)} has no nodes yet.`, [], {floor:floorId});
    });
    floors.forEach(floorId => {
      const list = graph.floors[floorId].nodes || [];
      if(list.length && !(graph.floors[floorId].connections || []).length){
        add('warning', 'no-connections', `${floorName(floorId)} has ${list.length} nodes but no connections, so nothing on it can be routed to.`, [], {floor:floorId});
      }
    });

    // Isolated nodes (skip floors that have no connections at all; reported above)
    const isolated = nodes.filter(node =>
      degree.get(node.id) === 0 && ((graph.floors[node.floor] || {}).connections || []).length
    );
    if(isolated.length) add('warning', 'isolated', `${isolated.length} node(s) have no connection on their floor.`, isolated);

    // Stairs and elevators
    const connectors = nodes.filter(node => ['stairs', 'elevator'].includes(node.type));
    const missing = connectors.filter(node => !cid(node));
    if(missing.length) add('warning', 'missing-connector', `${missing.length} of ${connectors.length} stairs/elevator nodes have no connector id, so they do not link floors.`, missing);
    const byConnector = new Map();
    connectors.filter(node => cid(node)).forEach(node => {
      const k = `${node.type}:${cid(node)}`;
      if(!byConnector.has(k)) byConnector.set(k, []);
      byConnector.get(k).push(node);
    });
    const lonely = [];
    byConnector.forEach(list => {
      if(new Set(list.map(node => node.floor)).size < 2) lonely.push(...list);
    });
    if(lonely.length) add('warning', 'single-floor-connector', `${lonely.length} stairs/elevator node(s) share their connector id with no other floor.`, lonely);

    // Labels
    const placeholders = nodes.filter(node => isDestination(node) && PLACEHOLDER_LABEL.test(String(node.label || '').trim()));
    if(placeholders.length) add('info', 'placeholder-label', `${placeholders.length} destination(s) have an empty or placeholder name.`, placeholders);

    // Entrances
    const entranceProblems = [];
    const entranceWrongType = [];
    entrances.forEach(entrance => {
      const node = seen.get(entrance.nodeId);
      if(!node) entranceProblems.push(entrance.nodeId);
      else if(node.type !== 'entrance') entranceWrongType.push(node);
    });
    if(entranceProblems.length) add('error', 'missing-entrance', `Campus entrances point to node(s) that are not in this map: ${entranceProblems.join(', ')}.`);
    if(entranceWrongType.length) add('info', 'entrance-type', `${entranceWrongType.length} campus entrance(s) are not "entrance" nodes.`, entranceWrongType);

    // Reachability from the entrances
    const starts = entranceIds(graph, entrances);
    const destinations = nodes.filter(isDestination);
    let reachableCount = 0;
    let stepFreeCount = 0;
    const perFloor = {};
    if(starts.length){
      const general = reachableFrom(buildIndoorGraph(graph), starts);
      const stepFree = reachableFrom(buildIndoorGraph(graph, {accessible:true}), starts);
      const unreachable = destinations.filter(node => !general.has(node.id));
      const noStepFree = destinations.filter(node => general.has(node.id) && !stepFree.has(node.id));
      reachableCount = destinations.length - unreachable.length;
      stepFreeCount = destinations.filter(node => stepFree.has(node.id)).length;
      floors.forEach(floorId => {
        const onFloor = destinations.filter(node => node.floor === floorId);
        perFloor[floorId] = {
          destinations:onFloor.length,
          reachable:onFloor.filter(node => general.has(node.id)).length,
          stepFree:onFloor.filter(node => stepFree.has(node.id)).length
        };
      });
      if(unreachable.length) add('warning', 'unreachable', `${unreachable.length} destination(s) cannot be reached from any entrance.`, unreachable);
      if(noStepFree.length) add('warning', 'no-step-free', `${noStepFree.length} destination(s) can only be reached using stairs.`, noStepFree);
    }else if(nodes.length){
      add('error', 'no-entrance', 'This map has no entrance node, so no indoor route can start from outside.');
    }

    const elevators = new Set(nodes.filter(node => node.type === 'elevator' && cid(node)).map(node => cid(node)));
    return {
      building:key,
      stats:{
        floors:floors.length,
        nodes:nodes.length,
        connections,
        destinations:destinations.length,
        rooms:nodes.filter(node => node.type === 'room').length,
        elevators:elevators.size,
        stairs:nodes.filter(node => node.type === 'stairs').length,
        entrances:starts.length,
        reachable:reachableCount,
        stepFree:stepFreeCount,
        perFloor
      },
      issues
    };
  }

  // Compares a JSON graph with its JavaScript copy (madriga-graph.js, ...).
  function compareCopy(jsonGraph, copyGraph){
    const count = graph => {
      const nodes = allNodes(graph).length;
      const connections = Object.values(graph && graph.floors || {}).reduce((sum, floor) => sum + (floor.connections || []).length, 0);
      return {nodes, connections};
    };
    const a = count(jsonGraph), b = count(copyGraph);
    return {json:a, copy:b, same:a.nodes === b.nodes && a.connections === b.connections};
  }

  // Elevator shafts of a building: [{connectorId, number, floors:[...]}]
  function elevators(graph){
    const map = new Map();
    allNodes(graph).filter(node => node.type === 'elevator' && cid(node)).forEach(node => {
      const id = cid(node);
      if(!map.has(id)) map.set(id, new Set());
      map.get(id).add(node.floor);
    });
    return [...map].map(([connectorId, floors]) => ({
      connectorId,
      number:elevatorNumber(connectorId),
      floors:[...floors].sort((a, b) => floorNumber(a) - floorNumber(b))
    })).sort((a, b) => a.connectorId.localeCompare(b.connectorId, undefined, {numeric:true}));
  }

  return {
    DESTINATION_TYPES, cid, elevatorNumber, floorNumber, floorName, allNodes,
    buildIndoorGraph, reachableFrom, entranceIds, impact, analyzeBuilding, compareCopy, elevators
  };
});
