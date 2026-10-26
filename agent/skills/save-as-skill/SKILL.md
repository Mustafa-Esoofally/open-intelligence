---
description: Use when the user says "save this as a skill", "make this reusable", or wants to turn a procedure that just worked into a skill colleagues can load later (the Dojo loop).
---

# Save a procedure as a skill

Skills are how know-how compounds across the company: a procedure done well
once becomes a `SKILL.md` that any future session can load on demand.

1. Restate what just worked as a numbered procedure: the inputs the user
   provided, the tools or connections used, the exact steps, the checks, and
   the final output. Leave out one-off details (dates, names, ticket numbers)
   unless they are part of the rule.
2. Propose a kebab-case name and a one-line `description` written as the
   trigger ("Use when ..."). The description is a routing hint: it decides
   when the skill gets loaded, so make it specific.
3. Strip secrets and personal data. A skill is shared; credentials, customer
   data, and anything from private memory never belong in it.
4. Show the draft and ask for confirmation.
5. In local development (`eve dev`), write it through self-modification to
   `agent/skills/<name>/SKILL.md`, starting with the frontmatter:

   ```md
   ---
   description: Use when ...
   ---
   ```

   Outside local development, give the user the file contents to commit.
6. Tell the user the skill is local to this agent until it is published
   (Dojo: a reviewed pull request, then available to everyone).

Facts go to memory; procedures go to skills.
