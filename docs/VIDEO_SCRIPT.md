# PaperCheck — demo video script (Loom)

Total ≈ 9–10 min. **Say** = what you speak. **Show** = what you click. Keep it moving; don't read the screen aloud.

**Before you hit record**
- App open at http://localhost:4100, signed in, theme set to **Midnight**.
- One finished test with real marks (re-evaluate **IA2** first: open it → **↻ Re-evaluate**, takes 3–5 min).
- Close other tabs, hide desktop notifications, zoom browser to 100–110%.

---

## 1. Opening statement — 60 s (word for word)
**Show:** Dashboard, still. Start talking straight away.

**Say:**

"Hi, this is PaperCheck — an AI system that evaluates handwritten exam answer sheets.

Every teacher knows the problem: checking subjective answers takes hours, marking isn't always consistent, and students rarely get feedback on *why* they lost marks.

PaperCheck fixes that. A teacher uploads three things — the question paper, the model answer, and the students' scanned answer sheets. PaperCheck reads the handwriting, including equations, tables and diagrams, grades every answer against the marking scheme, and explains every single mark.

There are four key things that make it different.

One — it doesn't trust a single AI. Four separate AI examiners grade each answer — for logic, concepts, coverage and facts — and if they disagree, a senior examiner re-checks it, and anything still uncertain is flagged for the teacher.

Two — it's transparent. Every deduction is shown on a red-pen marksheet, right next to the student's actual script.

Three — the teacher stays in control. Every setting, every AI prompt, and every mark can be changed.

And four — it goes beyond marks: a personal learning pack for each student, and analytics across tests, subjects and semesters.

The MVP is the full loop working end to end: upload the papers, get every student graded with reasons, review and correct marks, and see class and student analytics. It runs on a free cloud AI model, so no expensive hardware is needed.

Let me show you how it works."

## 2. Look and layout — 20 s
**Show:** Sidebar → palette icon → switch Midnight → Frost → back.
**Say:** "Clean layout: sidebar for navigation, your subjects listed here. Four themes, two of them glass, plus accent colours. Built in React with a custom design system."

## 3. Dashboard — 30 s
**Show:** Year dropdown, click semester chip, subject dropdown, point at the stat cards, "Needs support".
**Say:** "Everything is organised by academic year and semester. Filter, and every number updates — class average, pass rate, answers waiting for review. It also flags students who need support and shows top performers."

## 4. Creating a test — 45 s
**Show:** + New test → subject, year, semester → drag the question paper in → **Read questions** → show the editable list → drop model answer + student PDFs.
**Say:** "Creating a test is four steps. Drag in the question paper — the AI reads every question and its marks, and I can correct anything before starting. Then the model answer, then all student scripts at once — one PDF per student, or one combined scan split by pages. Hit start and you can walk away."

## 5. How it grades (the core) — 60 s
**Show:** Workflow page graph, slowly pan down the steps.
**Say (layman):** "Grading isn't one AI call. It's a 17-step pipeline, like a team of examiners."
**Say (technical):** "First a vision model reads the handwriting — OCR, equations, diagrams. Each answer becomes a reasoning graph and is compared with the model answer's graph to find missing steps. Then four independent agents — logic, concept, coverage and fact-check — grade every answer. A confidence router checks how much they agree: confident marks are accepted, unsure ones go to a senior-examiner agent, and anything still doubtful is flagged for the teacher. Finally it builds a personal learning pack for each student."

## 6. Live workflow view — 45 s
**Show:** Drag a node, zoom, minimap, click a step → logs / students / input / output; switch to Timeline, then Activity.
**Say:** "You can watch it live. It's a node-based workflow engine — every step shows its status, retries, logs, and the exact data going in and out. Timeline shows how long each step took; Activity is the full log. It survives restarts and one bad script never sinks the whole class."

## 7. Workflow settings — 30 s
**Show:** Settings → Grading tab (weight sliders, confidence zones) → Steps tab (toggle an optional step).
**Say:** "Teachers control the grading: how much each agent counts, when marks are auto-accepted versus sent for review, which steps run, retries and parallelism. Save it as your default for every new test."

## 8. Editable AI prompts — 45 s
**Show:** Settings → AI prompts → open Logic agent → Base prompt → Added prompts → **+ Add prompt** → Insert from library → Preview.
**Say:** "Every AI step's prompt is visible and editable. Keep the default, or add your own instructions — for example 'accept Hindi answers' or 'give method marks'. Save favourites to a library and reuse them. Preview shows exactly what the model receives. The output format is locked, so edits can't break grading."

## 9. Results overview — 30 s
**Show:** Test page → Overview charts → Students tab → "Needs review" filter → Export CSV.
**Say:** "Class results: marks distribution, question-wise averages, grades and toppers. Filter to answers needing review, and export everything to CSV."

## 10. Marked script — 60 s  ★ highlight
**Show:** Open a student → **Marked script**. Scroll left scan and right marksheet. Click a red circled mark, change it, press Enter. Toggle "Marksheet only". Click Print.
**Say:** "This is my favourite part. On the left, the student's real answer sheet. On the right, the paper marked like a teacher would in red pen: marks circled per question, a tick and plus-marks for every key point they got, a cross and minus-marks for every point they missed, and the reason for each deduction. Diagram errors are called out too. Disagree? Click the mark, change it — totals update instantly. And it prints as a clean marksheet."

## 11. Learning pack — 20 s
**Show:** Learning pack tab.
**Say:** "Every student gets a personal learning pack: knowledge gaps, revision notes, practice questions, where their reasoning went wrong, and video suggestions."

## 12. Student analytics — 45 s
**Show:** Students page → filters → open a student → progress chart, skill radar, by subject / type / term, recurring gaps.
**Say:** "Students are matched across every test by roll number. Each profile shows progress against the class, a skill profile from the four grading agents — logic, concepts, coverage, facts — performance by subject, question type and semester, and the gaps that keep coming back."

## 13. Re-evaluate — 15 s
**Show:** Test page → ↻ Re-evaluate (cancel the dialog), or a step → Re-run from here.
**Say:** "Changed a setting or a prompt? Re-evaluate the whole test in one click, or re-run from any single step."

## 14. Tech stack — 30 s
**Show:** Workflow page or any screen.
**Say:** "Under the hood: React and Vite on the front end, Node and Express with an embedded database on the back end, and a custom workflow engine with retries and crash recovery. The AI runs on Ollama — Google's Gemma 4, 31 billion parameters with vision, on Ollama Cloud. Free, no GPU needed, and it can switch to a fully local model for privacy."

## 15. Close — 15 s
**Show:** Dashboard.
**Say:** "Hours of checking become minutes — with every mark explained and the teacher always in control. That's PaperCheck. Thanks for watching."

---

**If you need a 5-minute cut:** keep 1, 4, 5, 10, 12, 15 (≈ 5 min).
