CREATE INDEX jg_docs_doc_gin ON jg_docs USING gin (doc jsonb_path_ops);
CREATE INDEX jg_docs_tag ON jg_docs ((doc ->> 'tag'));
