/* Shared by indoor navigation and the sensor test page. Counts are estimates. */
(function(root){
  'use strict';

  const SETTINGS = Object.freeze({
    minStepGap: 350,
    maxStepGap: 2200,
    confirmationCount: 2,
    maxCycleTime: 1800,
    maxSampleGap: 500,
    warmupTime: 250,
    gravityTimeConstant: 500,
    filterTimeConstant: 45,
    orientationWindow: 500,
    orientationRange: 35,
    peak: 0.8,
    dip: -0.4,
    recovery: -0.1
  });

  class CampusStepDetector {
    constructor(){
      this.reset();
    }

    reset(){
      this.totalSteps = 0;
      this.candidates = 0;
      this.rejected = 0;
      this.pause();
    }

    // A new recording must not inherit a partial step or an old gravity estimate.
    pause(){
      this.gravity = null;
      this.filteredAccel = 0;
      this.lastSampleTime = null;
      this.warmupUntil = null;
      this.valid = false;
      this.orientationSamples = [];
      this.clearSequence();
    }

    clearCycle(){
      this.phase = 'idle';
      this.cycleStarted = null;
    }

    clearSequence(){
      this.clearRhythm();
      this.clearCycle();
    }

    clearRhythm(){
      this.isWalking = false;
      this.pendingCandidates = 0;
      this.pendingTimes = [];
      this.lastCandidateTime = null;
    }

    snapshot(stepsAdded = 0, stepTimes = []){
      return {
        stepsAdded,
        stepTimes: stepTimes.slice(),
        totalSteps: this.totalSteps,
        candidates: this.candidates,
        rejected: this.rejected,
        isWalking: this.isWalking,
        filteredAccel: this.filteredAccel,
        valid: this.valid
      };
    }

    updateOrientation(event, now = performance.now()){
      if(!Number.isFinite(now) || !Number.isFinite(event?.beta) ||
         !Number.isFinite(event?.gamma)) return;
      this.orientationSamples = this.orientationSamples.filter(sample =>
        sample.time <= now && now - sample.time <= SETTINGS.orientationWindow);
      this.orientationSamples.push({time: now, beta: event.beta, gamma: event.gamma});
    }

    orientationIsStable(now){
      // Orientation can stop emitting while motion continues; expire old samples.
      this.orientationSamples = this.orientationSamples.filter(sample =>
        sample.time <= now && now - sample.time <= SETTINGS.orientationWindow);
      if(this.orientationSamples.length < 3) return true;
      return ['beta', 'gamma'].every(axis => {
        const values = this.orientationSamples.map(sample => sample[axis]);
        return Math.max(...values) - Math.min(...values) < SETTINGS.orientationRange;
      });
    }

    confirmCandidate(now, stepTime){
      this.candidates++;
      if(!this.orientationIsStable(now)){
        this.rejected++;
        this.clearSequence();
        return [];
      }

      if(this.lastCandidateTime !== null){
        const gap = now - this.lastCandidateTime;
        if(gap < SETTINGS.minStepGap){
          this.rejected++;
          return [];
        }
        if(gap > SETTINGS.maxStepGap) this.clearSequence();
      }
      this.lastCandidateTime = now;
      if(this.isWalking){
        this.totalSteps++;
        return [stepTime];
      }

      this.pendingCandidates++;
      this.pendingTimes.push(stepTime);
      if(this.pendingCandidates < SETTINGS.confirmationCount) return [];
      this.isWalking = true;
      const count = this.pendingCandidates;
      const times = this.pendingTimes.slice();
      this.pendingCandidates = 0;
      this.pendingTimes = [];
      this.totalSteps += count;
      return times;
    }

    updateMotion(event, now = performance.now()){
      const acceleration = event?.accelerationIncludingGravity;
      // Gravity-free vector magnitude has no sign; it cannot replace the signed
      // peak/dip signal. Missing axes are unavailable data, never zero motion.
      if(!Number.isFinite(now) || !acceleration ||
         !['x', 'y', 'z'].every(axis => Number.isFinite(acceleration[axis]))){
        this.pause();
        return this.snapshot();
      }

      const magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
      if(!Number.isFinite(magnitude)){
        this.pause();
        return this.snapshot();
      }

      if(this.lastSampleTime !== null &&
         (now <= this.lastSampleTime || now - this.lastSampleTime > SETTINGS.maxSampleGap)){
        this.pause();
      }
      this.valid = true;

      if(this.lastSampleTime === null){
        this.gravity = magnitude;
        this.lastSampleTime = now;
        this.warmupUntil = now + SETTINGS.warmupTime;
        return this.snapshot();
      }

      const elapsed = now - this.lastSampleTime;
      this.lastSampleTime = now;
      // Time-based filters behave consistently at different event frequencies.
      const gravityWeight = 1 - Math.exp(-elapsed / SETTINGS.gravityTimeConstant);
      const filterWeight = 1 - Math.exp(-elapsed / SETTINGS.filterTimeConstant);
      this.gravity += gravityWeight * (magnitude - this.gravity);
      const linear = magnitude - this.gravity;
      this.filteredAccel += filterWeight * (linear - this.filteredAccel);

      // Expire evidence BEFORE processing the next possible step.
      if(this.lastCandidateTime !== null && now - this.lastCandidateTime > SETTINGS.maxStepGap){
        // A new step may already be in progress when the previous rhythm expires.
        // Its own cycle deadline decides whether that evidence is still valid.
        this.clearRhythm();
      }
      if(this.cycleStarted !== null && now - this.cycleStarted > SETTINGS.maxCycleTime){
        this.rejected++;
        this.clearCycle();
      }
      if(now < this.warmupUntil) return this.snapshot();

      if(this.phase === 'idle' && this.filteredAccel > SETTINGS.peak){
        this.phase = 'peak';
        this.cycleStarted = now;
      }else if(this.phase === 'peak' && this.filteredAccel < SETTINGS.dip){
        this.phase = 'dip';
      }else if(this.phase === 'dip' && this.filteredAccel > SETTINGS.recovery){
        const stepTime = this.cycleStarted;
        this.clearCycle();
        const times = this.confirmCandidate(now, stepTime);
        return this.snapshot(times.length, times);
      }
      return this.snapshot();
    }
  }

  if(typeof module !== 'undefined' && module.exports) module.exports = CampusStepDetector;
  root.CampusStepDetector = CampusStepDetector;
})(typeof globalThis !== 'undefined' ? globalThis : window);
