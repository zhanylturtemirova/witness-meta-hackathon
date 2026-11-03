import {mediaLoad,MEDIA_RECORDINGS} from './media-store.js';
import {applyListenMode,loadListenMode,saveListenMode} from './telephone.js';
const listenStorage=()=>{try{return window.localStorage;}catch{return undefined;}};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmtDur = s => typeof s !== 'number' || !(s >= 0) ? '' : ` · ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let urls = [];
export function unmountStoryAudio() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
}
export function storyAudioMarkup(p) {
  const list = p.recordings || [];
  if (!list.length) return '';
  return `<section class="story-audio" aria-label="Original recordings"><h2>Original recordings</h2><p>Your voice, as recorded. Transcripts and edits never replace these.</p><div class="listen-mode" role="radiogroup" aria-label="Listen as"><span>Listen as:</span><label><input type="radio" name="story-listen" value="natural"> Natural</label><label><input type="radio" name="story-listen" value="telephone"> Telephone</label></div><p class="muted">Telephone changes playback here only; originals stay untouched.</p>${list.map((r, i) => `<figure class="story-recording"><figcaption>Recording ${i + 1} · ${esc(r.question.slice(0, 90))}${fmtDur(r.durationSec)}</figcaption><audio controls preload="none" data-story-recording="${r.id}" aria-label="Original recording ${i + 1}"></audio><p class="muted" data-story-recording-note="${r.id}" hidden></p></figure>`).join('')}</section>`;
}
export async function mountStoryAudio(p) {
  unmountStoryAudio();
  const token = urls;
  for (const r of p.recordings || []) {
    if (token !== urls) return;
    const player = document.querySelector(`audio[data-story-recording="${r.id}"]`);
    if (!player) continue;
    let record = null;
    try { record = await mediaLoad(MEDIA_RECORDINGS, r.id); } catch {}
    if (token !== urls) return;
    if (record?.blob) {
      const url = URL.createObjectURL(record.blob);
      urls.push(url);
      player.src = url;
    } else {
      const note = document.querySelector(`[data-story-recording-note="${r.id}"]`);
      if (note) { note.textContent = 'This recording is unavailable in this browser.'; note.hidden = false; }
    }
  }
  const players = [...document.querySelectorAll('audio[data-story-recording]')];
  const radios = [...document.querySelectorAll('input[name="story-listen"]')];
  const mode = loadListenMode(listenStorage());
  for (const radio of radios) {
    radio.checked = radio.value === mode;
    radio.onchange = () => {
      saveListenMode(listenStorage(), document.querySelector('input[name="story-listen"]:checked')?.value);
      const effective = applyListenMode(players, listenStorage());
      for (const other of radios) other.checked = other.value === (effective === 'telephone' ? 'telephone' : 'natural');
    };
  }
  applyListenMode(players, listenStorage());
}
