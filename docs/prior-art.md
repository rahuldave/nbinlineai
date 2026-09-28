---
title: "Prior art: Solveit and ai-jup"
---

# The ideas behind nbinlineai

The most important inspiration for nbinlineai is [Solveit](https://solve.it.com/), the interactive problem-solving environment built at Answer.AI by Jeremy Howard and colleagues. Our more immediate starting point was [Hamel Husain's `ai-jup`](https://github.com/AnswerDotAI/ai-jup), a JupyterLab experiment explicitly inspired by Solveit. Hamel brought AI prompt cells, references to live Python variables, and callable Python functions into JupyterLab. We built on that example to make notebook conversations more configurable and maintainable. Solveit remains the larger model for *how* a person and an AI can work through a problem together.

## Solveit starts with the way you work

Solveit is both a platform and an approach taught through fast.ai's *How To Solve It With Code*. Its name nods to George Pólya's *How to Solve It*: understand the problem, make a plan, carry it out, and look back. In Solveit, that becomes a practical rhythm of writing a little code, running it, inspecting the result, and revising the plan. AI can help at any step, but the short feedback loop lets the person check each suggestion before building on it. [Johno Whitaker's introduction](https://www.answer.ai/posts/2025-10-01-solveit-full.html) walks through that rhythm with a concrete coding example.

The platform makes this work feel like a conversation with an executable notebook. Notes, code, outputs, questions, and answers live in one editable dialog. That gives the person a record of what they tried and gives the AI relevant context from the same workspace. Solveit also lets a question refer to a live Python value, use built-in search and URL-reading tools, or offer a Python function as a tool. The AI can inspect or act through those tools instead of relying only on a pasted description. [Answer.AI's account of shared context](https://www.answer.ai/posts/2025-10-01-solveit-full.html) explains why this matters.

## The dialog is something you can edit

One of Solveit's distinctive ideas is **dialog engineering**: improving the working conversation itself. A person can revise an earlier note or AI answer, remove a dead end, organize an exploration under a collapsible heading, hide a message from the AI, or pin a useful message so it stays in context as the dialog grows. These are ways to keep the record useful to both reader and model, rather than treating the exchange as an immutable chat log. [The Solveit introduction](https://www.answer.ai/posts/2025-10-01-solveit-full.html) describes these controls, and [a worked writing example](https://www.answer.ai/posts/2025-10-13-video-to-doc.html) shows them in use across a long project.

Solveit's interface also encourages review before execution. It defaults to code inputs, while AI-written code arrives in fenced blocks that a person chooses whether to add and run. **Learning** mode favors hints and small steps; its completion suggestions appear only when requested. These choices support the same goal as the short feedback loop: build understanding while making progress. The platform is used for writing, research, and other work as well as programming; the editable dialog is the common structure. [Answer.AI's launch article](https://www.answer.ai/posts/2025-10-01-solveit-full.html) explains the design choices.

For a demonstration, watch [Jeremy Howard's tour of the Solveit platform](https://www.youtube.com/watch?v=bxDDLMe6KuU), linked from [Answer.AI's introduction](https://www.answer.ai/posts/2025-10-01-solveit-full.html). The introduction also includes [a shorter video about the approach](https://www.youtube.com/watch?v=DgPr3HVp0eg).

## From Solveit to JupyterLab

[Hamel Husain's `ai-jup`](https://github.com/AnswerDotAI/ai-jup) translated a small but compelling part of Solveit into JupyterLab: Markdown prompt cells, streaming answers, references to live kernel variables, and functions offered to the AI as tools. Its README calls the project an experiment with only a subset of Solveit's features. That distinction matters: Solveit is its own platform and workflow, while `ai-jup` demonstrated how some of its ideas could work inside a conventional notebook.

nbinlineai follows that lineage. It keeps questions and answers as ordinary notebook Markdown cells, can read explicitly referenced live values, and lets the user declare Python tools. We added controls for which notebook text and tools enter a question's context, ways to edit and keep answers, notebook defaults, and integration with JupyterLab's normal cell execution. Those are [our JupyterLab choices](architecture.md), not a claim that this extension reproduces Solveit. If the most useful idea here is to take small steps, inspect the result, and keep a readable record of the reasoning, the credit belongs first to Solveit and the earlier problem-solving tradition it draws on.
