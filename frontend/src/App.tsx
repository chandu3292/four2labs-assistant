import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Mic, PhoneOff, Send, Trash2, ArrowLeft, Upload, ArrowRight, Globe, Bot, LineChart, Workflow } from 'lucide-react';
import { Room, createLocalAudioTrack, RoomEvent, Track } from 'livekit-client';
import './index.css';

interface Persona { id: string; name: string; language: string; description: string; }
interface Caption { id: string; role: 'you' | 'agent'; text: string; final: boolean; }

const CHIPS = ['Websites & Apps', 'AI assistants', 'Dashboards', 'Automation', 'Book a consultation'];
const SUGGESTIONS = ['What does four2labs do?', 'Can you build an AI receptionist for me?', 'How does your process work?', 'Book me a consultation'];

// Curated, rotating teaser lines shown when a chip is clicked (does NOT start the call)
const TEASERS: Record<string, string[]> = {
  'Websites & Apps': [
    'Want a website or app? Tell me what you’re imagining. Tap the orb and let’s talk it through.',
    'We build fast, beautiful sites and apps. Start a call and describe your idea, and I’ll take it from there.',
    'Thinking about a new website? Tap to talk and I’ll walk you through how we’d build it for you.',
  ],
  'AI assistants': [
    'Want an AI assistant like me for your business? Tap to talk and I’ll explain how it would work.',
    'I can answer calls, book appointments and more. Imagine that for your business. Tap the orb to chat.',
    'Curious how an AI assistant could help you? Start a call and I’ll show you what’s possible.',
  ],
  'Dashboards': [
    'Want your sales and customers at a glance? Let’s chat about a dashboard. Tap the orb.',
    'I can turn your numbers into clear daily decisions. Tap to talk and I’ll explain how.',
    'A dashboard that actually makes sense? Start a call and tell me what you’d want to see.',
  ],
  'Automation': [
    'Tired of repetitive work? Tap to talk and I’ll show you what we can automate for you.',
    'Let’s take the boring tasks off your plate. Start a call and I’ll find what to automate.',
    'Automation can save you hours every week. Tap the orb and let’s find yours.',
  ],
  'Book a consultation': [
    'Want to book a free consultation? I can do that. Tap the orb and tell me a day that works.',
    'Let’s get you on the calendar! Start a call and I’ll find a slot that suits you.',
    'Happy to book your consultation. Tap to talk and we’ll sort out the time together.',
  ],
};

const EXAMPLES = [
  { tag: 'Live', tone: 'teal', title: 'AI receptionist', body: 'Answers calls 24/7 and never misses a customer, exactly like the assistant you just spoke to.' },
  { tag: '+18%', tone: 'blue', title: 'Sales dashboard', body: 'Today’s orders, customers and operations at a glance, with raw numbers turned into decisions.' },
  { tag: 'Done', tone: 'purple', title: 'New website', body: 'Beautiful, fast and mobile-ready, plus the systems behind it that do the heavy lifting.' },
  { tag: 'Auto', tone: 'teal', title: 'Marketing on autopilot', body: 'AI handles your posts and follow-ups so growth keeps happening in the background.' },
];
const SERVICES = [
  { Icon: Globe, title: 'Websites & Apps' },
  { Icon: Bot, title: 'AI for your business' },
  { Icon: LineChart, title: 'CRM & Dashboards' },
  { Icon: Workflow, title: 'Automation & Care' },
];
const PROCESS = [
  { n: '01', t: 'We listen', d: 'A relaxed chat about your business and what’s slowing you down.' },
  { n: '02', t: 'We plan', d: 'A clear, jargon-free plan of what we build and what it does for you.' },
  { n: '03', t: 'We build', d: 'Our team designs and ships it, sharing progress so there are no surprises.' },
  { n: '04', t: 'We support', d: 'We launch, train your team, and keep everything running smoothly.' },
];

const App: React.FC = () => {
  const [view, setView] = useState<'call' | 'chat'>('call');

  const [chatMessages, setChatMessages] = useState<Array<{ role: string; text: string; time?: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState('sophia');

  const [status, setStatus] = useState('Listening…');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [timer, setTimer] = useState(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [bubble, setBubble] = useState<{ topic: string; text: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPhrase = useRef<Record<string, number>>({});
  const roomRef = useRef<Room | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => { fetchPersonas(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, isSending]);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    if (isConnected) id = setInterval(() => setTimer(t => t + 1), 1000); else setTimer(0);
    return () => { if (id) clearInterval(id); };
  }, [isConnected]);

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const fetchPersonas = async () => {
    try { const r = await fetch('/api/personas'); const d = await r.json(); setPersonas(d.personas || []); setSelectedPersona(d.active_persona_id || 'sophia'); }
    catch (e) { console.error(e); }
  };
  const handlePersonaChange = async (id: string) => {
    setSelectedPersona(id);
    try { await fetch('/api/set-persona', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona_id: id }) }); } catch (e) { console.error(e); }
  };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsUploading(true); setFileName(`Reading ${file.name}…`);
    const fd = new FormData(); fd.append('file', file);
    try { const r = await fetch('/upload', { method: 'POST', body: fd }); const d = await r.json(); setFileName(d.status === 'success' ? `Added · ${file.name}` : `Error`); }
    catch (err) { console.error(err); setFileName('Upload failed'); } finally { setIsUploading(false); }
  };
  const sendMessage = async (preset?: string) => {
    const message = (preset ?? chatInput).trim(); if (!message || isSending) return;
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatInput(''); setChatMessages(p => [...p, { role: 'user', text: message, time: t }]); setIsSending(true);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, session_id: sessionId }) });
      const d = await r.json();
      const rt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setChatMessages(p => [...p, { role: 'assistant', text: d.status === 'success' ? d.response : `Error: ${d.message}`, time: rt }]);
    } catch (err) { console.error(err); setChatMessages(p => [...p, { role: 'assistant', text: 'Something went wrong. Please try again.', time: '' }]); }
    finally { setIsSending(false); inputRef.current?.focus(); }
  };
  const clearChat = async () => {
    setChatMessages([]);
    try { await fetch('/api/chat/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) }); } catch (e) { console.error(e); }
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  // ---- interactive chips: show a rotating teaser line (does NOT start the call) ----
  const teaseTopic = (topic: string) => {
    if (isConnected || isConnecting) return;
    const pool = TEASERS[topic]; if (!pool || !pool.length) return;
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === lastPhrase.current[topic]) idx = (idx + 1) % pool.length;
    lastPhrase.current[topic] = idx;
    setBubble({ topic, text: pool[idx] });
    setSpeaking(true);
    if (speakTimer.current) clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => setSpeaking(false), 1500);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 9000);
  };

  // ---- audio-reactive level: drive --level CSS var from the agent's voice ----
  const startReactive = (track: MediaStreamTrack) => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
        const level = Math.min(1, (sum / data.length) / 90);
        if (orbRef.current) orbRef.current.style.setProperty('--level', level.toFixed(3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { console.error('reactive audio failed', e); }
  };
  const stopReactive = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (orbRef.current) orbRef.current.style.setProperty('--level', '0');
    audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null;
  };

  const startConversation = async () => {
    if (isConnecting || isConnected) return;
    if (roomRef.current) { await roomRef.current.disconnect(); roomRef.current = null; }
    setIsConnecting(true); setStatus('Connecting…'); setCaptions([]); setBubble(null);
    try {
      const res = await fetch(`/token?persona=${selectedPersona}`);
      const { token, url } = await res.json();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const audio = track.attach(); audio.volume = 1.0; audio.setAttribute('autoplay', 'true'); document.body.appendChild(audio);
          const mst = (track as any).mediaStreamTrack as MediaStreamTrack | undefined;
          if (mst) startReactive(mst);
        }
      });
      room.on(RoomEvent.TranscriptionReceived, (segments: any[], participant: any) => {
        const isAgent = participant?.identity !== 'web-user';
        setCaptions(prev => {
          const next = [...prev];
          for (const s of segments) {
            const role: 'you' | 'agent' = isAgent ? 'agent' : 'you';
            const idx = next.findIndex(c => c.id === s.id);
            if (idx >= 0) next[idx] = { id: s.id, role, text: s.text, final: s.final };
            else next.push({ id: s.id, role, text: s.text, final: s.final });
          }
          return next.slice(-6);
        });
      });
      room.on(RoomEvent.Disconnected, () => { setIsConnected(false); setStatus('Listening…'); roomRef.current = null; stopReactive(); });
      await room.connect(url, token);
      roomRef.current = room; setIsConnected(true); setStatus('Listening…');
      const mic = await createLocalAudioTrack(); await room.localParticipant.publishTrack(mic);
    } catch (err) { console.error(err); setStatus('Connection failed,tap to retry'); }
    finally { setIsConnecting(false); }
  };
  const disconnectRoom = async () => {
    if (roomRef.current) await roomRef.current.disconnect();
    setIsConnected(false); setStatus('Listening…'); roomRef.current = null; stopReactive();
  };
  const orbAction = isConnected ? disconnectRoom : startConversation;
  const liveCaptions = captions.filter(c => c.text.trim());

  return (
    <div className="page">
      <div className="aura" aria-hidden />
      <div className="mesh" aria-hidden />
      <div className="vignette" aria-hidden />

      {/* ============ CALL HERO ============ */}
      <div className="stage">
        <header className="top">
          <a className="brand" href="https://four2labs.com" target="_blank" rel="noreferrer">
            <img src="/logo.png" alt="" className="brand-logo" />
            <span className="brand-word">four<b>2</b>labs</span>
          </a>
          <div className="persona">
            <select value={selectedPersona} onChange={e => handlePersonaChange(e.target.value)} disabled={isConnected}>
              {personas.map(p => <option key={p.id} value={p.id}>{p.name} · {p.language.toUpperCase()}</option>)}
            </select>
          </div>
        </header>

        {view === 'call' ? (
          <section className="call">
            <div ref={orbRef} className={`orb-stage ${isConnected ? 'live' : ''} ${isConnecting ? 'busy' : ''} ${speaking ? 'speaking' : ''}`}>
              <span className="orb-glow" aria-hidden />
              <span className="orb-ring r1" aria-hidden />
              <span className="orb-ring r2" aria-hidden />
              <span className="orb-ring r3" aria-hidden />
              <button className="orb" onClick={orbAction} disabled={isConnecting} aria-label={isConnected ? 'End call' : 'Start call'}>
                <span className="orb-face">{isConnecting ? <Loader2 className="spin" size={38} /> : isConnected ? <PhoneOff size={34} /> : <Mic size={40} />}</span>
              </button>
              {isConnected && <div className="wave" aria-hidden>{Array.from({ length: 11 }).map((_, i) => <span key={i} style={{ '--n': i } as React.CSSProperties} />)}</div>}
            </div>

            <div className="call-copy">
              {!isConnected && !isConnecting && (<>
                <h1>Talk to <span className="grad">four2labs</span></h1>
                <p>Tap to start a live conversation. Our AI tells you what we do, answers your questions, and books your free consultation, in English, Hindi or Telugu.</p>
              </>)}
              {isConnecting && <h1 className="dim">Connecting you…</h1>}
              {isConnected && (<>
                <h1 className="status-live">{status}</h1>
                <div className="timer">{formatTime(timer)}</div>
              </>)}
            </div>

            {isConnected && liveCaptions.length > 0 && (
              <div className="captions">
                {liveCaptions.map(c => (
                  <div key={c.id} className={`cap ${c.role} ${c.final ? '' : 'interim'}`}>
                    <span className="cap-who">{c.role === 'you' ? 'You' : 'four2labs'}</span>
                    <span className="cap-txt">{c.text}</span>
                  </div>
                ))}
              </div>
            )}

            {isConnected && <button className="hang" onClick={disconnectRoom}>End conversation</button>}

            {!isConnected && !isConnecting && bubble && (
              <div className="tease" key={bubble.text}>
                <span className="tease-who">four2labs</span>
                <p>{bubble.text}</p>
                <button className="tease-cta" onClick={startConversation}>Tap to talk <ArrowRight size={15} /></button>
              </div>
            )}

            {!isConnected && (<>
              <ul className="chips">
                {CHIPS.map(c => (
                  <li key={c}>
                    <button className={bubble?.topic === c ? 'on' : ''} onClick={() => teaseTopic(c)}>{c}</button>
                  </li>
                ))}
              </ul>
              <button className="type-link" onClick={() => setView('chat')}>Prefer to type? Open chat →</button>
            </>)}
          </section>
        ) : (
          <section className="chatview">
            <button className="back" onClick={() => setView('call')}><ArrowLeft size={16} /> Back to call</button>
            <div className="panel">
              <div className="chat-scroll">
                {chatMessages.length === 0 ? (
                  <div className="chat-intro">
                    <p className="chat-hi">Hi, I&rsquo;m your four2labs assistant. Ask me anything.</p>
                    <div className="suggests">{SUGGESTIONS.map(s => <button key={s} onClick={() => sendMessage(s)} disabled={isSending}>{s}</button>)}</div>
                  </div>
                ) : (<>
                  {chatMessages.map((m, i) => (<div key={i} className={`msg ${m.role}`}><div className="bubble">{m.text}</div>{m.time && <span className="ts">{m.time}</span>}</div>))}
                  {isSending && <div className="msg assistant"><div className="bubble typing"><span /><span /><span /></div></div>}
                </>)}
                <div ref={chatEndRef} />
              </div>
              <div className="composer">
                {chatMessages.length > 0 && <button className="icon-btn" onClick={clearChat} title="Clear"><Trash2 size={17} /></button>}
                <textarea ref={inputRef} placeholder="Ask about four2labs…" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={handleKeyDown} rows={1} disabled={isSending} />
                <button className="send" onClick={() => sendMessage()} disabled={isSending || !chatInput.trim()}>{isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}</button>
              </div>
              <label className="ctx"><input type="file" accept=".txt,.md,.pdf,.docx,.doc,.png,.jpg,.jpeg,.tiff,.bmp,.webp" onChange={handleFileUpload} disabled={isUploading} />{isUploading ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}<span>{fileName || 'Feed it a document'}</span></label>
            </div>
          </section>
        )}

        {view === 'call' && !isConnected && <a className="scroll-cue" href="#more">See what we build ↓</a>}
      </div>

      {/* ============ SHOWCASE ============ */}
      <section className="more" id="more">
        <div className="sec-head">
          <span className="kicker">What we build</span>
          <h2>From your first website<br />to AI that runs your work.</h2>
          <p>We design, build and look after the technology that powers growing businesses, so you can focus on serving customers.</p>
        </div>
        <div className="ex-grid">
          {EXAMPLES.map(e => (
            <article className={`ex ex-${e.tone}`} key={e.title}>
              <span className="ex-tag">{e.tag}</span>
              <h3>{e.title}</h3>
              <p>{e.body}</p>
            </article>
          ))}
        </div>

        <div className="svc-row">
          {SERVICES.map(({ Icon, title }) => (
            <div className="svc" key={title}><Icon size={18} /><span>{title}</span></div>
          ))}
        </div>
      </section>

      <section className="proc">
        <div className="sec-head center"><span className="kicker">How we work</span><h2>A simple, friendly process</h2></div>
        <div className="proc-grid">
          {PROCESS.map(s => (<div className="step" key={s.n}><span className="step-n">{s.n}</span><h4>{s.t}</h4><p>{s.d}</p></div>))}
        </div>
      </section>

      <footer className="contact" id="contact">
        <div className="contact-cta">
          <span className="kicker">Have an idea? Or a problem?</span>
          <h2>Let&rsquo;s build something<br />worth every penny.</h2>
          <div className="contact-actions">
            <a className="btn-primary" href="mailto:four2labs@gmail.com">Start a conversation <ArrowRight size={16} /></a>
            <a className="btn-ghost" href="tel:+919390694802">+91 93906 94802</a>
          </div>
        </div>
        <div className="contact-bottom">
          <div className="brand"><img src="/logo.png" alt="" className="brand-logo" /><span className="brand-word">four<b>2</b>labs</span></div>
          <span>Tech that grows your business · India &amp; US</span>
          <span className="muted">© 2026 four2labs,live AI demo</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
