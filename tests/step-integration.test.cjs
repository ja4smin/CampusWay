const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{test}=require('node:test');
const root=path.join(__dirname,'..');
const nav=fs.readFileSync(path.join(root,'wayframe/navigation-demo.html'),'utf8');
const tester=fs.readFileSync(path.join(root,'wayframe/sensor-test.html'),'utf8');
  const modules=['step-detector.js','heading-tracker.js','route-progress.js','wheelchair-navigation.js','route-planner.js'];
function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);
}
function harness(testPage=false,permission){
  const elements=new Map(),listeners=new Map(),timers=new Map(),frames=new Map();let clock=0,serial=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',style:{},disabled:false,hidden:false,className:'',attributes:{},setAttribute(name,value){this.attributes[name]=String(value);}});return elements.get(id);};
  const bodyClasses = new Set();
const document = {
  body: {
    classList: {
      add(...names){ names.forEach(name => bodyClasses.add(name)); },
      remove(...names){ names.forEach(name => bodyClasses.delete(name)); },
      contains(name){ return bodyClasses.has(name); }
    }
  },
  getElementById:element,
  addEventListener(name,fn){ listeners.set(name,fn); },
  hidden:false
};
  const window={screen:{orientation:{angle:0}},addEventListener(name,fn){listeners.set(name,fn);}};
  const storage = new Map();

const sessionStorage = {
  getItem(key){
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value){
    storage.set(key, String(value));
  },
  removeItem(key){
    storage.delete(key);
  },
  clear(){
    storage.clear();
  }
};

window.sessionStorage = sessionStorage;
const timeouts = new Map();

function setTimeoutMock(callback, delay = 0){
  const id = ++serial;

  timeouts.set(id, {
    callback,
    due: clock + Math.max(0, Number(delay) || 0)
  });

  return id;
}

function clearTimeoutMock(id){
  timeouts.delete(id);
}

window.setTimeout = setTimeoutMock;
window.clearTimeout = clearTimeoutMock;
  const context=vm.createContext({
  sessionStorage,
  setTimeout: setTimeoutMock,
  clearTimeout: clearTimeoutMock,
  console:{log(){},warn(){},error(){}},document,window,performance:{now:()=>clock},
    setInterval(fn){const id=++serial;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);},
    setTimeout(fn,delay=0){const id=++serial;clock+=Math.max(0,Number(delay)||0);Promise.resolve().then(fn);return id;},clearTimeout(){},
    requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
    DeviceMotionEvent:permission?{requestPermission:permission}:undefined});
  const run=code=>vm.runInContext(code,context);
  for(const module of modules)run(fs.readFileSync(path.join(root,'wayframe',module),'utf8'));
  if(testPage){
    run([...tester.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'));
  }else{
    run(between(nav,'let routePath=[];',"const svg=$('mapSvg');"));
    run(`let BUILDING='main'; let GRAPH={floors:{}};
      function localizedInstruction(en){return en;} function it(key){return key;}
      function drawBaseMap(){} function floorButtons(){} function followNode(){}
      function syncMobileIndoorGuide(){}
      function setMobileIndoorGuideOpen(){}
      function currentHeading(){return 0;} function describeRoute(){}
      let testProfile='general'; function selectedRoutingProfile(){return testProfile;}
      function resolveSelection(value){return value;} function selectionLabel(value){return value;}
      let testNodes=[{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'B',floor:'floor500',x:0,y:0}];
      let dijkstraCalls=0,dijkstraAccessible=[]; function dijkstra(){dijkstraCalls++;dijkstraAccessible.push(Boolean($('accessibleRoute').checked));return testNodes.map(n=>n.id);}
      function nodeById(id){return testNodes.find(n=>n.id===id);} async function loadGraph(){}
      function floorLabel(f){return f;} function localizedFloor(f){return f;} function localizedNodeLabel(f){return f;}
      function mapPoint(n){return {x:n.x*132.6,y:n.y*101.2};}`);
    run(between(nav, 'function cid(n){', 'function esc('));
    run(between(nav,'function currentInterpolated(){','function drawUserMarker(){'));
    // Actual route, signed movement, instructions, sensor and lifecycle code; only drawing/loading are stubbed.
    run(between(nav,'function route(){',"$('fromFloor').onchange="));
    run(
  between(
    nav,
    "let navMode = indoorDemoMode ? 'auto' : 'sensor';",
    "$('routeBtn').onclick=route;"
  ).replace(
    "let navMode = indoorDemoMode ? 'auto' : 'sensor';",
    "let navMode = 'auto';"
  )
);
    run(between(nav,"document.getElementById('building').onchange =",'function floorLabel('));
    run('routeNodes=testNodes.slice();sensorsEnabled=true;');
  }
  const orient=(time,bearing,extra={})=>{
    clock=time;const event={alpha:(360-bearing)%360,beta:20,gamma:0,absolute:false,...extra};
    if(testPage)listeners.get('deviceorientation')(event);else run('updateDeviceHeading('+JSON.stringify(event)+')');
  };
  const stable=(start,end,bearing,extra)=>{for(let t=start;t<=end;t+=50)orient(t,bearing,extra);};
  const injectSteps=(time,stepTimes)=>{
    clock=time;run(`stepDetector.updateMotion=()=>({...stepDetector.snapshot(),valid:true,stepTimes:${JSON.stringify(stepTimes)},stepsAdded:${stepTimes.length}})`);run('updateDeviceMotion({})');
  };
  const setRoute=nodes=>run('testNodes='+JSON.stringify(nodes)+';routeNodes=testNodes.slice();progressIndex=0;progressT=0;activeFloor=testNodes[0].floor;');
  const position=()=>run('currentInterpolated()');
  const drain=()=>{
    const positions=[];
    for(let guard=0;frames.size&&guard<2000;guard++){
      const [id,fn]=frames.entries().next().value;frames.delete(id);clock+=20;fn(clock);positions.push(position());
    }
    assert.equal(frames.size,0,'movement animation must finish');return positions;
  };
  async function advanceTime(milliseconds){
  const targetTime = clock + milliseconds;

  for(let guard = 0; guard < 1000; guard++){
    // Let pending async functions schedule their next timer.
    for(let i = 0; i < 5; i++){
      await Promise.resolve();
    }

    const next = [...timeouts.entries()]
      .filter(([, timer]) => timer.due <= targetTime)
      .sort((a, b) => a[1].due - b[1].due)[0];

    if(!next){
      clock = targetTime;
      return;
    }

    const [id, timer] = next;
    timeouts.delete(id);
    clock = Math.max(clock, timer.due);
    timer.callback();
  }

  throw new Error('Fake timers did not finish.');
}
  const chooseRoute=()=>{for(const id of ['fromFloor','toFloor'])element(id).value='floor500';element('from').value='a';element('to').value='b';run('route()');};
  return {advanceTime,run,element,listeners,timers,frames,document,window,orient,stable,injectSteps,setRoute,position,drain,chooseRoute,setClock:t=>{clock=t;}};
}
async function startSensor(h, heading = 0, start = 0){
  h.run("setNavigationMode('sensor')");
  h.setClock(start);

  const starting = h.run('startNavigation()');

  // Supply compass readings while automatic calibration runs.
  for(let elapsed = 0; elapsed <= 400; elapsed += 50){
    h.orient(start + elapsed, heading);
    await h.advanceTime(50);
  }

  await starting;

  assert.equal(
    h.run('navigationActive'),
    true,
    'Navigation should start after stable automatic calibration'
  );
}
async function startWheelchair(h){
  h.element('accessibleRoute').checked=true;
  h.run("setNavigationMode('wheelchair')");await h.run('startNavigation()');assert.equal(h.run('navigationActive'),true);
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-7,`${actual} ~= ${expected}`);}
function travelled(h){return (1-h.position().y)*101.2;}

test('scripts parse and shared helpers load before both consumers',()=>{
  for(const source of [nav,tester]){
    for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
    for(const file of ['step-detector.js','heading-tracker.js'])assert.ok(source.indexOf('src="'+file+'"')<source.indexOf('<script>'));
  }
  for(const module of modules)new vm.Script(fs.readFileSync(path.join(root,'wayframe',module),'utf8'));
  assert.ok(nav.indexOf('src="route-progress.js"')<nav.indexOf('<script>'));
  assert.match(nav,/class="navStack"[\s\S]*class="navBanner"[\s\S]*id="wheelchairMapControls"/);
  const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');new vm.Script(sw);
  for(const file of [...modules,'sensor-test.html','navigation-demo.html'])assert.ok(sw.includes('./wayframe/'+file));
  assert.match(sw,/skipWaiting\(\)/);
  assert.match(sw,/clients\.claim\(\)/);
});

test('sensors wait for stable automatic calibration before counting or moving', async () => {
  const h = harness();

  h.run("setNavigationMode('sensor')");
  const starting = h.run('startNavigation()');

  assert.equal(h.run('navigationActive'), false);
  assert.equal(h.frames.size, 0);

  h.injectSteps(50, [25]);

  assert.equal(h.run('detectedSteps'), 0);
  assert.equal(h.run('navigationActive'), false);

  for(let time = 100; time <= 500; time += 50){
    h.orient(time, 40);
    await h.advanceTime(50);
  }

  await starting;

  assert.equal(h.run('navigationActive'), true);
  near(travelled(h), 0);
});

test('navigation and diagnostic count identical raw slow-walking samples',async()=>{
  const n=harness(),s=harness(true);await startSensor(n);await s.run('enableSensors()');
  for(let t=500;t<10000;t+=20){
    const elapsed=t-500,phase=elapsed<1000?0:(elapsed-1000)%1400;
    const pulse=elapsed>=1000&&elapsed<8800&&phase<600?3*Math.sin(2*Math.PI*phase/600):0;
    const sample={accelerationIncludingGravity:{x:0,y:0,z:9.81+pulse}};
    for(const h of [n,s]){h.setClock(t);h.orient(t,0);}
    n.run('updateDeviceMotion('+JSON.stringify(sample)+')');s.listeners.get('devicemotion')(sample);
  }
  const count=n.run('detectedSteps');assert.ok(count>=5,'slow walking must be counted');assert.equal(count,Number(s.element('steps').textContent));
});

test('delayed batch animates five forward then three reverse in FIFO order to net two',async()=>{
  const h=harness();await startSensor(h);h.stable(450,2800,0);h.stable(2850,4550,180);
  h.injectSteps(4550,[700,1200,1700,2200,2700,3400,3900,4400]);
  assert.deepEqual(Array.from(h.run('stepMovementQueue')),Array(5).fill(0.65).concat(Array(3).fill(-0.65)));
  const positions=h.drain();near(travelled(h),1.3);assert.ok(Math.max(...positions.map(p=>(1-p.y)*101.2))>3.2,'forward travel must not be netted away');
  assert.equal(h.run('lastTravelDirection'),-1);assert.match(h.element('instruction').textContent,/Returning/);
});

test('turning alone causes no progress and unstable, sideways or stale headings hold position',async()=>{
  const h=harness();await startSensor(h);h.stable(450,800,0);h.injectSteps(800,[750]);h.drain();const before=travelled(h);
  h.stable(1500,1900,180);near(travelled(h),before);assert.equal(h.frames.size,0);
  h.stable(1950,2000,90);h.injectSteps(2000,[2000]);h.stable(2050,2400,90);h.injectSteps(2400,[2350]);h.injectSteps(2900,[2900]);
  assert.equal(h.frames.size,0);near(travelled(h),before);assert.match(h.element('status').textContent,/unclear/);
});

test('start/end bounds clamp steps and estimated arrival still permits turnaround',async()=>{
  const h=harness();h.setRoute([{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'B',floor:'floor500',x:0,y:1-1.3/101.2}]);await startSensor(h);
  h.stable(450,850,180);h.injectSteps(850,[800]);h.drain();near(travelled(h),0);
  h.stable(900,1600,0);h.injectSteps(1600,[1200,1400,1550]);h.drain();near(travelled(h),1.3);
  assert.equal(h.run('navigationActive'),true);assert.match(h.element('instruction').textContent,/Estimated arrival/);
  h.stable(2800,3200,180);h.injectSteps(3200,[3150]);h.drain();near(travelled(h),0.65);
  h.stable(3600,4000,180);h.injectSteps(4000,[3800,3950]);h.drain();near(travelled(h),0);
});

test('Phone Sensors arrival is confirmed by the user and then completes navigation',async()=>{
  const h=harness();h.setRoute([{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'B',floor:'floor500',x:0,y:1-1.3/101.2}]);await startSensor(h);
  h.stable(450,1600,0);h.injectSteps(1600,[1200,1400,1550]);h.drain();near(travelled(h),1.3);
  assert.equal(h.run('navigationActive'),true);
  assert.match(h.element('instruction').textContent,/Estimated arrival/);
  assert.equal(h.element('sensorConfirmBtn').hidden,false);
  assert.match(h.element('sensorConfirmBtn').textContent,/I have arrived/);
  // Walking back from the estimated end withdraws the confirmation.
  h.stable(2800,3200,180);h.injectSteps(3200,[3150]);h.drain();near(travelled(h),0.65);
  assert.equal(h.element('sensorConfirmBtn').hidden,true);
  assert.equal(h.run('sensorArrivalReady'),false);
  // Reaching the end again offers it again; confirming finishes the route.
  h.stable(3600,4400,0);h.injectSteps(4400,[4300]);h.drain();near(travelled(h),1.3);
  assert.equal(h.element('sensorConfirmBtn').hidden,false);
  await h.run("$('sensorConfirmBtn').onclick()");
  assert.equal(h.run('navigationActive'),false);
  assert.equal(h.element('sensorConfirmBtn').hidden,true);
  assert.match(h.element('instruction').textContent,/You have arrived/);
});

test('Phone Sensors exit confirmation on the origin leg hands the journey back outdoors',async()=>{
  const h=harness();h.setRoute([{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'Exit',floor:'floor500',x:0,y:1-1.3/101.2}]);
  h.run('this').URLSearchParams=URLSearchParams;
  h.run("sessionStorage.setItem('journeyStage','origin');window.location={search:'?building=main',replace(url){window.replacedWith=url;}};");
  await startSensor(h);
  h.stable(450,1600,0);h.injectSteps(1600,[1200,1400,1550]);h.drain();near(travelled(h),1.3);
  assert.match(h.element('instruction').textContent,/Estimated exit/);
  assert.match(h.element('sensorConfirmBtn').textContent,/I reached the exit/);
  await h.run("$('sensorConfirmBtn').onclick()");
  assert.equal(h.run("sessionStorage.getItem('originIndoorComplete')"),'true');
  assert.equal(h.run("sessionStorage.getItem('journeyStage')"),'destination');
  // Arrival waits for the user to choose the next journey leg.
  assert.equal(h.run('arrivalNextStep.kind'),'outdoor');
  assert.equal(h.run('window.replacedWith'),undefined);
  h.run('arrivalNextStep.run()');
  assert.equal(h.run('window.replacedWith'),'../index.html?resumeJourney=1');});

test('endpoint pause and automatic recalibration facing start allows backtracking',async()=>{
  const h=harness();h.setRoute([{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'B',floor:'floor500',x:0,y:1-0.65/101.2}]);await startSensor(h);
  h.stable(450,850,0);h.injectSteps(850,[800]);h.drain();near(travelled(h),0.65);
  h.document.hidden=true;h.listeners.get('visibilitychange')();assert.match(h.element('status').textContent,/Face back along the route, then press Start\./);
  h.document.hidden = false;
await startSensor(h, 210, 1500);
  h.stable(2000,2400,210);h.injectSteps(2400,[2350]);h.drain();near(travelled(h),0);
});

test('mid-route reverse interruption keeps the return prompt and direction',async()=>{
  const h=harness();h.setRoute([{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'B',floor:'floor500',x:0,y:0}]);await startSensor(h);
  h.run('progressIndex=0;progressT=0.5;lastTravelDirection=-1');h.listeners.get('orientationchange')();
  assert.match(h.element('directionStatus').textContent,/Face back along the route, then press Start\./);
  const restarting=h.element('calibrateBtn').onclick();h.stable(1000,1400,180);await restarting;
  assert.equal(h.run('navigationActive'),true);assert.equal(h.run('lastTravelDirection'),-1);
  const classification=h.run("headingTracker.classify(performance.now(),CampusRouteProgress.candidates(routeNodes,{index:progressIndex,t:progressT}))");
  assert.equal(classification.direction,-1);
});

test('old heading cannot keep pushing beyond the corner tolerance',async()=>{
  const h=harness();h.setRoute([{id:'a',label:'A',floor:'floor500',x:0,y:1},{id:'b',label:'Corner',floor:'floor500',x:1.3/132.6,y:1},{id:'c',label:'C',floor:'floor500',x:1.3/132.6,y:0}]);
  await startSensor(h,90);h.stable(450,2600,90);h.injectSteps(2600,[800,1300,1800,2300]);h.drain();
  near(h.position().x,1.3/132.6);near(travelled(h),0.65);assert.match(h.element('status').textContent,/unclear/);
  h.stable(4200,4650,0);h.injectSteps(4650,[4600]);h.drain();near(travelled(h),1.3);
});

test('stairs confirmation blocks steps, changes floor and resumes navigation', async () => {
  const h = harness();

  h.setRoute([
    {id:'a', label:'A', floor:'floor500', x:0, y:1},
    {
      id:'s500', label:'Stairs', type:'stairs',
      floor:'floor500', x:0, y:1-0.65/101.2
    },
    {
      id:'s600', label:'Stairs', type:'stairs',
      floor:'floor600', x:0, y:1-0.65/101.2
    },
    {id:'d', label:'D', floor:'floor600', x:0, y:0}
  ]);

  await startSensor(h);

  h.stable(450, 1100, 0);
  h.injectSteps(1100, [700, 1000]);
  h.drain();

  assert.equal(h.run('progressIndex'), 1);
  assert.equal(h.position().floor, 'floor500');
  assert.match(h.element('instruction').textContent, /Take the stairs/);
  assert.equal(h.element('sensorConfirmBtn').hidden, false);

  // Walking readings cannot move the dot during floor confirmation.
  const count = h.run('detectedSteps');
  h.stable(1600, 2100, 180);
  h.injectSteps(2100, [2050]);
  h.drain();

  assert.equal(h.run('progressIndex'), 1);
  assert.equal(h.position().floor, 'floor500');
  assert.equal(h.run('detectedSteps'), count);

  // Confirm the new floor and supply readings for recalibration.
  h.setClock(2200);
  const confirming = h.element('sensorConfirmBtn').onclick();

  for(let elapsed = 0; elapsed <= 500; elapsed += 50){
    h.orient(2200 + elapsed, 0);
    await h.advanceTime(50);
  }

  await confirming;

  assert.equal(h.run('progressIndex'), 2);
  assert.equal(h.run('activeFloor'), 'floor600');
  assert.equal(h.element('sensorConfirmBtn').hidden, true);
  assert.equal(h.run('navigationActive'), true);
  assert.equal(h.run('headingTracker.isCalibrated'), true);
});

test('Auto to Sensors cancels automatic movement and waits for calibration', async () => {
  const h = harness();

  await h.run('startNavigation()');

  const oldTick = [...h.timers.values()][0];
  oldTick();

  const before = travelled(h);

  h.run("setNavigationMode('sensor')");

  assert.equal(h.timers.size, 0);
  assert.equal(h.run('navigationActive'), false);
  assert.equal(h.element('startBtn').disabled, false);

  const starting = h.run('startNavigation()');

  oldTick();

  near(travelled(h), before);
  assert.equal(h.run('navigationActive'), false);

  // With no compass readings, calibration should time out.
  await h.advanceTime(3000);
  await starting;

  assert.equal(h.run('navigationActive'), false);
  assert.equal(h.element('startBtn').disabled, false);
});

test('Sensors to Auto drops queued motion and ignores stale sensor callbacks',async()=>{
  const h=harness();await startSensor(h);h.stable(450,800,0);h.injectSteps(800,[750]);const oldFrame=[...h.frames.values()][0];assert.equal(h.run('stepMovementQueue.length'),1);
  h.run("setNavigationMode('auto')");await h.run('startNavigation()');oldFrame(1000);h.run('handleDetectedStep(750)');assert.equal(h.run('stepMovementQueue.length'),0);near(travelled(h),0);assert.equal(h.frames.size,0);
});

test('successful route replacement stops old timers and invalidates calibration',async()=>{
  const h=harness();await h.run('startNavigation()');h.chooseRoute();assert.equal(h.timers.size,0);assert.equal(h.run('navigationActive'),false);
  assert.equal(h.run('progressIndex'),0);assert.equal(h.element('startBtn').disabled,false);await startSensor(h);h.chooseRoute();assert.equal(h.run('headingTracker.isCalibrated'),false);
});

test('building change drops queued motion and invalidates route and heading',async()=>{
  const h=harness();await startSensor(h);h.stable(450,800,0);h.injectSteps(800,[750]);h.element('building').value='rabin';await h.element('building').onchange();
  assert.equal(h.frames.size,0);assert.equal(h.run('stepMovementQueue.length'),0);assert.equal(h.run('routeNodes.length'),0);assert.equal(h.run('navigationActive'),false);assert.equal(h.run('headingTracker.isCalibrated'),false);
});

test('late sensor permission cannot restart navigation or overwrite another mode status',async()=>{
  let resolve;const permission=new Promise(r=>{resolve=r;});const h=harness(false,()=>permission);h.run("sensorsEnabled=false;setNavigationMode('sensor')");const waiting=h.run('startNavigation()');
  h.run("setNavigationMode('auto')");await h.run('startNavigation()');const status=h.element('status').textContent;resolve('granted');await waiting;
  assert.equal(h.run('navMode'),'auto');assert.equal(h.timers.size,1);assert.equal(h.element('status').textContent,status);
});

test('late permission after route replacement leaves the new route stopped',async()=>{
  let resolve;const permission=new Promise(r=>{resolve=r;});const h=harness(false,()=>permission);h.run("sensorsEnabled=false;setNavigationMode('sensor')");const waiting=h.run('startNavigation()');h.chooseRoute();
  const status=h.element('status').textContent;resolve('granted');await waiting;assert.equal(h.run('navigationActive'),false);assert.equal(h.frames.size,0);assert.equal(h.element('status').textContent,status);
});

test('denied permission leaves Start available without motion',async()=>{
  const h=harness(false,async()=>'denied');h.run("sensorsEnabled=false;setNavigationMode('sensor')");await h.run('startNavigation()');
  assert.equal(h.run('navigationActive'),false);assert.equal(h.element('startBtn').disabled,false);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});

test('background, screen rotation or reference change cancels movement for recalibration',async()=>{
  for(const reason of ['hidden','screen','reference','source']){
    const h=harness();await startSensor(h);h.stable(450,800,0);h.injectSteps(800,[750]);
    if(reason==='hidden'){h.document.hidden=true;h.listeners.get('visibilitychange')();}if(reason==='screen')h.listeners.get('orientationchange')();
    if(reason==='reference')h.orient(850,0,{absolute:true});if(reason==='source')h.orient(850,0,{webkitCompassHeading:0});
    assert.equal(h.run('navigationActive'),false,reason);assert.equal(h.frames.size,0);assert.equal(h.run('headingTracker.isCalibrated'),false);assert.equal(h.element('startBtn').disabled,false);near(travelled(h),0);
  }
});

test('temporary tilt pauses new steps and resumes forward or reverse without restarting navigation',async()=>{
  for(const bearing of [0,180]){
    const h=harness();await startSensor(h);h.stable(450,1200,0);h.injectSteps(1200,[750,1150]);h.drain();
    const before=travelled(h),count=h.run('detectedSteps');near(before,1.3);
    h.stable(2000,2400,bearing,{beta:80});
    assert.equal(h.run('headingTracker.isCalibrated'),true,'tilt must preserve the reference');
    assert.equal(h.run('navigationActive'),true,'temporary pause must not require Start');
   assert.equal(h.element('startBtn').disabled, true);
    assert.match(h.element('status').textContent,/paused/i);
    assert.match(h.element('status').textContent,/automatic/i);
    h.injectSteps(2400,[2150,2350]);h.drain();near(travelled(h),before);
    assert.equal(h.run('detectedSteps'),count+2,'raw step count must not reset');
    h.stable(2450,2850,bearing);
    assert.equal(h.run('navigationActive'),true);assert.equal(h.frames.size,0);
    assert.doesNotMatch(h.element('status').textContent,/paused/i);
    near(travelled(h),before,'uncertain steps are not replayed when heading recovers');
    h.injectSteps(2850,[2800]);h.drain();near(travelled(h),before+(bearing===0?0.65:-0.65));
    assert.equal(h.run('detectedSteps'),count+3);
  }
});

test('comfortable changes from the calibrated tilt still permit navigation',async()=>{
  const h=harness();await startSensor(h);h.stable(450,850,0,{beta:60,gamma:35});
  assert.equal(h.run('headingTracker.isCalibrated'),true);assert.equal(h.run('navigationActive'),true);
  h.injectSteps(850,[800]);h.drain();near(travelled(h),0.65);
});

test('missing heading recovers automatically and stale readings show a temporary pause',async()=>{
  const h=harness();await startSensor(h);h.stable(450,800,0);h.injectSteps(800,[750]);h.drain();
  const before=travelled(h);
  h.injectSteps(1800,[1750]);assert.match(h.element('status').textContent,/paused/i);near(travelled(h),before);
  h.orient(1850,0,{alpha:null});h.injectSteps(1900,[1875]);assert.equal(h.run('headingTracker.isCalibrated'),true);near(travelled(h),before);
  h.stable(1950,2350,0);assert.doesNotMatch(h.element('status').textContent,/paused/i);
  h.injectSteps(2350,[2300]);h.drain();near(travelled(h),before+0.65);
});

test('wheelchair mode starts without permissions, timers, animation frames or step counting',async()=>{
  let permissionCalls=0;
  const h=harness(false,async()=>{permissionCalls++;return 'granted';});
  h.run('sensorsEnabled=false');
  await startWheelchair(h);
  assert.equal(permissionCalls,0);
  assert.equal(h.timers.size,0);
  assert.equal(h.frames.size,0);
  assert.equal(h.run('detectedSteps'),0);
  assert.equal(h.element('wheelchairCard').hidden,false);
  assert.equal(h.element('wheelchairMapControls').hidden,false);
  assert.equal(h.element('wheelchairBackBtn').disabled,true);
  assert.equal(h.element('wheelchairNextBtn').disabled,false);
  assert.equal(h.element('wheelchairModeBtn').attributes['aria-pressed'],'true');
});

test('choosing wheelchair mode forces and locks a fresh accessible route',()=>{
  const h=harness();
  h.chooseRoute();
  assert.equal(h.run('dijkstraCalls'),1);
  assert.notEqual(h.element('accessibleRoute').checked,true);
  h.run("setNavigationMode('wheelchair')");
  assert.equal(h.element('accessibleRoute').checked,true);
  assert.equal(h.element('accessibleRoute').disabled,true);
  assert.equal(h.run('dijkstraCalls'),2,'the old route must be recalculated with stair exclusion');
  assert.deepEqual(Array.from(h.run('dijkstraAccessible')),[false,true]);
  h.run("setNavigationMode('auto')");
  assert.equal(h.element('accessibleRoute').disabled,false);
});

test('switching from Auto to wheelchair resets simulated progress to the route start',async()=>{
  const h=harness();
  await h.run('startNavigation()');
  const autoTick=[...h.timers.values()][0];
  for(let count=0;count<20;count++) autoTick();
  assert.ok(h.run('progressT')>0 || h.run('progressIndex')>0);
  h.element('accessibleRoute').checked=true;
  h.run("setNavigationMode('wheelchair')");
  assert.equal(h.run('progressIndex'),0);
  assert.equal(h.run('progressT'),0);
  assert.equal(h.run('navigationActive'),false);
  assert.match(h.element('status').textContent,/Start navigation/i);
});

test('wheelchair buttons skip corridor nodes, allow correction before arrival and finish with one confirmation', async () => {
  const h = harness();

  h.setRoute([
    {id:'start', label:'Start', floor:'floor500', x:0, y:0},
    {id:'noise', label:'Corridor', floor:'floor500', x:0.1, y:0},
    {id:'corner', label:'Corner', floor:'floor500', x:0.2, y:0},
    {id:'noise-2', label:'Corridor', floor:'floor500', x:0.2, y:0.1},
    {
      id:'end',
      label:'Accessible Restroom',
      type:'restroom',
      floor:'floor500',
      x:0.2,
      y:0.2
    }
  ]);

  await startWheelchair(h);

  // Skip the corridor node and reach the corner.
  h.element('wheelchairNextBtn').onclick();
  assert.equal(h.run('progressIndex'), 2);
  assert.equal(h.run('navigationActive'), true);
  assert.equal(h.element('wheelchairBackBtn').disabled, false);

  // Correction is available before confirming the destination.
  h.element('wheelchairBackBtn').onclick();
  assert.equal(h.run('progressIndex'), 0);
  assert.equal(h.element('wheelchairBackBtn').disabled, true);

  h.element('wheelchairNextBtn').onclick();
  assert.equal(h.run('progressIndex'), 2);
  assert.equal(h.element('wheelchairNextBtn').disabled, false);

  // One destination confirmation completes navigation.
  h.element('wheelchairNextBtn').onclick();
  assert.equal(h.run('progressIndex'), 4);
  assert.equal(h.run('progressT'), 0);
  assert.equal(h.run('navigationActive'), false);
  assert.match(h.element('instruction').textContent, /You have arrived/i);
  assert.match(h.element('subInstruction').textContent, /Accessible Restroom/);
  assert.equal(h.element('startBtn').disabled, true);
});

test('wheelchair turn instruction uses simplified checkpoints instead of noisy raw neighbors',async()=>{
  const h=harness();
  const points=[[0,0],[.004,0],[.008,.0004],[.0115,.0015],[.0145,.0035],[.0168,.0062],[.0184,.0095],[.0193,.0132],[.0197,.0172],[.0197,.0212]];
  h.setRoute(points.map(([x,y],index)=>({
    id:String(index),label:index===points.length-1?'Destination':'Corridor',
    type:index===points.length-1?'room':'corridor',floor:'floor500',x,y
  })));
  await startWheelchair(h);
  h.element('wheelchairNextBtn').onclick();
  assert.equal(h.run('progressIndex'),4);
  assert.match(h.element('instruction').textContent,/Turn (right|left)/);
});

test('Spatial guidance holds one instruction until the next meaningful turn',()=>{
  const h=harness();
  h.setRoute([
    {id:'s',label:'Start',type:'room',floor:'floor500',x:0,y:0},
    {id:'n1',label:'',type:'corridor',floor:'floor500',x:.01,y:0},
    {id:'turn',label:'',type:'corridor',floor:'floor500',x:.02,y:0},
    {id:'n3',label:'',type:'corridor',floor:'floor500',x:.02,y:.01},
    {id:'t',label:'Room',type:'room',floor:'floor500',x:.02,y:.02}
  ]);
  h.run("testProfile='spatial'; updateTurnInstruction()");
  assert.match(h.element('instruction').textContent,/Continue straight/);
  assert.match(h.element('subInstruction').textContent,/then turn (right|left)/);
});

test('Spatial elevator guidance names the final floor of an uninterrupted ride',()=>{
  const h=harness();
  h.setRoute([
    {id:'lift-500',label:'Lift',type:'elevator',connectorId:'L',floor:'floor500',x:0,y:0},
    {id:'lift-600',label:'Lift',type:'elevator',connectorId:'L',floor:'floor600',x:0,y:0},
    {id:'lift-700',label:'Lift',type:'elevator',connectorId:'L',floor:'floor700',x:0,y:0},
    {id:'t',label:'Room',type:'room',floor:'floor700',x:.02,y:0}
  ]);
  h.run("testProfile='spatial'; updateTurnInstruction()");
  assert.match(h.element('instruction').textContent,/floor700/);
  assert.doesNotMatch(h.element('instruction').textContent,/floor600/);
});

test('wheelchair floor confirmation stops at the lift and skips pass-through floors',async()=>{
  const h=harness();
  h.setRoute([
    {id:'start',label:'Start',floor:'floor500',x:0,y:0},
    {id:'lift-500',label:'Lift',type:'elevator',floor:'floor500',x:0.2,y:0,connectorId:'L'},
    {id:'lift-600',label:'Lift',type:'elevator',floor:'floor600',x:0.2,y:0,connectorId:'L'},
    {id:'lift-700',label:'Lift',type:'elevator',floor:'floor700',x:0.2,y:0,connectorId:'L'},
    {id:'end',label:'Room',type:'room',floor:'floor700',x:0.4,y:0}
  ]);
  await startWheelchair(h);
  h.element('wheelchairNextBtn').onclick();
  assert.equal(h.run('progressIndex'),1);
  assert.equal(h.run('activeFloor'),'floor500');
  assert.match(h.element('instruction').textContent,/Floor floor700/);
  h.element('wheelchairNextBtn').onclick();
  assert.equal(h.run('progressIndex'),3);
  assert.equal(h.run('activeFloor'),'floor700');
  h.element('wheelchairBackBtn').onclick();
  assert.equal(h.run('progressIndex'),1);
  assert.equal(h.run('activeFloor'),'floor500');
});

test('switching away from wheelchair mode hides controls and stale presses cannot move',async()=>{
  const h=harness();
  h.setRoute([
    {id:'start',label:'Start',floor:'floor500',x:0,y:0},
    {id:'end',label:'Room',type:'room',floor:'floor500',x:0.2,y:0}
  ]);
  await startWheelchair(h);
  const stalePress=h.element('wheelchairNextBtn').onclick;
  h.run("setNavigationMode('auto')");
  stalePress();
  assert.equal(h.run('progressIndex'),0);
  assert.equal(h.run('navigationActive'),false);
  assert.equal(h.element('wheelchairCard').hidden,true);
  assert.equal(h.element('wheelchairMapControls').hidden,true);
  assert.equal(h.element('autoModeBtn').attributes['aria-pressed'],'true');
});

test('diagnostic reset clears totals without registering listeners again',async()=>{
  const h=harness(true);await h.run('enableSensors()');const before=h.listeners.size;h.element('resetBtn').onclick();assert.equal(Number(h.element('steps').textContent),0);assert.equal(h.listeners.size,before);assert.equal(h.run('sensorsEnabled'),true);
});

function sharedRideHarness(mode = 'wheelchair'){
  const h = harness();

  h.setRoute([
    {
      id:'lift-start', label:'Elevator',
      type:'elevator', connectorId:'shared-lift',
      floor:'floor500', x:0, y:1
    },
    {
      id:'lift-middle', label:'Elevator',
      type:'elevator', connectorId:'shared-lift',
      floor:'floor600', x:0, y:1
    },
    {
      id:'lift-exit', label:'Elevator',
      type:'elevator', connectorId:'shared-lift',
      floor:'floor700', x:0, y:1
    },
    {
      id:'room', label:'Test room',
      type:'room', floor:'floor700', x:0, y:0
    }
  ]);

  h.element('accessibleRoute').checked = true;

  h.run(`
    BUILDING = 'rabin';

    sessionStorage.setItem('journeyStage', 'destination');
    sessionStorage.setItem(
      'indoorContext',
      JSON.stringify({destinationNodeId:'room'})
    );

    savePendingSharedElevatorRide({
      originBuilding:'madriga',
      destinationBuilding:'rabin',
      nextStage:'destination',
      mode:${JSON.stringify(mode)},
      entered:true,
      destinationContext:sessionStorage.getItem('indoorContext'),
      intermediateContext:null
    });

    // Simulate losing in-memory state during a page reload.
    pendingSharedElevatorRide = null;
  `);

  return h;
}

test('shared ride restores after reload and derives its exit from the route', ()=>{
  for(const mode of ['wheelchair', 'sensor']){
    const h = sharedRideHarness(mode);

    assert.equal(h.run('restorePendingSharedElevatorRide()'), true);

    assert.equal(h.run('navMode'), mode);
    assert.equal(h.run('navigationActive'), true);
    assert.equal(h.run('progressIndex'), 0);
    assert.equal(h.run('activeFloor'), 'floor500');

    assert.equal(
      h.run('pendingSharedElevatorRide.exitNodeId'),
      'lift-exit'
    );
    assert.equal(
      h.run('pendingSharedElevatorRide.exitFloor'),
      'floor700'
    );
    assert.equal(h.run('sensorElevatorRide.endIndex'), 2);

    assert.equal(h.element('startBtn').disabled, true);
    assert.match(h.element('instruction').textContent, /floor700/);

    const button = mode === 'wheelchair'
      ? h.element('wheelchairNextBtn')
      : h.element('sensorConfirmBtn');

    assert.equal(button.hidden, false);
    assert.match(button.textContent, /I exited.*floor700/);

    assert.equal(h.timers.size, 0);
    assert.equal(h.frames.size, 0);
  }
});

test('shared ride rejects stale saved state', ()=>{
  const mismatches = [
    {destinationBuilding:'main'},
    {mode:'auto'},
    {nextStage:'origin'},
    {destinationContext:'different destination'},
    {intermediateContext:'different transfer'}
  ];

  for(const mismatch of mismatches){
    const h = sharedRideHarness();

    h.run(`
      const savedRide = JSON.parse(
        sessionStorage.getItem(SHARED_ELEVATOR_STORAGE_KEY)
      );

      Object.assign(savedRide, ${JSON.stringify(mismatch)});

      sessionStorage.setItem(
        SHARED_ELEVATOR_STORAGE_KEY,
        JSON.stringify(savedRide)
      );
    `);

    assert.equal(h.run('restorePendingSharedElevatorRide()'), false);
    assert.equal(h.run('pendingSharedElevatorRide'), null);
    assert.equal(
      h.run('sessionStorage.getItem(SHARED_ELEVATOR_STORAGE_KEY)'),
      null
    );
    assert.equal(h.run('navigationActive'), false);
  }
});

test('shared ride rejects a non-elevator route start', ()=>{
  const h = sharedRideHarness();

  h.run(`
    routeNodes[0].type = 'corridor';
  `);

  assert.equal(h.run('restorePendingSharedElevatorRide()'), false);
  assert.equal(h.run('pendingSharedElevatorRide'), null);
  assert.equal(
    h.run('sessionStorage.getItem(SHARED_ELEVATOR_STORAGE_KEY)'),
    null
  );
  assert.equal(h.run('navigationActive'), false);
});

test('shared ride clears when the route or mode changes', ()=>{
  for(const action of ['route', 'mode']){
    const h = sharedRideHarness();

    assert.equal(
      h.run('restorePendingSharedElevatorRide()'),
      true
    );

    if(action === 'mode'){
      h.run("setNavigationMode('auto')");
    }else{
      h.element('fromFloor').value = 'floor500';
      h.element('toFloor').value = 'floor700';
      h.element('from').value = 'lift-start';
      h.element('to').value = 'room';

      h.run('route()');
    }

    assert.equal(h.run('pendingSharedElevatorRide'), null);
    assert.equal(h.run('sensorElevatorRide'), null);
    assert.equal(h.run('navigationActive'), false);

    assert.equal(
      h.run('sessionStorage.getItem(SHARED_ELEVATOR_STORAGE_KEY)'),
      null
    );

    assert.equal(h.element('sensorConfirmBtn').hidden, true);
    assert.equal(h.element('startBtn').disabled, false);
    assert.doesNotMatch(
      h.element('instruction').textContent,
      /Stay in the elevator/
    );
    assert.notEqual(
      h.element('eta').textContent,
      'Awaiting exit confirmation'
    );

    assert.equal(h.timers.size, 0);
    assert.equal(h.frames.size, 0);
  }
});

test('shared ride exit confirmation resumes at the exact route elevator', async ()=>{
  const h = sharedRideHarness('wheelchair');

  assert.equal(h.run('restorePendingSharedElevatorRide()'), true);

  await h.run('confirmSharedElevatorExit()');

  assert.equal(h.run('progressIndex'), 2);
  assert.equal(h.run('progressT'), 0);
  assert.equal(h.run('routeNodes[progressIndex].id'), 'lift-exit');
  assert.equal(h.run('activeFloor'), 'floor700');

  assert.equal(h.run('pendingSharedElevatorRide'), null);
  assert.equal(h.run('sensorElevatorRide'), null);
  assert.equal(
    h.run('sessionStorage.getItem(SHARED_ELEVATOR_STORAGE_KEY)'),
    null
  );

  assert.equal(h.run('navMode'), 'wheelchair');
  assert.equal(h.run('navigationActive'), true);
  assert.equal(h.element('sensorConfirmBtn').hidden, true);
  assert.equal(h.element('wheelchairNextBtn').disabled, false);

  assert.doesNotMatch(
    h.element('instruction').textContent,
    /Stay in the elevator/
  );

  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
});
test('auto mode rides straight to the final floor without showing pass-through floors',async()=>{
  const h=harness();
  h.setRoute([
    {id:'start',label:'Start',type:'room',floor:'floor500',x:0,y:0},
    {id:'lift-500',label:'Lift',type:'elevator',connectorId:'L',floor:'floor500',x:0.2,y:0},
    {id:'lift-600',label:'Lift',type:'elevator',connectorId:'L',floor:'floor600',x:0.2,y:0},
    {id:'lift-700',label:'Lift',type:'elevator',connectorId:'L',floor:'floor700',x:0.2,y:0},
    {id:'end',label:'Room',type:'room',floor:'floor700',x:0.4,y:0}
  ]);
  h.run("setNavigationMode('auto')");
  await h.run('startNavigation()');
  h.run('advanceAutoAlongRoute(1000)');
  assert.equal(h.run('progressIndex'),3);
  assert.equal(h.run('activeFloor'),'floor700');
  assert.match(h.element('instruction').textContent,/Take the elevator to Floor floor700/);
  assert.doesNotMatch(h.element('instruction').textContent,/floor600/);
});
