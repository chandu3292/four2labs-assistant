# Seed documents

Drop your four2labs documents here (PDF, DOCX, MD, TXT, PNG/JPG, etc.).

On server startup, every file in this folder is OCR'd/parsed and indexed into the
RAG knowledge base automatically (see `SEED_DOCS_DIR` in `docker-compose.app.yml`),
so the chat + voice demo always has content to answer from — even after a restart.

Each file is indexed under its own name, so they show up individually in the
"documents" list in the UI.

Good things to put here for a client demo:
- four2labs services / capabilities one-pager
- case studies or past project summaries
- pricing / FAQ
- company overview
