#!/usr/bin/env python3
"""Produce a credential-free D1 export, also mandatory before restoring any backup.
Reads a stopped D1 SQL export; emits ordinary SQLite SQL, preserving schema/history.
No application or remote database is touched. Uses the Python standard library.
"""
import argparse
import re
import sqlite3
from pathlib import Path

CREDENTIAL_TABLES = ('edition_codes', 'edition_consents', 'edition_grants', 'edition_effect_guards')
# Live read/sign-in linkage and installation-local canonicalisation completion
# receipts do not travel. Preserve restrictions, explicit grants, reference bodies
# and source/shingle indexes as durable business data. Remove complete receipt
# rows so future personal columns cannot survive a backup or restore.
KNOWLEDGE_PRIVATE_TABLES = ('knowledge_read_receipts', 'knowledge_help_links',
                            'knowledge_help_sessions', 'knowledge_canonicalisation_receipts',
                            'knowledge_write_guards', 'knowledge_upgrade_permits', 'knowledge_upgrade_progress')

def punctuated_end(statement):
    # Wrangler's splitter recognizes END followed by whitespace or a semicolon,
    # while SQLite also accepts END, and END). Keep those complete trigger
    # definitions last so they cannot absorb the entire following schema into
    # one D1 statement. Their original SQL and execution order within each
    # trigger remain byte-for-byte unchanged.
    tokens = re.sub(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|--[^\n]*|/\*[\s\S]*?\*/", ' ', statement)
    return bool(re.search(r'\bEND[^;\s\w]', tokens, re.I))

def search_definition(db):
    row = db.execute("SELECT type,sql FROM sqlite_master WHERE name='inbox_message_search'").fetchone()
    if row is None:
        return None
    kind, sql = row
    if (kind != 'table' or not isinstance(sql, str)
            or not re.match(r'CREATE\s+VIRTUAL\s+TABLE\s', sql, re.I)
            or not re.search(r'\bUSING\s+fts5\s*\(', sql, re.I)
            or not re.search(r'''\bcontent\s*=\s*(['"])messages\1''', sql, re.I)):
        raise ValueError('Refusing to replace an unrecognized inbox_message_search schema.')
    return sql + ('' if sql.rstrip().endswith(';') else ';')

def sanitize(sql):
    db = sqlite3.connect(':memory:')
    try:
        db.executescript(sql)
        db.execute('PRAGMA foreign_keys=OFF')
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in CREDENTIAL_TABLES + KNOWLEDGE_PRIVATE_TABLES:
            if table in tables:
                db.execute(f'DELETE FROM "{table}"')
        if 'knowledge_upgrade_reports' in tables:
            # Completion receipts never transfer: the restored source must
            # establish its own canonicalisation before nonmember disclosure.
            db.execute('UPDATE knowledge_upgrade_reports SET completed_at=NULL')
        if 'knowledge_reply_blocks' in tables:
            # Keep live authors' own words. Erased/orphan copies must lose the
            # entire payload and author-derived fingerprint, not only the link.
            live = '0'
            if 'contacts' in tables:
                fence = ("AND NOT EXISTS(SELECT 1 FROM contact_erasures erased WHERE "
                         "erased.project_id=contact.project_id AND erased.contact_id=contact.id)"
                         if 'contact_erasures' in tables else '')
                live = ("EXISTS(SELECT 1 FROM contacts contact WHERE contact.project_id=block.project_id "
                        "AND contact.id=block.author_contact_id "
                        "AND coalesce(json_extract(contact.metadata_json,'$.is_deleted'),0)<>1 "
                        "AND coalesce(json_extract(contact.metadata_json,'$.is_erasing'),0)<>1 "
                        "AND coalesce(json_extract(contact.metadata_json,'$.is_erased'),0)<>1 "
                        + fence + ')')
            db.execute('DELETE FROM knowledge_reply_blocks AS block '
                       'WHERE author_contact_id IS NOT NULL AND NOT (' + live + ')')
        if 'api_credentials' in tables:
            revisions = list(db.execute('SELECT policy_revision,namespace,id FROM api_credentials'))
            db.execute("UPDATE api_credentials SET revoked_at=coalesce(revoked_at,max(1,created_at))")
            db.executemany('UPDATE api_credentials SET policy_revision=? WHERE namespace=? AND id=?', revisions)
        if 'integration_tokens' in tables:
            db.execute("UPDATE integration_tokens SET token_hash='revoked:'||id,revoked_at=coalesce(revoked_at,max(1,created_at))")
        if 'api_requests' in tables:
            db.execute('UPDATE api_requests SET response_json=NULL,erased=1')
        if 'api_appends' in tables:
            db.execute('UPDATE api_appends SET response_json=NULL')
        for table in ('integration_deliveries', 'native_integration_intents', 'native_integration_destinations', 'api_uploads', 'api_upload_disposals'):
            if table in tables:
                db.execute(f'DELETE FROM "{table}"')
        search = search_definition(db)
        if search:
            # iterdump represents virtual tables with writable_schema and raw
            # shadow rows. Recreate this derived cache from messages instead.
            db.execute('DROP TABLE "inbox_message_search"')
        db.commit()
        # D1 cannot disable foreign keys or insert before a referenced table
        # exists. Create the schema first, then defer row checks during import.
        # Its importer owns the transaction, so omit SQLite dump wrappers.
        statements = [line for line in db.iterdump() if line not in ('BEGIN TRANSACTION;', 'COMMIT;')]
        schema, data, triggers = [], [], []
        for statement in statements:
            if re.match(r'CREATE\s+TRIGGER\s', statement, re.I):
                triggers.append(statement)
                continue
            target = schema if re.match(r'CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s', statement, re.I) else data
            target.append(statement)
        triggers.sort(key=lambda statement: (punctuated_end(statement), statement))
        dump = 'PRAGMA defer_foreign_keys=ON;\n' + '\n'.join(schema + data + triggers) + '\n'
        if search:
            dump += search + '\nINSERT INTO "inbox_message_search"("inbox_message_search") VALUES(\'rebuild\');\n'
        return dump + 'PRAGMA defer_foreign_keys=OFF;\n'
    finally:
        db.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('Use a separate output; retain your original backup privately.')
    with args.output.open('x') as output:
        output.write(sanitize(args.input.read_text()))
