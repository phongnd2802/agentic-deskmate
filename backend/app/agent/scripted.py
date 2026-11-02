"""A deterministic stand-in for a real Model, so tests and dev need no API key."""

import asyncio
import json
import re
from collections.abc import AsyncIterator

from pydantic_ai.models.function import DeltaToolCall

from app.agent.generative_ui import RENDER_TOOL

ANSWER = """## Scripted Answer

This text streamed from the scripted Model through **CopilotRuntime** and AG-UI.

```python
def greet(name: str) -> str:
    return f"Hello, {name}"
```

The walking skeleton is working.
"""


# Question markers make the Model misbehave once per question, so a retry of the same question succeeds.
_misbehaved: set[tuple[str, str]] = set()


def _misbehaves(marker: str, question: str) -> bool:
    if marker not in question or (marker, question) in _misbehaved:
        return False
    _misbehaved.add((marker, question))
    return True


# The controls start at 10, and the body is taller than initialHeight so a reopened page has to measure it.
SLIDER = {
    "initialHeight": 60,
    "css": "body{padding:12px} #val{font-size:28px;font-weight:700}",
    "html": '<head></head><body><h3>Local control</h3><input id="s" type="range" min="0" max="100" value="10" aria-label="value">'
    '<div>value: <span id="val">10</span></div><button id="b">add 5</button></body>',
    "jsFunctions": "function setVal(v){document.getElementById('s').value=v;document.getElementById('val').textContent=v}",
    "jsExpressions": [
        "document.getElementById('s').addEventListener('input',e=>setVal(e.target.value))",
        "document.getElementById('b').addEventListener('click',()=>setVal(Number(document.getElementById('s').value)+5))",
    ],
}


def _probe(origin: str) -> dict:
    """Every way out the sandbox could try, each writing its outcome into #r. `origin` is where a test watches for traffic."""
    return {
        "initialHeight": 360,
        "html": f'<head></head><body><pre id="r">running</pre><canvas id="c" width="300" height="100"></canvas><img src="{origin}/img-tag"></body>',
        "jsFunctions": """
function rep(k,v){window.__r=window.__r||{};window.__r[k]=v;document.getElementById('r').textContent=JSON.stringify(window.__r)}
function probe(){
  fetch('%(o)s/fetch',{mode:'no-cors'}).then(()=>rep('fetch','ALLOWED')).catch(()=>rep('fetch','blocked'));
  const im=new Image();im.onload=()=>rep('img','ALLOWED');im.onerror=()=>rep('img','blocked');im.src='%(o)s/img-js?d=secret';
  const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
  s.onload=()=>{new Chart(document.getElementById('c'),{type:'bar',data:{labels:['a','b'],datasets:[{data:[3,7]}]},options:{animation:false}});rep('chartjs','loaded v'+Chart.version)};
  s.onerror=()=>rep('chartjs','FAILED');document.head.appendChild(s);
}
function leave(){location.href='%(o)s/navigation?d=secret'}""" % {"o": origin},
        "jsExpressions": ["probe()", "document.getElementById('r').addEventListener('click',leave)"],
    }


# What generated code may call on the host: an https link (after a confirmation) and no way to start a run.
LINKS = {
    "initialHeight": 200,
    "html": '<head></head><body><button id="https">open https</button><button id="http">open http</button>'
    '<button id="prompt">send prompt</button><button id="swap">swap</button><button id="evil">evil</button><pre id="r"></pre></body>',
    "jsExpressions": [
        "window.show=(k,v)=>{document.getElementById('r').textContent+=k+': '+v+'\\n'}",
        "document.getElementById('https').onclick=async()=>show('https',JSON.stringify(await Websandbox.connection.remote.openLink({url:'https://example.com/a?b=1'})))",
        "document.getElementById('http').onclick=async()=>{try{await Websandbox.connection.remote.openLink({url:'http://example.com/'});show('http','opened')}catch(e){show('http','refused')}}",
        "document.getElementById('prompt').onclick=()=>show('prompt',Websandbox.connection.remote.sendPrompt?'registered':'absent')",
        # A second link while the first waits for confirmation, and an address whose backslash browsers read as a slash.
        "document.getElementById('swap').onclick=async()=>{const r=Websandbox.connection.remote;const first=r.openLink({url:'https://first.example/'});try{await r.openLink({url:'https://second.example/'});show('second','opened')}catch(e){show('second','refused')}show('first',JSON.stringify(await first))}",
        "document.getElementById('evil').onclick=async()=>show('evil',JSON.stringify(await Websandbox.connection.remote.openLink({url:'https://evil.com\\\\@good.com/'})))",
    ],
}


async def _render_call(args: dict | str, name: str = RENDER_TOOL, index: int = 0) -> AsyncIterator[dict]:
    """A tool call streamed in pieces; a string is sent as the raw arguments, valid JSON or not."""
    raw = args if isinstance(args, str) else json.dumps(args)
    for start in range(0, len(raw), 60):
        await asyncio.sleep(0.05)
        yield {index: DeltaToolCall(name=name if start == 0 else None, json_args=raw[start : start + 60], tool_call_id=f"render-{index}")}


async def stream_answer(messages, info) -> AsyncIterator[str | dict]:
    question = next(p.content for m in reversed(messages) for p in m.parts if p.part_kind == "user-prompt")
    offered = any(tool.name == RENDER_TOOL for tool in info.function_tools)
    # A Model that calls a tool it was not offered, once per question.
    if _misbehaves("[gui-rogue]", question):
        yield "Calling a tool I was not offered. "
        async for delta in _render_call(SLIDER):
            yield delta
        return
    if offered and (probe := re.search(r"\[gui-probe (\S+)\]", question)):
        yield "Here is the probe. "
        async for delta in _render_call(_probe(probe[1])):
            yield delta
        return
    if offered and (raw := re.fullmatch(r"\[gui-raw (\S+) (.*)\].*", question, re.DOTALL)):
        yield "Here is a raw call. "
        async for delta in _render_call(raw[2], raw[1]):
            yield delta
        return
    if offered and "[gui-two]" in question:
        yield "Here are two. "
        for index in (0, 1):
            async for delta in _render_call(SLIDER, index=index):
                yield delta
        return
    if offered and "[gui-stall]" in question:
        yield "Started writing. "
        async for delta in _render_call(SLIDER):
            yield delta
            await asyncio.sleep(3600)  # after the first piece of the call
    if offered and "[gui" in question:
        yield "Here is a slider. "
        # No html, so the arguments are not a usable interface; the retry succeeds.
        args = {"initialHeight": 120} if _misbehaves("[gui-bad]", question) else LINKS if "[gui-links]" in question else SLIDER
        async for delta in _render_call(args):
            yield delta
        return
    if _misbehaves("[fail]", question):
        yield "Partial text before the failure. "
        raise RuntimeError("scripted failure")
    if _misbehaves("[stall]", question):
        yield "Started writing. "
        await asyncio.sleep(3600)
    for start in range(0, len(ANSWER), 12):
        # Paced so a browser can see the Answer grow, not one buffered blob.
        await asyncio.sleep(0.05)
        yield ANSWER[start : start + 12]
