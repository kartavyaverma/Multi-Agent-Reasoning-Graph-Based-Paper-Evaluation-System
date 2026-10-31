# PaperCheck: team guide

For us, to understand the project and explain it to teachers.

## In one line

PaperCheck checks handwritten answer sheets like a panel of examiners: it reads the script, compares the student's reasoning with the model answer's, grades through four independent AI agents, and explains every mark.

## Our three strong points

1. **Graph-based evaluation:** we compare reasoning, not just text.
2. **Parallel workflow engine:** work runs side by side, automatically, in the background.
3. **Local system, cloud brain:** everything runs on our machine except the AI model.

---

## 1. Graph-based evaluation (the core idea)

**Simple version:** two students can use the same words, but only one reasons correctly. Another can be right in completely different words. Comparing strings can't tell the difference, so we compare the *chain of thinking*.

**How it works:**

1. The **model answer becomes a graph.** Each **node** is one idea or step, such as a definition, formula or conclusion. Each **edge** is a link such as "leads to" or "depends on".
2. The **student's answer becomes a graph** the same way, keeping their mistakes as they wrote them.
3. **Nodes are matched.** Every model node is scored against every student node, and the best pairs are matched one-to-one:
   - Similarity above the match threshold: full credit
   - Above the partial threshold: half credit
   - Below that: the step is missing
4. **Edges are checked.** Can the student's steps actually reach each other in the right direction? (We walk the graph to check.) If the link isn't there but the order is right, it gets half credit.

**The score:**

```text
structure score = 65% node coverage + 35% edge alignment
```

**What it produces:** matched steps, **missing steps** and extra steps. These go to the grading agents as evidence, and also appear on the student's results page.

**Point to make clearly:** the graph doesn't set the final mark alone. The agents give the marks, and the graph guides them. If the graph score and the agents strongly disagree, confidence drops.

**Be accurate about matching:** similarity can use embeddings (matching by meaning) or word overlap. Our current Ollama Cloud setup uses **word overlap**, because the cloud has no embedding model. Meaning-based matching needs a local Ollama running `nomic-embed-text`. The graph structure and edge checks work the same either way.

---

## 2. Parallelism and automation

**Simple version:** like an exam hall with many examiners. Independent work happens side by side, and work that depends on something waits for it.

**Technical version:** the pipeline is a **DAG** (directed acyclic graph) of 17 steps. Each step lists what it depends on, and starts by itself once those finish.

We have **three levels of parallel work:**

| Level | What runs together | Limit |
|---|---|---|
| **Steps** | Independent branches, such as model-answer reading and handwriting reading, or the 4 agents | Up to 8 steps at once |
| **Students** | Each step splits into one batch per student (agents may split further) | 2–4 at once per step, adjustable |
| **AI requests** | A central queue controls how many reach the model | `OLLAMA_PARALLEL`, currently **1** |

**Be honest about the last row:** our current setting sends **one AI request at a time**, to stay within the free tier. So the system schedules work in parallel, and the model calls are queued. Graph comparison and PDF work don't have this limit. With a paid plan or a stronger GPU, raising that one number gives more parallel AI calls, with no redesign.

**Good line to use:** "Our architecture is parallel by design. Throughput is limited by the model capacity we choose, not by our code."

**Automation, once you click Start:**

- Files are split per student, and everything runs in the background. You can close the page.
- **Retries:** a failed step or batch retries automatically.
- **Crash recovery:** progress is saved, so after a restart it resumes instead of starting over.
- **Fault isolation:** one bad script is marked as an error, and the rest of the class continues.
- **Live view:** status, logs and timing for every step.

---

## 3. Local system, cloud model

| Runs on our machine | Runs in the cloud |
|---|---|
| Website and API (React, Node, Express) | Only the AI model (`gemma4:31b` on Ollama Cloud) |
| Database (NeDB) and file storage | |
| Workflow engine, queue, retries | |
| PDF to image conversion | |
| Graph comparison, confidence routing, marks, analytics | |

**Why:** large vision models need strong GPUs, which our laptops don't have. The cloud gives us a much bigger model for free, within usage limits.

**Swappable:** we use the same Ollama API either way. Changing a few lines in `.env` moves the AI back to a fully local model.

**Say this carefully:** in cloud mode, page images and answers are sent to Ollama Cloud. Only local mode keeps all data on the machine.

---

## How one answer gets graded

1. **Read:** the vision model transcribes the answer and notes any diagram.
2. **Diagrams:** each figure is checked against the expected one.
3. **Graphs:** model and student reasoning are compared.
4. **Four agents:** logic, concept, coverage and fact-check each give a mark and a confidence.
5. **Combine:** weighted average (logic 25%, concept 30%, coverage 30%, facts 15%). All of this can be changed.
6. **Route:** by confidence:
   - 70% or higher: auto-accepted
   - 50–70%: senior examiner agent re-checks
   - Below 50%: flagged for the teacher
7. **Finish:** final marks, then a learning pack and analytics.

Disagreement between agents lowers confidence, which is why uncertain answers go to a higher check instead of receiving a random mark.

## Tech stack in one breath

React + Vite on the front end, Node + Express on the back end, NeDB as the database, our own workflow engine, and Ollama for AI.

## Our results (be precise)

We tested 7 sample scripts that we made ourselves, across Physics and Chemistry. All 7 scored inside the range we expected:

| Student | Marks | Expected |
|---|---|---|
| Aarav | 20/20 | 19–20 |
| Rohan | 10.5/20 | 8–11 |
| Ananya | 1.5/20 | 0–3 |
| Ishaan | 49/50 | 46–50 |
| Priya | 35.5/50 | 34–40 |
| Arjun | 27/50 | 20–28 |
| Sneha | 6/50 | 2–8 |

**This is a small test on typed "handwriting-style" scripts, not proof of accuracy on real classes.** Say so before someone asks. Testing on real scanned scripts with teacher marks is the next step.

## Likely questions

**Why not just give the whole answer to ChatGPT?**
One model gives one opinion with no checks. We use several independent checks, a structure comparison, confidence routing and a visible reason for each mark.

**Can the AI be wrong?**
Yes. That's why it reports confidence, flags uncertain answers, and lets the teacher change any mark.

**What if a student answers differently from the model answer?**
Agents are told to credit correct alternatives, and the fact-check agent judges correctness independently of the model answer's wording.

**Why are there 4 agents?**
Each looks for different things, and their disagreement is a useful warning sign.

**Is it fast?**
Our two-student Physics test took about 2 minutes. Time depends on script length and model load.

**Is it really free?**
Yes, within Ollama Cloud's free limits, and all our software is open source. Large classes may hit those limits.

**Can it replace teachers?**
No. It does the first pass and shows its reasoning. The teacher has the final say.

## What not to claim

- "100% accurate" or "replaces teachers"
- "Every AI call runs in parallel" (not on our current setting)
- "All data stays local" (only true in local mode)
- "Matches by meaning" (only true with embeddings on)
