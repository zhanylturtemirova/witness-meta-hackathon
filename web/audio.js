export const MAX_SECONDS = 120;
export const TARGET_RATE = 24000;
export function toWav(chunks, inputRate, outputRate=TARGET_RATE) {
  if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>192000)throw new Error('Unsupported microphone sample rate.');
  const size=chunks.reduce((n,c)=>n+c.length,0);
  if(!size)throw new Error('No audio was captured. Please try again.');
  const samples=new Float32Array(size);let cursor=0;for(const c of chunks){samples.set(c,cursor);cursor+=c.length;}
  const count=Math.min(Math.floor(size*outputRate/inputRate),MAX_SECONDS*outputRate);
  if(!count)throw new Error('The recording is too short.');
  const wav=new ArrayBuffer(44+count*2),view=new DataView(wav);
  const text=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,outputRate,true);view.setUint32(28,outputRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){
    const position=i*inputRate/outputRate,at=Math.floor(position),fraction=position-at;
    const value=Math.max(-1,Math.min(1,samples[at]*(1-fraction)+(samples[Math.min(at+1,size-1)]||0)*fraction));
    view.setInt16(44+i*2,value<0?Math.round(value*32768):Math.round(value*32767),true);
  }
  return wav;
}
export function wavInfo(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<44)throw new Error('Choose a PCM WAV recording.');
  const v=new DataView(buffer),str=(at,n)=>String.fromCharCode(...new Uint8Array(buffer,at,n));
  if(str(0,4)!=='RIFF'||str(8,4)!=='WAVE')throw new Error('Choose a WAV file, not an MP3 or M4A.');
  if(v.getUint32(4,true)+8!==buffer.byteLength)throw new Error('The WAV file is incomplete.');
  let format=null,dataBytes=0;
  for(let at=12;at+8<=buffer.byteLength;){const name=str(at,4),len=v.getUint32(at+4,true);if(at+8+len>buffer.byteLength)throw new Error('The WAV file is incomplete.');
    if(name==='fmt '){if(len<16)throw new Error('Unsupported WAV format.');format={encoding:v.getUint16(at+8,true),channels:v.getUint16(at+10,true),rate:v.getUint32(at+12,true),byteRate:v.getUint32(at+16,true),block:v.getUint16(at+20,true),bits:v.getUint16(at+22,true)};}
    if(name==='data')dataBytes+=len;
    at+=8+len+(len%2);
  }
  if(!format||format.encoding!==1||format.channels!==1||format.bits!==16||![16000,24000].includes(format.rate)||format.byteRate!==format.rate*2||format.block!==2||!dataBytes||dataBytes%2)throw new Error('Use mono, 16-bit PCM WAV at 16 or 24 kHz.');
  const duration=dataBytes/(format.rate*2);if(duration>MAX_SECONDS)throw new Error('Please choose a recording under two minutes.');
  return {...format,duration};
}
