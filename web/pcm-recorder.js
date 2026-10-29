class WitnessRecorder extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(2048);this.offset=0;this.active=true;this.port.onmessage=e=>{if(e.data==='stop'){this.flush();this.active=false;this.port.postMessage({stopped:true});}};}
  flush(){if(this.offset){const data=this.samples.slice(0,this.offset);this.port.postMessage(data,[data.buffer]);this.offset=0;}}
  process(inputs){if(!this.active)return false;const input=inputs[0]?.[0];if(input){for(const sample of input){this.samples[this.offset++]=sample;if(this.offset===this.samples.length)this.flush();}}return true;}
}
registerProcessor('witness-recorder',WitnessRecorder);
