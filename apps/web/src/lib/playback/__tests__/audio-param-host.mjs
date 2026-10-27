// Host-only Web Audio model. The production engine/effect code schedules all events.
// Values are sampled from the scheduled piecewise-linear timeline, not real output.
export function audioParamHost(t) {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const nodes=[],disconnects=[];
  const ctx={state:'running',get currentTime(){return 10+Date.now()/1000;}};
  function param(initial=1) {
    let base=initial, events=[];
    const valueAt=time=>{
      let previous={time:0,value:base};
      for(const event of events) {
        if(time<event.time) {
          if(event.kind==='ramp') return previous.value+(event.value-previous.value)*(time-previous.time)/(event.time-previous.time);
          return previous.value;
        }
        previous=event;
      }
      return previous.value;
    };
    const push=(kind,value,time)=>{events.push({kind,value,time});events.sort((a,b)=>a.time-b.time);};
    return {
      get value(){return valueAt(ctx.currentTime);},set value(v){base=v;},
      get events(){return events;},valueAt,
      setValueAtTime:(value,time)=>push('step',value,time),
      linearRampToValueAtTime:(value,time)=>push('ramp',value,time),
      cancelScheduledValues:time=>{events=events.filter(e=>e.time<time);},
      cancelAndHoldAtTime(time){const value=valueAt(time),next=events.find(e=>e.time>time);
        events=events.filter(e=>e.time<time);push(next?.kind==='ramp'?'ramp':'step',value,time);},
    };
  }
  const node=(kind='gain')=>{
    const n={kind,context:ctx,connections:new Set(),gain:param(),frequency:param(),Q:param(),pan:param(),
      threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),
      connect(target){n.connections.add(target);return target;},
      disconnect(...args){
        disconnects.push({node:n,target:args[0],time:ctx.currentTime});
        if(!args.length || args[0]==null || typeof args[0]==='number')n.connections.clear();
        else n.connections.delete(args[0]);
      }};
    nodes.push(n);return n;
  };
  Object.assign(ctx,{createGain:()=>node(),createAnalyser:()=>node('analyser'),
    createStereoPanner:()=>node('panner'),createBiquadFilter:()=>node('filter'),
    createDynamicsCompressor:()=>node('compressor'),destination:node('destination')});
  return {ctx,nodes,node,disconnects};
}
