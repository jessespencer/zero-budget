# AI import

Zero has no bank sync. Instead, you hand a bank or card statement to the AI
coding agent you already use, and Zero's `import-txns` skill teaches it how to
reconcile that statement against your budget: match every line, add only
what's missing, and check the balance.

**It runs in your agent, not in Zero.** Zero has no AI built in and sends
nothing anywhere. Your statement goes to your AI provider — the same as
anything else you share with your agent — and the agent writes to your own
Zero database.

## What you need

- **An agent that reads skills:** [Claude Code](https://claude.com/claude-code)
  (reads `.claude/skills/`) or Codex (reads `.agents/skills/`). The skill ships
  with Zero, so there's nothing to install.
- **The `sqlite3` command-line tool** — `brew install sqlite` on macOS,
  `apt install sqlite3` on Linux.
- **A Zero checkout** to run the agent in — the folder you cloned.

## Where it writes

- **On this machine** (the default): the database Zero uses here —
  `ZERO_DB_PATH` from your environment or `.env.local`, otherwise
  `data/zero.db`.
- **On a server** (a Raspberry Pi, home server or NAS): set `ZERO_REMOTE_HOST`
  and `ZERO_REMOTE_DB_PATH` in `.env.local` (see the self-hosting block in
  [.env.example](../.env.example)) and the skill works on that database over
  ssh instead.

Every run prints which database it's using before it touches anything.

## Using it

Open your agent in the Zero folder and give it a statement — a screenshot of
your bank's transactions page, a CSV export, or pasted text:

> Reconcile this against my Visa card.

The agent then:

1. **Finds the account.** If the statement doesn't name one, it works it out
   from the balance and the bank, and asks you to confirm before going on.
2. **Matches every line** against what's already in Zero — allowing for dates a
   day or two apart, payee names that differ from the bank's, combined entries,
   and pending charges that later post for a different amount.
3. **Checks the balance.** What's in Zero plus what's missing must equal the
   statement's posted balance. If it doesn't add up, it stops and looks again
   rather than guessing.
4. **Adds only what's missing** — after taking a backup, in one transaction,
   using payee and category names that already exist in your budget. It never
   invents a payee without asking you first.
5. **Reports back** with the new balance, so you can see it matches the
   statement.

Pending charges can be added as pending: they show in Zero's pending section and
stay out of the balance until they post, and a later reconcile marks them as
posted instead of adding them twice.

## Good to know

- **Transfers between your own accounts** aren't added this way — record those
  in Zero, so both sides stay linked.
- **Every write is backed up first.** The agent prints the backup's location;
  restoring it undoes the import.
- **Prefer a screenshot of the bank's website** when you have one. Some banks'
  CSV exports have been seen to leave out transactions the website shows.
- The full instructions the agent follows are in
  [.claude/skills/import-txns/SKILL.md](../.claude/skills/import-txns/SKILL.md).
