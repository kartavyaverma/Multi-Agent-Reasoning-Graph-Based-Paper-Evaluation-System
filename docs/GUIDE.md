# PaperCheck: team guide

For us, to understand the project and explain it to teachers.

## In one line

PaperCheck checks handwritten answer sheets like a panel of examiners: it reads the script, compares the student's reasoning with the model answer's, grades through four independent AI agents, and explains every mark.

## The whole flow in simple language

**The teacher's model answer is the reference for grading. The AI doesn't write its own answer key.** A test can't start unless the teacher uploads a model answer or types one for every question.

1. **Teacher uploads** the question paper, the model answer and the student scripts.
2. **We read the question paper:** questions and marks. If the teacher typed the questions, this AI step is skipped.
3. **We read the teacher's answer:** the AI converts it into key points with marks. A printed mark split is used as it is.
4. **We build the reference graph:** the teacher's answer becomes a chain of steps. The AI is told not to invent content.
5. **We read each student's script:** word for word, mistakes included.
6. **We build the student's graph** and compare it with the teacher's to find missing steps.
7. **Four agents grade** the student's answer against the teacher's answer, key points and graph.
8. **Confidence decides what happens next:** accept, re-check with the senior examiner, or flag for the teacher.
9. **The teacher reviews:** the scan sits beside the marksheet, and the teacher can change any mark.
10. **Students get results:** marks, reasons and a learning pack. Teachers get analytics.

### Where the AI uses its own knowledge

| Case | What happens |
|---|---|
| Teacher's answer has no mark split | AI divides the question's marks among the key points |
| Common mistakes, valid alternatives | AI may infer these if they aren't printed |
| Correct answer in different words | Agents are told to give credit |
| Facts, formulas, units | Fact-check agent also uses general subject knowledge |
| Question missing from the uploaded answer | AI fills in textbook-based content, marks it `missing_in_model` and lowers confidence by 20% |
| Learning packs | AI-written, and they don't affect marks |

**Current gap:** a question with no teacher answer lowers confidence, but it isn't always sent to the teacher. Make sure the model answer covers every question.

**What to tell teachers:** "Grading is anchored to your model answer. The AI converts it into key points and a reasoning graph, then checks each student against it. It uses general knowledge only to verify facts and credit valid alternatives."

---

## Our three strong points

1. **Graph-based evaluation:** we compare reasoning, not just text.
2. **Parallel workflow engine:** work runs side by side, automatically, in the background.
3. **Local system, cloud brain:** everything runs on our machine except the AI model.

---

## 1. Graph-based evaluation (the core idea)

**Simple version:** two students can use the same words, but only one reasons correctly. Another can be right in completely different words. Comparing strings can't tell the difference, so we compare the *chain of thinking*.

**How it works:**

1. The **teacher's model answer becomes a graph.** The AI only converts it and is told not to add content. Each **node** is one idea or step, such as a definition, formula or conclusion. Each **edge** is a link such as "leads to" or "depends on".
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

## 4. Methods and formulas

### Text extraction

We don't use a separate OCR engine such as Tesseract. **The vision model does the OCR:**

1. Each PDF page is rendered to an image (scale 1.5, up to 60 pages on cloud).
2. All of a student's pages go to the model in one request, with the question list.
3. It returns JSON for each question: exact text, crossed-out text, whether a figure exists, and a legibility score from 0 to 1.

It's told to copy **word for word and not fix mistakes**, because the mistakes get graded. It also maps answers to questions, even when they're out of order or run across pages.

### Chunking and offloading

We **don't use RAG or token-based text chunking**. We split work by logical unit:

| What is split | How |
|---|---|
| Class | One batch per student |
| Combined scan | Equal blocks, using "pages per student" |
| Grading | Up to 8 questions per AI call, per agent (adjustable) |
| Embeddings, if on | Up to 64 texts per request, with repeats cached |

**Offloaded to the cloud:** reading, building graphs, agent grading, learning packs.
**Done locally, with no AI:** graph matching and scoring, routing, marks, analytics.

### Graph algorithm

The AI **converts** the teacher's answer and the student's answer into graphs. **Our own deterministic code compares them**, so the same two graphs always get the same score.

**Node similarity** (one of these):

```text
With embeddings:  cosine = (A · B) / (|A| × |B|)
Without (current): overlap = 0.6 × common / min(|A|, |B|) + 0.4 × common / |A ∪ B|
```

For word overlap, common words are removed and word endings trimmed first.

**Node matching:** score every model-student pair, sort highest first, and accept each pair if both nodes are still free. This is **greedy one-to-one matching**.

| Credit | Embeddings | Word overlap (current) |
|---|---|---|
| Full (1) | ≥ 0.70 | ≥ 0.50 |
| Half (0.5) | ≥ 0.55 | ≥ 0.30 |
| Missing (0) | below that | below that |

**Edge check:** for each model edge between two matched steps, a **depth-first search** checks whether the student's graph has a path in the same direction. A path scores 1. No path but the right written order scores 0.5.

```text
node coverage  = sum of node credit / number of model nodes
edge alignment = sum of edge credit / number of model edges
structure      = 0.65 × node coverage + 0.35 × edge alignment
```

### Final mark and confidence

```text
fraction   = weighted mean of the agents' fractions
marks      = fraction × question marks, rounded to the nearest 0.5
agreement  = 1 - (standard deviation of fractions / 0.5), kept between 0 and 1
confidence = mean agent confidence × (0.25 + 0.75 × agreement)
```

Confidence is then reduced for: hard-to-read handwriting, a graph score far from the agents' (by more than 0.45), a figure judged with low confidence, a question missing from the model answer, or an agent that didn't respond.

## 5. Poor handwriting and bad scans

**The rule: don't guess silently, and don't punish neatness. Lower confidence and involve the teacher.**

| Situation | What happens |
|---|---|
| A word can't be read | Written as `[illegible]`, or `[?word]` if unsure |
| Messy but readable | Graded normally; agents are told not to reward neat writing |
| Legibility below 0.6 | Confidence is reduced, with the reason "hard-to-read handwriting" |
| Very low confidence | Goes to the senior examiner or the teacher, with the reason shown |
| Crossed-out work | Kept separately and not marked |
| Answers out of order | Mapped to the right question |
| Name unreadable | Left blank, never invented; low confidence shows a "please verify" note |
| Teacher checking | Scan and marksheet side by side; any mark can be changed |

**What we don't handle yet (say this honestly):**

- No image clean-up: no deskew, contrast fixing or noise removal.
- No warning before grading that a scan is too poor. A re-scan is manual.
- **Risky case:** if the model sees nothing readable and marks an answer "not attempted", it gets 0 with full confidence and is **not** flagged. The teacher should check these against the scan.
- A misread word can still lead to a wrong mark if the model is confident.
- Very long scripts: pages beyond the limit aren't read.

**If asked "What if the handwriting is really bad?":**
"The system marks unreadable words instead of guessing, and low legibility lowers confidence, so the answer goes for a higher check or to the teacher, with the original scan beside it. A human stays responsible. Automatic scan clean-up and catching wrongly blank answers are our next improvements."

## How one answer gets graded

1. **Read:** the vision model transcribes the answer and notes any diagram.
2. **Diagrams:** each figure is checked against the expected one.
3. **Graphs:** the student's reasoning is compared with the teacher's.
4. **Four agents:** logic, concept, coverage and fact-check each grade against the teacher's answer, giving a mark and a confidence.
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

- "The AI never goes beyond the teacher's answer" (see the table above)
- "100% accurate" or "replaces teachers"
- "Every AI call runs in parallel" (not on our current setting)
- "All data stays local" (only true in local mode)
- "Matches by meaning" (only true with embeddings on)
