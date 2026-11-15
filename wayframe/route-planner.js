(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampusRoutePlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPSILON = 1e-9;
  const DEFAULT_TURN_THRESHOLD_DEGREES = 35;
  const DEFAULT_TURN_PENALTY_METERS = 6;

  function isSuggestedRestSpace(node) {
    if (!node) return false;
    const type = String(node.type || '').trim().toLowerCase();
    const label = String(node.label || '').trim().toLowerCase();
    return type === 'landmark' ||
      type === 'library' ||
      /(^|\b)(garden|terrace)(\b|$)/i.test(label);
  }

  function nodeIds(adapter) {
    const values = typeof adapter.nodeIds === 'function'
      ? adapter.nodeIds()
      : adapter.nodeIds;
    return Array.from(values || []);
  }

  function neighbors(adapter, nodeId) {
    const values = adapter.neighbors(nodeId);
    return Array.isArray(values) ? values : Array.from(values || []);
  }

  function edgeTarget(adapter, edge) {
    return adapter.edgeTarget ? adapter.edgeTarget(edge) : edge.id;
  }

  function edgeWeight(adapter, edge) {
    const value = adapter.edgeWeight ? adapter.edgeWeight(edge) : edge.w;
    return Number(value);
  }

  function edgeAllowed(adapter, edge, fromId) {
    return !adapter.edgeAllowed || adapter.edgeAllowed(edge, fromId) !== false;
  }

  function point(adapter, nodeId) {
    return adapter.point ? adapter.point(nodeId) : null;
  }

function turnMagnitudeDegrees(
  adapter,
  previousNodeId,
  currentNodeId,
  nextNodeId
){
  // At the starting node, there is no incoming direction to compare.
  if(previousNodeId === null || previousNodeId === undefined){
    return 0;
  }

  const previousPoint = point(adapter, previousNodeId);
  const currentPoint = point(adapter, currentNodeId);
  const nextPoint = point(adapter, nextNodeId);

  // An angle cannot be calculated without all three positions.
  if(!previousPoint || !currentPoint || !nextPoint){
    return 0;
  }

  // When all three floors are known, exclude floor changes
  // from ordinary walking-turn calculations.
  if(
    previousPoint.floor !== undefined &&
    currentPoint.floor !== undefined &&
    nextPoint.floor !== undefined &&
    (
      previousPoint.floor !== currentPoint.floor ||
      currentPoint.floor !== nextPoint.floor
    )
  ){
    return 0;
  }

  // Direction of travel into the current node.
  const incomingDirection = {
    x: currentPoint.x - previousPoint.x,
    y: currentPoint.y - previousPoint.y
  };

  // Direction of travel out of the current node.
  const outgoingDirection = {
    x: nextPoint.x - currentPoint.x,
    y: nextPoint.y - currentPoint.y
  };

  const incomingLength = Math.hypot(
    incomingDirection.x,
    incomingDirection.y
  );

  const outgoingLength = Math.hypot(
    outgoingDirection.x,
    outgoingDirection.y
  );

  // Coincident or extremely close points do not define a reliable direction.
  if(incomingLength <= EPSILON || outgoingLength <= EPSILON){
    return 0;
  }

  // The 2D cross product captures the signed sideways change.
  const crossProduct =
    incomingDirection.x * outgoingDirection.y -
    incomingDirection.y * outgoingDirection.x;

  // The dot product captures how strongly the directions align.
  const dotProduct =
    incomingDirection.x * outgoingDirection.x +
    incomingDirection.y * outgoingDirection.y;

  // Absolute cross product removes the left/right distinction.
  // atan2 returns the unsigned angle in radians, from 0 to PI.
  const angleRadians = Math.atan2(
    Math.abs(crossProduct),
    dotProduct
  );

  // Convert radians to degrees.
  return angleRadians * 180 / Math.PI;
}

function routingOptions(options = {}){
  // Enable fewer-turns routing only for the Boolean value true.
  const preferFewerTurns = options.preferFewerTurns === true;

  // Use the default turn threshold unless a finite number was supplied.
  let turnThresholdDegrees = DEFAULT_TURN_THRESHOLD_DEGREES;

  if(Number.isFinite(options.turnThresholdDegrees)){
    turnThresholdDegrees = options.turnThresholdDegrees;
  }

  // Use the default turn penalty unless a finite number was supplied.
  let turnPenaltyMeters = DEFAULT_TURN_PENALTY_METERS;

  if(Number.isFinite(options.turnPenaltyMeters)){
    turnPenaltyMeters = options.turnPenaltyMeters;
  }

  return {
    preferFewerTurns,
    turnThresholdDegrees,
    turnPenaltyMeters
  };
}

function turnDetails(
  adapter,
  previousNodeId,
  currentNodeId,
  nextNodeId,
  options
){
  // Measure the change in direction along:
  // previous node → current node → next node.
  const turnAngleDegrees = turnMagnitudeDegrees(
    adapter,
    previousNodeId,
    currentNodeId,
    nextNodeId
  );

  // Only angles at or above the threshold count as turns.
  const isTurn = turnAngleDegrees >= options.turnThresholdDegrees;

  // Add a cost only when fewer-turns routing is enabled
  // and this direction change qualifies as a turn.
  let turnPenalty = 0;

  if(options.preferFewerTurns && isTurn){
    turnPenalty = options.turnPenaltyMeters;
  }

  // Preserve the property names expected by the search algorithm.
  return {
    magnitude: turnAngleDegrees,
    isTurn,
    penalty: turnPenalty
  };
}

  function pathMetrics(adapter, path, rawOptions = {}) {
    if (!Array.isArray(path) || !path.length) return null;
    const options = routingOptions(rawOptions);
    let distance = 0;
    let turns = 0;

    for (let index = 0; index < path.length - 1; index++) {
      const fromId = path[index];
      const toId = path[index + 1];
      const edge = neighbors(adapter, fromId).find(candidate =>
        edgeAllowed(adapter, candidate, fromId) &&
        edgeTarget(adapter, candidate) === toId
      );
      if (!edge) return null;
      const weight = edgeWeight(adapter, edge);
      if (!Number.isFinite(weight) || weight < 0) return null;
      distance += weight;

      if (index > 0) {
        const details = turnDetails(
          adapter,
          path[index - 1],
          fromId,
          toId,
          options
        );
        if (details.isTurn) turns++;
      }
    }

    return {
      distance,
      turns,
      score: distance + (
        options.preferFewerTurns
          ? turns * options.turnPenaltyMeters
          : 0
      )
    };
  }

function reconstructNodePath(startId, endId, previousNode, previousEdge){
  // If both endpoints are the same, no connections are needed.
  if(startId === endId){
    return {
      nodes: [startId],
      edges: []
    };
  }

  // Without a predecessor for the destination, we cannot rebuild a route.
  if(!previousNode.has(endId)){
    return null;
  }

  // Start at the destination and trace the route backwards.
  const routeNodes = [endId];
  const routeEdges = [];
  let currentNodeId = endId;

  while(currentNodeId !== startId){
    const predecessorId = previousNode.get(currentNodeId);
    const incomingEdge = previousEdge.get(currentNodeId);

    // Stop if the predecessor chain is incomplete.
    if(predecessorId === undefined || !incomingEdge){
      return null;
    }

    // Add at the beginning so the result is ordered from start to end.
    routeNodes.unshift(predecessorId);
    routeEdges.unshift(incomingEdge);

    // Move backwards to the preceding node.
    currentNodeId = predecessorId;
  }

  // Keep the property names expected by the rest of the planner.
  return {
    nodes: routeNodes,
    edges: routeEdges
  };
}
  //contains the dijkstra algorithm
 function shortestDistancePath(adapter, startId, endId, options){
  const allNodeIds = nodeIds(adapter);
  const existingNodeIds = new Set(allNodeIds);

  // Both endpoints must exist in the graph.
  if(!existingNodeIds.has(startId) || !existingNodeIds.has(endId)){
    return null;
  }

  // Store the cheapest cost discovered so far for each node.
  // Infinity means that no route to the node has been discovered yet.
  const bestKnownCosts = new Map(
    allNodeIds.map(nodeId => [nodeId, Infinity])
  );

  // Remember how we reached each node along its best known route.
  const previousNode = new Map();
  const previousEdge = new Map();

  // These nodes have not had their shortest costs finalised yet.
  const unvisitedNodes = new Set(allNodeIds);

  // Reaching the starting node requires no travel.
  bestKnownCosts.set(startId, 0);

  while(unvisitedNodes.size > 0){
    let currentNodeId = null;
    let currentCost = Infinity;

    // Find the unvisited node with the smallest known cost.
    for(const nodeId of unvisitedNodes){
      const nodeCost = bestKnownCosts.get(nodeId);

      if(nodeCost < currentCost){
        currentNodeId = nodeId;
        currentCost = nodeCost;
      }
    }

    // Stop if no reachable unvisited node remains.
    if(currentNodeId === null || currentCost === Infinity){
      break;
    }

    // Once the destination is selected as the cheapest unvisited node,
    // its shortest cost is established.
    if(currentNodeId === endId){
      break;
    }

    // Finalise this node: later steps will not update its cost.
    unvisitedNodes.delete(currentNodeId);

    // Examine every outgoing connection from the current node.
    for(const edge of neighbors(adapter, currentNodeId)){
      // Skip connections forbidden by the adapter's routing rules.
      if(!edgeAllowed(adapter, edge, currentNodeId)){
        continue;
      }

      const neighborId = edgeTarget(adapter, edge);
      const connectionCost = edgeWeight(adapter, edge);

      // Skip finalised or unknown neighbours, invalid costs,
      // and negative costs, which this Dijkstra implementation excludes.
      if(
        !unvisitedNodes.has(neighborId) ||
        !Number.isFinite(connectionCost) ||
        connectionCost < 0
      ){
        continue;
      }

      // Calculate the cost of reaching this neighbour
      // through the current node.
      const candidateCost = currentCost + connectionCost;

      // Keep this route only if it improves the neighbour's known cost.
      if(candidateCost < bestKnownCosts.get(neighborId)){
        bestKnownCosts.set(neighborId, candidateCost);

        previousNode.set(neighborId, currentNodeId);
        previousEdge.set(neighborId, edge);
      }
    }
  }

  // Infinity means the destination could not be reached.
  if(bestKnownCosts.get(endId) === Infinity){
    return null;
  }

  // Follow the predecessor records to rebuild the ordered route.
  const path = reconstructNodePath(
    startId,
    endId,
    previousNode,
    previousEdge
  );

  if(!path){
    return null;
  }

  // Calculate the route's distance, turn count and score.
  const metrics = pathMetrics(adapter, path.nodes, options);

  if(!metrics){
    return null;
  }

  // Combine the node/edge sequence with its calculated metrics.
  return {
    ...path,
    ...metrics
  };
}

function stateKey(previousNodeId, currentNodeId){
  // JSON preserves the order and boundaries of both IDs.
  // The starting state uses null for the previous node.
  return JSON.stringify([
    previousNodeId,
    currentNodeId
  ]);
}
//better() decides whether a candidate record should replace an existing one
function better(candidateRecord, existingRecord){
  // A candidate wins if there is no existing record to compete with.
  if(!existingRecord){
    return true;
  }

  // First preference: a lower total score.
  // EPSILON provides a tolerance for floating-point rounding.
  if(
    candidateRecord.score <
    existingRecord.score - EPSILON
  ){
    return true;
  }

  // If the scores differ beyond the tolerance, and the candidate
  // did not win above, the existing record has the better score.
  if(
    Math.abs(candidateRecord.score - existingRecord.score) >
    EPSILON
  ){
    return false;
  }

  // Scores are effectively tied: prefer fewer turns.
  if(candidateRecord.turns < existingRecord.turns){
    return true;
  }

  if(candidateRecord.turns > existingRecord.turns){
    return false;
  }

  // Scores and turn counts are tied:
  // prefer a lower total edge cost, excluding turn penalties.
  return (
    candidateRecord.distance <
    existingRecord.distance - EPSILON
  );
}

function simplerPath(adapter, startId, endId, options){
  const allNodeIds = nodeIds(adapter);
  const existingNodeIds = new Set(allNodeIds);

  // Both endpoints must exist in the graph.
  if(!existingNodeIds.has(startId) || !existingNodeIds.has(endId)){
    return null;
  }

  // No travel is needed when both endpoints are the same.
  if(startId === endId){
    return {
      nodes: [startId],
      edges: [],
      distance: 0,
      turns: 0,
      score: 0
    };
  }

  // A search state represents:
  // "We arrived at currentId from previousId."
  // The starting state has no previous node.
  const startingStateKey = stateKey(null, startId);

  const stateRecords = new Map([
    [
      startingStateKey,
      {
        previousId: null,
        currentId: startId,
        distance: 0,
        turns: 0,
        score: 0
      }
    ]
  ]);

  // Discovered states still waiting to be processed.
  const pendingStates = new Set([startingStateKey]);

  // States whose best records have already been finalised.
  const visitedStates = new Set();

  // Remember the preceding state and connection for reconstruction.
  const previousState = new Map();
  const previousEdge = new Map();

  let destinationStateKey = null;

  while(pendingStates.size > 0){
    let currentStateKey = null;
    let currentRecord = null;

    // Select the best pending state using the existing comparison rules.
    for(const candidateStateKey of pendingStates){
      const candidateRecord = stateRecords.get(candidateStateKey);

      if(better(candidateRecord, currentRecord)){
        currentStateKey = candidateStateKey;
        currentRecord = candidateRecord;
      }
    }

    if(!currentRecord){
      break;
    }

    pendingStates.delete(currentStateKey);

    if(visitedStates.has(currentStateKey)){
      continue;
    }

    visitedStates.add(currentStateKey);

    // The selected state has reached the destination.
    if(currentRecord.currentId === endId){
      destinationStateKey = currentStateKey;
      break;
    }

    // Examine connections leaving the current node.
    for(const edge of neighbors(adapter, currentRecord.currentId)){
      if(!edgeAllowed(adapter, edge, currentRecord.currentId)){
        continue;
      }

      const neighborId = edgeTarget(adapter, edge);
      const connectionCost = edgeWeight(adapter, edge);

      // Skip unknown nodes and invalid or negative connection costs.
      if(
        !existingNodeIds.has(neighborId) ||
        !Number.isFinite(connectionCost) ||
        connectionCost < 0
      ){
        continue;
      }

      // Measure the turn made by travelling:
      // previous node → current node → neighbour.
      const turnInformation = turnDetails(
        adapter,
        currentRecord.previousId,
        currentRecord.currentId,
        neighborId,
        options
      );

      const nextRecord = {
        previousId: currentRecord.currentId,
        currentId: neighborId,

        // Total edge cost, without turn penalties.
        distance: currentRecord.distance + connectionCost,

        // Number of recognised turns along this route.
        turns:
          currentRecord.turns +
          (turnInformation.isTurn ? 1 : 0),

        // Total edge cost plus turn penalties.
        score:
          currentRecord.score +
          connectionCost +
          turnInformation.penalty
      };

      // Arriving at this neighbour from a different node
      // would represent a different search state.
      const nextStateKey = stateKey(
        currentRecord.currentId,
        neighborId
      );

      // Keep the original rule: do not reopen finalised states,
      // and replace a record only when the candidate is better.
      if(
        visitedStates.has(nextStateKey) ||
        !better(nextRecord, stateRecords.get(nextStateKey))
      ){
        continue;
      }

      stateRecords.set(nextStateKey, nextRecord);
      previousState.set(nextStateKey, currentStateKey);
      previousEdge.set(nextStateKey, edge);
      pendingStates.add(nextStateKey);
    }
  }

  // No destination state was reached.
  if(!destinationStateKey){
    return null;
  }

  // Reconstruct the route by following states backwards.
  const routeNodes = [];
  const routeEdges = [];
  let reconstructionStateKey = destinationStateKey;

  while(reconstructionStateKey){
    const record = stateRecords.get(reconstructionStateKey);

    if(!record){
      return null;
    }

    routeNodes.unshift(record.currentId);

    const incomingEdge = previousEdge.get(reconstructionStateKey);

    if(incomingEdge){
      routeEdges.unshift(incomingEdge);
    }

    reconstructionStateKey =
      previousState.get(reconstructionStateKey);
  }

  const destinationRecord = stateRecords.get(destinationStateKey);

  return {
    nodes: routeNodes,
    edges: routeEdges,
    distance: destinationRecord.distance,
    turns: destinationRecord.turns,
    score: destinationRecord.score
  };
}

    function findPath(adapter, startId, endId, rawOptions = {}){
      // Apply the routing defaults to the supplied options.
      const options = routingOptions(rawOptions);

      // Without a preference for fewer turns, minimise total edge cost.
      if(!options.preferFewerTurns){
        return shortestDistancePath(
          adapter,
          startId,
          endId,
          options
        );
      }

      // Otherwise, search using both travel cost and turn penalties.
      const routeWithFewerTurns = simplerPath(
        adapter,
        startId,
        endId,
        options
      );

      // No permitted route was found.
      if(!routeWithFewerTurns){
        return null;
      }

      // A Set keeps only unique IDs.
      // Fewer unique IDs than route entries means a node was visited twice.
      const uniqueNodeCount = new Set(routeWithFewerTurns.nodes).size;
      const routeNodeCount = routeWithFewerTurns.nodes.length;
      const hasRepeatedNode = uniqueNodeCount !== routeNodeCount;

      // Turn penalties can sometimes favour a loop.
      // If that happens, fall back to the ordinary shortest-cost route.
      if(hasRepeatedNode){
        return shortestDistancePath(
          adapter,
          startId,
          endId,
          options
        );
      }

      return routeWithFewerTurns;
    }

  return {
    findPath,
    pathMetrics,
    turnMagnitudeDegrees,
    isSuggestedRestSpace,
    DEFAULT_TURN_THRESHOLD_DEGREES,
    DEFAULT_TURN_PENALTY_METERS
  };
});
