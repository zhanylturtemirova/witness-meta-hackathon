import {entryStatus} from './event-model.js';

// A small, explicit city gazetteer, not inferred GPS or a person's residence.
// Unrecognised or missing locations remain off the globe.
const CITIES=[['leeds',-1.55,53.80],['manchester',-2.24,53.48],['bristol',-2.59,51.45],['bishkek',74.60,42.87],['vienna',16.37,48.21],['berlin',13.4,52.52],['london',-.12,51.51],['lisbon',-9.14,38.72],['porto',-8.61,41.15],['paris',2.35,48.86],['gdansk',18.65,54.35],['cork',-8.47,51.9],['toronto',-79.38,43.65],['montreal',-73.57,45.5],['tbilisi',44.79,41.72],['tokyo',139.69,35.68],['osaka',135.5,34.69],['new york',-74.01,40.71]];
const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function eventCoordinates(location){
 const city=normal(location).split(',')[0].trim();
 const entry=CITIES.find(([name])=>name===city);
 return entry?{lon:entry[1],lat:entry[2]}:null;
}
export function eventEvidence(text){
 const keys=[];
 if(/\b(house[- ]building|small[- ]houses?|cottages?|residential|housing)\b/i.test(text))keys.push('small-houses');
 if(/\b(timber|mortar|labou?rer|building site|construction)\b/i.test(text))keys.push('site-work');
 if(/\b(learn(?:ed|ing)?|taught|showed|read a level|foreman)\b/i.test(text))keys.push('learning-trade');
 return keys;
}
export function connectEventsFor(projects){
 return projects.flatMap(p=>(p.events||[]).filter(e=>entryStatus(e,p.answers)==='Confirmed').map(e=>{
  const text=[e.title,e.summary,...(e.themes||[])].join(' '),keys=eventEvidence(text);
  const category=keys.length===3?'house-building':/\b(concert|band|live music)\b/i.test(text)?'first-concert':/\b(moved|moving|new country|abroad)\b/i.test(text)?'moving-abroad':null;
  return {id:`private:${p.id}:${e.id}`,projectId:p.id,title:e.title,place:e.location||'Location not set',year:e.dateText||'Date not set',excerpt:e.summary||'',category,evidenceKeys:keys,private:true,...eventCoordinates(e.location)};
 }));
}
