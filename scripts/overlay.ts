/** On-screen cursor, key presses, captions, title cards and a terminal panel, injected only while recording. */
export const OVERLAY = `(() => {
  if (window.__overlay) return; window.__overlay = true;
  const boot = () => {
  const css = document.createElement('style');
  css.textContent = \`
    #__cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px #0008)}
    .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #c8adf2;animation:__rip .5s ease-out forwards}
    @keyframes __rip{to{transform:scale(3.2);opacity:0}}
    #__keys{position:fixed;left:236px;bottom:18px;z-index:2147483646;display:flex;gap:6px;pointer-events:none}
    .__key{font:600 14px ui-monospace,Menlo,monospace;color:#1b1a18;background:#f4f1ea;border-radius:8px;padding:5px 10px;box-shadow:0 2px 0 #b9b2a6,0 6px 16px #0006;animation:__k 1.1s ease-out forwards}
    @keyframes __k{0%{transform:translateY(6px);opacity:0}12%{transform:none;opacity:1}80%{opacity:1}100%{opacity:0}}
    #__cap{position:fixed;left:50%;top:9px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;display:flex;gap:12px;align-items:baseline;max-width:1000px;padding:8px 18px;border-radius:12px;background:#12110fe6;color:#eee8de;font:500 15px "Schibsted Grotesk",system-ui,sans-serif;box-shadow:0 10px 40px #000a,inset 0 0 0 .5px #ffeed82e;backdrop-filter:blur(14px);opacity:0;transition:opacity .35s}
    #__cap.on{opacity:1} #__cap b{font:500 12px ui-monospace,Menlo,monospace;color:#f2a85c;letter-spacing:.04em} #__cap span{color:#b9b2a6;font-size:13px}
    #__title{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#12110f;color:#eee8de;text-align:center;font-family:"Schibsted Grotesk",system-ui,sans-serif;transition:opacity .8s}
    #__title h1{font-size:54px;letter-spacing:-.03em;margin:0 0 10px;font-weight:650} #__title p{font:400 16px ui-monospace,Menlo,monospace;color:#918a7e;margin:0}
    #__title i{display:block;width:54px;height:54px;border-radius:15px;margin:0 auto 24px;background:linear-gradient(100deg,#a993f5,#d39be8 38%,#f2a9cf 70%,#f6b98f)}
    #__term{position:fixed;right:24px;bottom:24px;width:560px;max-height:340px;z-index:2147483645;pointer-events:none;border-radius:12px;background:#0d0c0bf2;color:#d8d2c6;font:12.5px/1.5 ui-monospace,Menlo,monospace;box-shadow:0 20px 60px #000c,inset 0 0 0 .5px #ffeed82e;opacity:0;transform:translateY(12px);transition:all .4s;overflow:hidden}
    #__term.on{opacity:1;transform:none} #__term header{padding:8px 14px;background:#1a1815;color:#918a7e;font-size:11px;display:flex;gap:6px;align-items:center}
    #__term header i{width:9px;height:9px;border-radius:50%;background:#3a3631} #__term pre{margin:0;padding:12px 14px;white-space:pre-wrap;word-break:break-word;max-height:290px;overflow:hidden}
    #__term .p{color:#c8adf2} #__term .t{color:#6fe0a0} #__term .d{color:#918a7e}
  \`;
  document.documentElement.appendChild(css);
  const cur = document.createElement('div'); cur.id='__cur';
  cur.innerHTML='<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 7.5-6 1.6-2.6 5.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const keys = document.createElement('div'); keys.id='__keys';
  const cap = document.createElement('div'); cap.id='__cap';
  const term = document.createElement('div'); term.id='__term'; term.innerHTML='<header><i></i><i></i><i></i>&nbsp; terminal · claude code</header><pre></pre>';
  document.body.append(cur, keys, cap, term);
  addEventListener('mousemove', e => { cur.style.transform = 'translate('+e.clientX+'px,'+e.clientY+'px)'; }, true);
  addEventListener('mousedown', e => { const r=document.createElement('div'); r.className='__rip'; r.style.left=e.clientX+'px'; r.style.top=e.clientY+'px'; document.body.appendChild(r); setTimeout(()=>r.remove(),600); }, true);
  const names = {' ':'Space','Meta':'⌘','Enter':'↵','Escape':'Esc','ArrowDown':'↓','ArrowUp':'↑','Shift':'⇧','Control':'Ctrl','Alt':'⌥'};
  addEventListener('keydown', e => { if (e.repeat) return; const k=document.createElement('div'); k.className='__key'; k.textContent=names[e.key]||e.key; keys.appendChild(k); setTimeout(()=>k.remove(),1150); if (keys.children.length>4) keys.firstChild.remove(); }, true);
  window.__cap = (time, text, sub) => { cap.innerHTML = '<b>'+time+'</b>'+text+(sub?'<span>'+sub+'</span>':''); cap.classList.add('on'); };
  window.__capOff = () => cap.classList.remove('on');
  window.__title = (h, p) => { let t=document.getElementById('__title'); if(!t){t=document.createElement('div'); t.id='__title'; document.body.appendChild(t);} t.style.opacity=1; t.innerHTML='<div><i></i><h1>'+h+'</h1><p>'+p+'</p></div>'; };
  window.__titleOff = () => { const t=document.getElementById('__title'); if(t){t.style.opacity=0; setTimeout(()=>t.remove(),900);} };
  window.__term = (html, show=true) => { term.querySelector('pre').innerHTML = html; term.classList.toggle('on', show); };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

