// ── Dialogue engine ───────────────────────────────────────────────────────────
// Data format (write in fates_dialogue_lines.js):
//
//   export const MY_DIALOGUE = {
//       start: 'intro',
//       nodes: {
//           intro:  { text: "Hello.",     next: 'q'     },
//           q:      { choices: [
//                       { label: "Who are you?", next: 'a_who' },
//                       { label: "Goodbye.",     next: null    },
//                    ]},
//           a_who:  { text: "Someone.",   next: 'shared' },
//           shared: { text: "Anyway...",  next: null     },
//
//           // Slam node — appears all at once, no typewriter:
//           boom:   { text: "STOP!", slam: true,
//                     style: { fontSize: '5rem', color: '#ff2020' },
//                     shake: 0.08,   next: 'next_node' },
//       }
//   };
//
// next: null  →  end of dialogue.
// Branches converge by pointing their `next` to the same node key.

const TYPEWRITER_SPEED = 38;

const DEFAULT_GLOW = '0 0 14px rgba(180,100,255,0.95),0 0 40px rgba(180,100,255,0.5),0 0 80px rgba(140,60,255,0.3)';
const SLAM_GLOW    = '0 0 24px rgba(255,30,30,0.95),0 0 60px rgba(255,0,0,0.6),0 0 120px rgba(200,0,0,0.3)';

// ── Dialogue audio ────────────────────────────────────────────────────────────
let audioCtx = null;

function playDialogueNoise(isEnraged = false) {
    if (!audioCtx || audioCtx.state === 'suspended') return;

    const oscillator = audioCtx.createOscillator();
    const gainNode   = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (isEnraged) {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(80, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(1.2, audioCtx.currentTime);
    } else {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(120 + Math.random() * 30, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
    }

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.04);
    oscillator.stop(audioCtx.currentTime + 0.04);
}

{
    const s = document.createElement('style');
    s.textContent = '@keyframes dlg-float{0%{transform:translate(0px,0px) rotate(0deg)}20%{transform:translate(1.5px,-2px) rotate(0.3deg)}45%{transform:translate(-1px,-1.5px) rotate(-0.2deg)}65%{transform:translate(-2px,1.5px) rotate(0.15deg)}85%{transform:translate(1px,2px) rotate(-0.25deg)}100%{transform:translate(0px,0px) rotate(0deg)}}'
        + '@keyframes dlg-slam{0%{transform:scale(2.4) translateY(-12px);opacity:0;filter:blur(6px)}40%{transform:scale(1.06) translateY(2px);opacity:1;filter:blur(0)}65%{transform:scale(0.97)}100%{transform:scale(1) translateY(0)}}'
        + '@keyframes dlg-cursor{0%,100%{opacity:1}50%{opacity:0.35}}';
    document.head.appendChild(s);
}

const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;z-index:5000;pointer-events:none;display:none;flex-direction:column;align-items:center;justify-content:center;gap:40px;';
document.body.appendChild(overlay);

const textEl = document.createElement('div');
textEl.style.cssText = 'text-align:center;padding:0 10vw;max-width:900px;line-height:2;user-select:none;';
overlay.appendChild(textEl);

const choicesEl = document.createElement('div');
choicesEl.style.cssText = 'display:none;flex-direction:column;align-items:flex-start;gap:14px;';
overlay.appendChild(choicesEl);

const hint = document.createElement('div');
hint.style.cssText = 'font-family:monospace;font-size:0.75rem;color:rgba(180,100,255,0.6);letter-spacing:0.12em;opacity:0;transition:opacity 0.5s;user-select:none;';
hint.textContent = '[ SPACE ]';
overlay.appendChild(hint);

// ── State ─────────────────────────────────────────────────────────────────────
let _nodes      = {};
let _currentKey = null;
let _mode       = 'idle';   // 'typing' | 'waiting' | 'choice'
let _timer      = 0;
let _charIndex  = 0;
let _letterSpans = [];
let _choices    = [];
let _choiceIdx  = 0;
let _onComplete = null;
let _effects    = {};
let _active     = false;
let _isSlam     = false;

// ── Span builders ─────────────────────────────────────────────────────────────
function letterSpan(char, { size = '1.8rem', color = '#e8d8ff', glow = DEFAULT_GLOW, slam = false } = {}) {
    const span = document.createElement('span');
    span.textContent = char;
    let anim;
    if (slam) {
        anim = 'dlg-slam 0.38s cubic-bezier(0.15,0,0.3,1) both';
    } else {
        const dur   = (2.0 + Math.random() * 2.5).toFixed(2);
        const delay = (-Math.random() * 5).toFixed(2);
        anim = `dlg-float ${dur}s ease-in-out ${delay}s infinite`;
    }
    span.style.cssText = `display:inline-block;font-family:monospace;font-size:${size};color:${color};text-shadow:${glow};letter-spacing:0.05em;animation:${anim};`;
    return span;
}

function buildTextSpans(line, container, letterList, hidden, spanOpts = {}) {
    container.innerHTML = '';
    if (letterList) letterList.length = 0;
    const tokens = line.split(/( +)/);
    for (const token of tokens) {
        if (!token) continue;
        if (token.trim() === '') {
            const sp = document.createElement('span');
            sp.style.cssText = `display:inline-block;width:${token.length * 1.0}em;`;
            container.appendChild(sp);
        } else {
            const word = document.createElement('span');
            word.style.cssText = 'display:inline-block;white-space:nowrap;';
            for (const char of token) {
                const sp = letterSpan(char, spanOpts);
                if (hidden) sp.style.visibility = 'hidden';
                word.appendChild(sp);
                if (letterList) letterList.push(sp);
            }
            container.appendChild(word);
        }
    }
}

function revealChars(count) {
    for (let i = 0; i < _letterSpans.length; i++)
        _letterSpans[i].style.visibility = i < count ? 'visible' : 'hidden';
}

// ── Choice rendering ──────────────────────────────────────────────────────────
function renderChoices() {
    choicesEl.innerHTML = '';
    _choices.forEach((choice, i) => {
        const selected = i === _choiceIdx;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;';

        const cursor = document.createElement('span');
        cursor.textContent = '▶';
        cursor.style.cssText = `font-family:monospace;font-size:1.1rem;color:#c080ff;text-shadow:0 0 12px rgba(180,100,255,0.9);animation:dlg-cursor 1.2s ease-in-out infinite;visibility:${selected ? 'visible' : 'hidden'};`;
        row.appendChild(cursor);

        const labelWrap = document.createElement('div');
        const color = selected ? '#e8d8ff' : 'rgba(180,130,255,0.45)';
        const glow  = selected
            ? '0 0 14px rgba(180,100,255,0.9),0 0 40px rgba(180,100,255,0.45)'
            : '0 0 6px rgba(180,100,255,0.3)';
        buildTextSpans(choice.label, labelWrap, null, false, { size: '1.4rem', color, glow });
        row.appendChild(labelWrap);
        choicesEl.appendChild(row);
    });
}

// ── Node traversal ────────────────────────────────────────────────────────────
function goToNode(key) {
    if (key == null) {
        _active = false;
        overlay.style.display = 'none';
        _onComplete?.();
        return;
    }
    const node = _nodes[key];
    if (!node) {
        console.warn('[dialogue] unknown node:', key);
        _active = false;
        overlay.style.display = 'none';
        _onComplete?.();
        return;
    }
    _currentKey = key;

    if (node.bg != null) _effects.bg?.(node.bg);

    if (node.text !== undefined) {
        const isSlam = node.slam === true;
        choicesEl.style.display = 'none';
        hint.textContent = '[ SPACE ]';

        _isSlam = isSlam;
        if (isSlam) {
            const size  = node.style?.fontSize ?? '4.5rem';
            const color = node.style?.color    ?? '#ff2020';
            const glow  = node.style?.glow     ?? SLAM_GLOW;
            _mode = 'waiting';
            buildTextSpans(node.text, textEl, null, false, { size, color, glow, slam: true });
            hint.style.opacity = '1';
            if (node.shake != null)
                _effects.shake?.(typeof node.shake === 'number' ? node.shake : 0.08);
            playDialogueNoise(true);
        } else {
            _mode = 'typing';
            _timer = 0;
            _charIndex = 0;
            buildTextSpans(node.text, textEl, _letterSpans, true);
            revealChars(0);
            hint.style.opacity = '0';
        }
    } else if (node.choices) {
        _mode = 'choice';
        _choices   = node.choices;
        _choiceIdx = 0;
        choicesEl.style.display = 'flex';
        renderChoices();
        hint.textContent = '[ ↑↓ ] navigate   [ SPACE ] select';
        hint.style.opacity = '1';
    }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function showDialogue(data, onComplete, effects = {}) {
    _nodes      = data.nodes;
    _onComplete = onComplete;
    _effects    = effects;
    _active     = true;
    overlay.style.display = 'flex';
    goToNode(data.start);
}

export function isDialogueActive() { return _active; }

export function updateDialogue(dt) {
    if (!_active || _mode !== 'typing') return;
    _timer += dt;
    const target = Math.floor(_timer * TYPEWRITER_SPEED);
    if (target >= _letterSpans.length) {
        if (_charIndex < _letterSpans.length) playDialogueNoise(false);
        _charIndex = _letterSpans.length;
        _mode = 'waiting';
        revealChars(_charIndex);
        hint.style.opacity = '1';
    } else if (target > _charIndex) {
        playDialogueNoise(false);
        _charIndex = target;
        revealChars(_charIndex);
    }
}

// ── Input ─────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
    if (!_active) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (_mode === 'typing' || _mode === 'waiting') {
        if (e.code !== 'Space') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (_mode === 'typing') {
            _charIndex = _letterSpans.length;
            _mode = 'waiting';
            revealChars(_charIndex);
            hint.style.opacity = '1';
        } else {
            goToNode(_nodes[_currentKey].next ?? null);
        }
    } else if (_mode === 'choice') {
        if (e.code === 'ArrowUp') {
            e.preventDefault();
            _choiceIdx = Math.max(0, _choiceIdx - 1);
            renderChoices();
        } else if (e.code === 'ArrowDown') {
            e.preventDefault();
            _choiceIdx = Math.min(_choices.length - 1, _choiceIdx + 1);
            renderChoices();
        } else if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            e.stopImmediatePropagation();
            goToNode(_choices[_choiceIdx].next ?? null);
        }
    }
});
