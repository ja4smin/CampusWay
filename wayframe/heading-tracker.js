/* Phone orientation estimates, calibrated to the current map. Not a position sensor. */
(function(root){
  'use strict';

  const SETTINGS = Object.freeze({
    historyTime: 10000,
    maxSamples: 1500,
    maxAge: 350,
    maxSampleGap: 150,
    calibrationTime: 300,
    calibrationSpread: 15,
    stableTime: 250,
    stableSpread: 20,
    directionTolerance: 45
  });

  const normalize = angle => ((angle % 360) + 360) % 360;
  const difference = (a, b) => ((a - b + 540) % 360) - 180;
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

  class CampusHeadingTracker {
    constructor(){ this.reset(); }

    get isCalibrated(){ return this._calibration !== null; }

    reset(){
      this._samples = [];
      this._reference = null;
      this._screenAngle = null;
      this._lastTime = null;
      this.invalidate();
    }

    invalidate(){ this._calibration = null; }

    update(event, now = performance.now(), screenAngle = 0){
      if(!Number.isFinite(now) || (this._lastTime !== null && now <= this._lastTime)) return false;
      this._lastTime = now;

      const angle = Number.isFinite(screenAngle) ? normalize(screenAngle) : null;
      const absolute = event?.absolute === true ? 'absolute' : event?.absolute === false ? 'relative' : 'unknown';
      let heading = null;
      let reference = null;
      if(Number.isFinite(event?.webkitCompassHeading)){
        reference = 'webkit:' + absolute;
        // Safari uses a negative heading/accuracy to report an unusable compass.
        // Do not turn those sentinels into a real bearing or silently use alpha.
        const accuracy = event.webkitCompassAccuracy;
        if(event.webkitCompassHeading >= 0 && event.webkitCompassHeading <= 360 &&
           (accuracy == null || (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= SETTINGS.directionTolerance))){
          heading = normalize(event.webkitCompassHeading);
        }
      } else if(Number.isFinite(event?.alpha)){
        reference = 'alpha:' + absolute;
        if(event.alpha >= 0 && event.alpha <= 360) heading = normalize(360 - event.alpha);
      }

      if((this._screenAngle !== null && angle !== this._screenAngle) ||
         (reference !== null && this._reference !== null && reference !== this._reference)){
        this.invalidate();
        this._samples = [];
      }
      this._screenAngle = angle;
      if(reference !== null) this._reference = reference;

      const beta = event?.beta;
      const gamma = event?.gamma;
      let reason = null;
      if(angle === null || (angle !== 0 && angle !== 180)) reason = 'portrait-required';
      else if(heading === null || !Number.isFinite(beta) || !Number.isFinite(gamma)) reason = 'missing-heading';
      else if(beta < 0 || beta > 70 || Math.abs(gamma) > 45) reason = 'posture-changed';

      // A temporary grip or reading problem pauses classification, not calibration.
      // Keep the original map offset; a fresh stable suffix must follow this barrier
      // before movement can resume. Reference/screen changes still invalidate above.
      this._samples.push({ time: now, heading, beta, gamma, reason });
      this._samples = this._samples.filter(sample => now - sample.time <= SETTINGS.historyTime);
      if(this._samples.length > SETTINGS.maxSamples) this._samples.splice(0, this._samples.length - SETTINGS.maxSamples);
      return reason === null;
    }

    // A suffix ends at the latest reading BEFORE the step, never at a later batch time.
    _stableReading(now, duration, maxSpread){
      if(!Number.isFinite(now)) return { reason: 'missing-heading' };
      let end = this._samples.length - 1;
      while(end >= 0 && this._samples[end].time > now) end--;
      if(end < 0) return { reason: 'missing-heading' };
      const latest = this._samples[end];
      if(now - latest.time > SETTINGS.maxAge) return { reason: 'stale-heading' };
      if(latest.reason) return { reason: latest.reason };

      const samples = [];
      for(let index = end; index >= 0; index--){
        const sample = this._samples[index];
        if(sample.reason) return { reason: sample.reason };
        if(samples.length && samples[samples.length - 1].time - sample.time > SETTINGS.maxSampleGap){
          return { reason: 'interrupted-heading' };
        }
        samples.push(sample);
        const offsets = samples.map(value => difference(value.heading, latest.heading));
        if(Math.max(...offsets) - Math.min(...offsets) > maxSpread) return { reason: 'unstable-heading' };
        if(latest.time - sample.time >= duration){
          return {
            reason: null,
            heading: normalize(latest.heading + average(offsets)),
            beta: average(samples.map(value => value.beta)),
            gamma: average(samples.map(value => value.gamma))
          };
        }
      }
      return { reason: 'insufficient-history' };
    }

    calibrate(routeBearing, now = performance.now()){
      this.invalidate();
      if(!Number.isFinite(routeBearing)) return false;
      const reading = this._stableReading(now, SETTINGS.calibrationTime, SETTINGS.calibrationSpread);
      if(reading.reason) return false;
      this._calibration = {
        time: now,
        offset: normalize(routeBearing - reading.heading),
        beta: reading.beta,
        gamma: reading.gamma
      };
      return true;
    }

    _mappedReading(now){
      if(!this._calibration || !Number.isFinite(now) || now < this._calibration.time){
        return { reason: 'not-calibrated', bearing: null };
      }
      const reading = this._stableReading(now, SETTINGS.stableTime, SETTINGS.stableSpread);
      return reading.reason ? { reason: reading.reason, bearing: null } : {
        reason: null,
        bearing: normalize(reading.heading + this._calibration.offset)
      };
    }

    mapHeading(now = performance.now()){
      return this._mappedReading(now).bearing;
    }

    classify(stepTime, candidates){
      const reading = this._mappedReading(stepTime);
      if(reading.reason) return { direction: 0, ...reading };
      const directions = new Set();
      for(const candidate of Array.isArray(candidates) ? candidates : []){
        if((candidate?.direction === 1 || candidate?.direction === -1) && Number.isFinite(candidate.bearing) &&
           Math.abs(difference(reading.bearing, normalize(candidate.bearing))) <= SETTINGS.directionTolerance){
          directions.add(candidate.direction);
        }
      }
      if(directions.size !== 1){
        return { direction: 0, reason: directions.size ? 'ambiguous-direction' : 'off-route-heading', bearing: reading.bearing };
      }
      return { direction: directions.values().next().value, reason: 'matched', bearing: reading.bearing };
    }
  }

  if(typeof module !== 'undefined' && module.exports) module.exports = CampusHeadingTracker;
  root.CampusHeadingTracker = CampusHeadingTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
