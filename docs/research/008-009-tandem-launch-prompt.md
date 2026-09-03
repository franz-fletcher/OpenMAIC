# Tandem launch prompt (batch 008/009 program)

This is the exact first-message text for the fresh ENGE503 build session. The orchestrator submits it via POST /api/agent/sessions. The human watches and steers in the workbench UI.

---

## Prompt body

Continue the ENGE503 Statics Cram Prep build. The approved plan below was ratified in a previous session ("Approve as written. Build all 7 stages, 52 pages, in order."; the per-stage tables are authoritative at 50 pages). That session died to watchdog aborts and a 307K-token transcript. It completed Stage 1 (8 pages) and Stage 2 (7 pages) in folder folder-sEcSTrX-mp. Stage 3 exists with 0 pages. Do not touch Stages 1 and 2.

Mandatory style, unchanged from the original brief: all prose in Simplified Technical English. No em dashes anywhere. ADHD-friendly, research-backed. Use interactive widgets, quizzes, and slides exactly per the plan tables. Each page is one generate_scene call with an explicit brief. Each successful call is a durable checkpoint; if a page fails, retry it once, then move on and report the failure list at the end.

Build order: Stage 3 (7 pages), then Stages 4, 5, 6, 7 (7 pages each). After each stage completes, post a one-line progress note in the conversation, then continue without waiting.

The approved plan follows verbatim.

---

All 40 PDFs are now extracted and read. Full picture confirmed. Here is the complete build plan. Nothing is created until you approve it.

## What I confirmed in the new batch

The 20 new files are weeks 1 to 3. They map cleanly onto the exam.

| Week | Content I now have | Feeds |
|---|---|---|
| 1 | Units, scalars, vectors, resolution, parallelogram law, position vectors, unit vectors, dot product, projection | Q1 vectors parts, Q1(c) projection |
| 2 | Cross product, moment of a force, moment about an axis (triple scalar product), couple moments | Q1(d) FBD and couple part |
| 3 | 2D general resultants, 3D parallel systems, 3D general systems, force-couple reduction, wrench resultant | Q1(a)/(b), Q1(c) model paper |

**Three gaps worth naming before you approve.**

1. **No friction content exists.** Your syllabus lists dry friction in week 5 and 6. No PDF covers it. Neither exam paper asks it. I plan to leave it out. Tell me if you want it anyway.
2. **Figures did not survive extraction.** The PDFs store ~1,900 images between them. I only get text plus image references. So every diagram in your exam papers must be redrawn or rebuilt as an interactive widget. I cannot copy them.
3. **OCR digits are unreliable in the solved files.** The boom problem in the Practice Test answer shows `120i - 6T2j + 3.492T1j - 2.619T1j`, where two `j` terms are merged. I will recompute every numerical answer independently. Where my result disagrees with the uploaded answer key, I will flag it rather than repeat it silently.

## The exam skeleton both papers share

| Q | Marks | Task | Fixed method |
|---|---|---|---|
| Q1 | 14 | Three or four short parts | Vectors, moments, resultants, projection |
| Q2 | 12 | 3D rigid body, ball-and-socket plus two cables | ΣM about the joint, never ΣF |
| Q3 | 12 | Truss, three named members | Symmetry reactions, then method of sections |
| Q4 | 12 | Centroid of shaded area | Set up the strip, then integrate |

That structure drives everything below. Each stage ends in the exact question type it exists to make automatic.

---

# What I intend to build

**Series title:** ENGE503 Statics, Cram Prep
**Folder:** one OpenMAIC folder holding all seven stages
**Audience:** engineering students who already write software
**Prose rule:** STE discipline. Under 20 words in procedures, 25 in descriptions. Active voice. One idea per sentence. Vertical lists. No em dashes anywhere.
**ADHD rules, each with a reason:** one idea on screen (working memory), retrieval before the answer (quizzes beat re-reading for exam marks), visible mark and time budget on every task (legible effort), immediate feedback not a block at the end (short reward loop), fade the worked examples instead of repeating them (worked example effect), no decorative motion (distraction).

### Stage 1, Vector Toolkit

*Payoff: you can turn any cable or force into components without a slip.*

| # | Page | Type |
|---|---|---|
| 1 | Why every statics problem is a coordinate problem | slide |
| 2 | Drag the angle, watch the components change | interactive: simulation |
| 3 | A vector is a tuple with a magnitude | interactive: code (Python) |
| 4 | Unit vectors, the normalise function | interactive: simulation |
| 5 | Position vectors, tip minus tail, every time | interactive: diagram |
| 6 | Dot product as the projection operator | interactive: simulation |
| 7 | Q1(c) rehearsal, projection of F about line AB | quiz (exam-style) |
| 8 | Sign errors, the one bug that costs the most marks | slide |

The code page leans on your dev background. Normalising a vector is one function. Dot product is a zip and sum.

### Stage 2, Moments and Couples

*Payoff: you can compute a moment about a point or an axis and never lose the j sign.*

| # | Page | Type |
|---|---|---|
| 1 | A moment is a cross product, and order matters | slide |
| 2 | Rotate r, watch M change and flip | interactive: simulation |
| 3 | The determinant, and where the minus lives | interactive: code |
| 4 | Moment about an axis, the triple scalar product | interactive: visualization3d |
| 5 | Couples are free vectors, position stops mattering | interactive: simulation |
| 6 | Q1(d) rehearsal, link ABC with a 3 kNm couple | quiz (exam-style) |
| 7 | Varignon check, one route confirms the other | slide |

### Stage 3, Resultants and Equivalent Systems

*Payoff: you can reduce any force system to a force plus a couple, then to a wrench.*

| # | Page | Type |
|---|---|---|
| 1 | Slide a force, pay the couple toll | interactive: simulation |
| 2 | Move everything to O, then add | interactive: diagram |
| 3 | The four force systems and their four resultants | interactive: diagram |
| 4 | Find the point the resultant passes through | interactive: simulation |
| 5 | Wrench resultant, parallel axes, scalar pitch | interactive: visualization3d |
| 6 | Model Q1(a) rehearsal, four forces on a plate | quiz (exam-style) |
| 7 | Model Q1(c) rehearsal, wrench through the X-Z plane | quiz (exam-style) |

### Stage 4, Equilibrium, the 12-Mark Question

*Payoff: you can walk a full boom or pole problem from coordinates to answer.*

| # | Page | Type |
|---|---|---|
| 1 | An FBD is a state snapshot with the constraints kept | slide |
| 2 | Which support blocks which motion | interactive: diagram |
| 3 | Particle versus rigid body, two or three or six | interactive: simulation |
| 4 | The five-step pipeline for every 3D cable problem | interactive: diagram |
| 5 | Take moments about the joint to delete unknowns | interactive: code |
| 6 | Q2 full walkthrough, pole ABC with cables BD and BE | interactive: visualization3d |
| 7 | Timed Q2, 12 marks, 25 minutes | quiz (exam-style) |

### Stage 5, Trusses

*Payoff: you can name three members and their tension or state in one cut.*

| # | Page | Type |
|---|---|---|
| 1 | A truss is a graph, joints are nodes | interactive: diagram |
| 2 | Method of joints, the node-by-node walk | interactive: simulation |
| 3 | Spot a zero-force member without computing | interactive: game |
| 4 | Cut three members, replace with three unknowns | interactive: simulation |
| 5 | Pick the moment centre that kills two unknowns | interactive: diagram |
| 6 | Q3 full walkthrough, Mansard roof truss, DF DG DE | interactive: game |
| 7 | Timed Q3, 12 marks, 25 minutes | quiz (exam-style) |

The JHU truss simulator and MechSimulator truss tool are the references here.

### Stage 6, Centroids by Integration

*Payoff: you can set up dA, pick a strip, and integrate a curved boundary.*

| # | Page | Type |
|---|---|---|
| 1 | A centroid is a weighted mean, nothing more | slide |
| 2 | Composite shapes, the table method | interactive: simulation |
| 3 | Choose the strip, vertical or horizontal | interactive: diagram |
| 4 | Solve for the curve constant before you integrate | interactive: code |
| 5 | Watch A and Ax̄ accumulate as x moves | interactive: simulation |
| 6 | Q4 full walkthrough, line plus cube-root curve | interactive: visualization3d |
| 7 | Timed Q4, 12 marks, 25 minutes | quiz (exam-style) |

### Stage 7, The Exam Run

*Payoff: you can sit the paper in 105 minutes and keep the method marks.*

| # | Page | Type |
|---|---|---|
| 1 | The paper is four known shapes, here they are | slide |
| 2 | Time and marks, the budget you must not breach | interactive: game |
| 3 | Where the method marks live in each question | interactive: diagram |
| 4 | Full paper simulator, Q1 to Q4, timed | quiz (exam-style) |
| 5 | Error clinic, seven mistakes and their fixes | interactive: game |
| 6 | Night before, the one-page recall sheet | slide |
| 7 | Formula sheet you are given, how to read it fast | interactive: diagram |

**Totals: 7 stages, 52 pages, 20 interactive widgets, 9 quiz pages, 11 slide pages.**

### External links, sorted by licence safety

Safely open and verified: `engineeringstatics.org` (free and open, has embedded interactives, plus a full free PDF), its LibreTexts mirror, UPEI's *Engineering Mechanics: Statics* pressbook, MIT OCW 2.001 lecture notes and problem sets, the GeoGebra Mechanics collection, PhET Balancing Act.

Free to use but not open-licensed: JHU truss simulator, MechSimulator tools, oPhysics, resultant.tools, MegaCalc centroid calculator. I will label these as free tools, not open resources.

Each stage gets two or three of these, matched to its topic.

### Roster I will write

One teacher, precise and example-led, asks before telling. Two peers. One writes fast and drops signs. One is slow and checks dimensions. That pairing lets the discussion surface the real error classes.

