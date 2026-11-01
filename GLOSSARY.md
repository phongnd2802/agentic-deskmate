# Agentic DeskMate

An AI workspace where people ask questions, get work done, and assign tasks to AI Agents.

## Language

### Product areas

**Chat**:
The area where Users ask questions, work, and assign tasks to Agents.
_Avoid_: Chatbot, assistant

**Agents**:
The area where Agents are created and managed. Work with an Agent happens in Chat, not here.

### People and companies

**Organization**:
A company using Agentic DeskMate, and the boundary that separates its Users and data from every other company's.
_Avoid_: Tenant, workspace, company

**User**:
A person who signs in with an email and password and belongs to exactly one Organization.
_Avoid_: Account

**Admin**:
A User who manages their Organization's Users and Providers.

**Member**:
A User without administrative rights.

**Operator**:
The person running the installation, who creates Organizations and their first Admin. An Operator is not a User.
_Avoid_: Super admin

**Invitation**:
A single-use link an Admin gives to a person so they can become a User of the Organization.

### Conversations

**Conversation**:
One question a User asked in Chat and the Answers it received, owned by that User and visible only to them.
_Avoid_: Chat, thread, session

**Answer**:
A reply to the question in a Conversation, which is complete, stopped, or failed. Retrying adds another Answer to the same Conversation.
_Avoid_: Response, completion

**Generative UI**:
An interactive interface the LLM creates as part of an Answer.
_Avoid_: Widget, artifact

### AI

**Agent**:
An AI teammate that Users work with in Chat.
_Avoid_: Bot, assistant

**Provider**:
An Organization's configured connection to an LLM service that speaks either the OpenAI-compatible or the Anthropic-compatible API.
_Avoid_: Vendor, LLM backend

**Model**:
An LLM offered by a Provider that a User can choose when asking a question.

**Routing Model**:
The Model an Organization designates to decide how each Answer is presented. It never writes the Answer.
_Avoid_: Router, decision model
