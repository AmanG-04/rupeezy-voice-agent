"""SQLAlchemy persistence layer.

SQLite by default (DATABASE_URL=sqlite:///...) — Phase 11 swaps to Supabase
Postgres by changing DATABASE_URL only. The application never imports SQLite-
specific APIs.
"""
