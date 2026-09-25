// Import from ego-browser nodejs after verifying the target is displayed in a normal native window.
// Acceptance instrumentation only; not shipped with the product. Never use screencast during samples.
import fs from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';

export async function measureInput(page, { selector, output, count = 30, context = {} }) {
  await page.focus(selector);
  await pause(2200);
  await page.evaluate((selector) => {
    window.__ompInputProbe?.dispose();
    const target = document.querySelector(selector);
    if (!target) throw Error('INPUT_TARGET_MISSING');
    const state = { samples: [], events: [], pending: 0, startedAt: performance.now() };
    const onInput = (event) => {
      const started = performance.now();
      const sample = { trusted: event.isTrusted, visible: document.visibilityState, focused: document.hasFocus(), length: target.value.length };
      state.pending++;
      requestAnimationFrame((first) => {
        sample.firstFrameMs = performance.now() - started;
        sample.firstRafTimestamp = first;
        requestAnimationFrame((second) => {
          sample.doubleFrameMs = performance.now() - started;
          sample.secondRafTimestamp = second;
          state.samples.push(sample); state.pending--;
        });
      });
    };
    target.addEventListener('input', onInput, true);
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'keydown') state.events.push({duration: e.duration, processing: e.processingEnd - e.processingStart, interactionId: e.interactionId});
    });
    observer.observe({type:'event', durationThreshold:16});
    state.dispose = () => { target.removeEventListener('input', onInput, true); observer.disconnect(); };
    window.__ompInputProbe = state;
  }, selector);
  for (let i = 0; i < count; i++) {
    await page.keyboard.type('a');
    await page.waitForFunction((n) => window.__ompInputProbe.samples.length >= n, i + 1, {timeout:6000});
  }
  const result = await page.evaluate(() => {
    const s = window.__ompInputProbe;
    s.dispose();
    return {samples:s.samples, events:s.events, elapsedMs:performance.now()-s.startedAt,
      visibility:document.visibilityState, focused:document.hasFocus(), width:innerWidth, height:innerHeight,
      devicePixelRatio, userAgent:navigator.userAgent};
  });
  const percentile = (values, q) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1] ?? null;
  const summary = {count:result.samples.length, firstFrameP95Ms:percentile(result.samples.map(s=>s.firstFrameMs),.95),
    doubleFrameP95Ms:percentile(result.samples.map(s=>s.doubleFrameMs),.95), eventTimingP95Ms:percentile(result.events.map(e=>e.duration),.95),
    processingP95Ms:percentile(result.events.map(e=>e.processing),.95),
    allTrustedVisibleFocused:result.samples.every(s=>s.trusted && s.visible==='visible' && s.focused)};
  await fs.writeFile(output,JSON.stringify({method:'Browser keyboard input to first and double requestAnimationFrame; no screenshots or screencast during samples; Event Timing >=16ms only',context,...summary,...result},null,2)+'\n',{flag:'wx'});
  return summary;
}
